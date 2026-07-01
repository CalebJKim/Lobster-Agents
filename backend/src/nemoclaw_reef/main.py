"""FastAPI application entry-point.

Only does three things:

1. Builds the dependency graph at startup (LLM client, store, agents,
   orchestrator, broadcaster) and parks it on ``infra.app_state.app_state``.
2. Mounts the route modules from ``nemoclaw_reef.routes`` on the FastAPI app.
3. Runs the simulation tick loop in the background for the lifetime of the
   process.

Endpoint logic lives in ``nemoclaw_reef.routes.*``. Sandbox/Reef logic lives
in their respective subpackages. This file should stay short.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from nemoclaw_reef.agents.base import Agent
from nemoclaw_reef.agents.memory import AgentMemory
from nemoclaw_reef.agents.orchestrator import Orchestrator
from nemoclaw_reef.agents.roles import ALL_ROLES
from nemoclaw_reef.claw_config import get_claw_metadata
from nemoclaw_reef.config import settings
from nemoclaw_reef.infra.app_state import app_state
from nemoclaw_reef.infra.broadcaster import Broadcaster
from nemoclaw_reef.llm.client import LLMClient
from nemoclaw_reef.llm.registry import (
    EXTRA_SEED_PROFILES,
    ModelRegistry,
    default_profile_from_settings,
)
from nemoclaw_reef.state.reef_state import ReefState
from nemoclaw_reef.state.persistence import PersistentStore
from nemoclaw_reef.routes import health as health_route
from nemoclaw_reef.routes import agents as agents_route
from nemoclaw_reef.routes import models as models_route
from nemoclaw_reef.routes import query as query_route
from nemoclaw_reef.routes import sandboxes as sandboxes_route
from nemoclaw_reef.routes import state as state_route
from nemoclaw_reef.routes import websocket as websocket_route

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting NemoClaw Reef backend...")

    # 1. LLM client (used by every agent + the /health endpoint). Wrapped
    # in a ModelRegistry so the user can switch backends at runtime via the
    # /models routes without rebuilding agents.
    default_profile = default_profile_from_settings()
    llm = LLMClient(
        base_url=default_profile.base_url,
        api_key=default_profile.api_key,
        model=default_profile.model,
        kind=default_profile.kind,
    )
    model_registry = ModelRegistry(client=llm, initial=default_profile)
    # Seed any additional known-good backends so they appear in the picker
    # without the user having to retype them each restart.
    for extra in EXTRA_SEED_PROFILES:
        if extra.id == default_profile.id:
            continue
        try:
            model_registry.upsert(extra)
            logger.info("Seeded model profile %r (%s)", extra.id, extra.model)
        except ValueError as exc:
            logger.warning("Could not seed model profile %r: %s", extra.id, exc)
    health_route.attach_llm_client(llm)

    # 2. Persistent store + reef state.
    store = PersistentStore(db_path=settings.db_path)
    await store.init_db()
    reef = ReefState(store=store)
    await reef.load_history()
    logger.info("Loaded %d historical bulletin posts", len(reef.bulletin_posts))

    # 3. Build the lobster agents.
    agents: list[Agent] = []
    for role in ALL_ROLES:
        mem = AgentMemory(agent_name=role.name, db_path=settings.db_path)
        await mem.init_db()
        agent = Agent(role_config=role, llm_client=llm, memory=mem)
        agents.append(agent)
        reef.register_agent(
            name=role.name,
            role=role.role,
            location=agent.location,
            position=agent.position,
            metadata=get_claw_metadata(role.name),
            species=agent.species,
            runtime=agent.runtime,
        )

    # 4. Broadcaster + Orchestrator.
    broadcaster = Broadcaster()
    orchestrator = Orchestrator(
        agents=agents,
        reef_state=reef,
        broadcast=broadcaster.broadcast,
    )

    # 5. Park everything on the singleton so routes can read it.
    app_state.llm = llm
    app_state.model_registry = model_registry
    app_state.reef_state = reef
    app_state.broadcaster = broadcaster
    app_state.orchestrator = orchestrator

    # 6. Run the simulation tick loop in the background.
    app_state.sim_task = asyncio.create_task(orchestrator.run())
    logger.info(
        "NemoClaw Reef backend ready: %d lobsters, %d historical bulletin posts, simulation task started",
        len(agents),
        len(reef.bulletin_posts),
    )

    try:
        yield
    finally:
        logger.info("Shutting down NemoClaw Reef backend...")
        if app_state.orchestrator:
            app_state.orchestrator.stop()
        if app_state.sim_task:
            app_state.sim_task.cancel()
            try:
                await app_state.sim_task
            except asyncio.CancelledError:
                pass


app = FastAPI(
    title="NemoClaw Reef",
    description="Backend for the NemoClaw Reef demo",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount every route module. Add new endpoints by creating a router in
# nemoclaw_reef.routes and including it here.
app.include_router(state_route.router)
app.include_router(query_route.router)
app.include_router(sandboxes_route.router)
app.include_router(agents_route.router)
app.include_router(models_route.router)
app.include_router(health_route.router)
app.include_router(websocket_route.router)


def run() -> None:
    """Run the server via ``uvicorn``."""
    uvicorn.run(
        "nemoclaw_reef.main:app",
        host="0.0.0.0",
        port=8001,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    run()
