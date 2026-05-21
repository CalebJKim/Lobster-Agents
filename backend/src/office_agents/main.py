"""FastAPI application entry-point.

Only does three things:

1. Builds the dependency graph at startup (LLM client, store, agents,
   orchestrator, broadcaster) and parks it on ``infra.app_state.app_state``.
2. Mounts the route modules from ``office_agents.routes`` on the FastAPI app.
3. Runs the simulation tick loop in the background for the lifetime of the
   process.

Endpoint logic lives in ``office_agents.routes.*``. Sandbox/Reef logic lives
in their respective subpackages. This file should stay short.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from office_agents.agents.base import Agent
from office_agents.agents.memory import AgentMemory
from office_agents.agents.orchestrator import Orchestrator
from office_agents.agents.roles import ALL_ROLES
from office_agents.claw_config import get_claw_metadata
from office_agents.config import settings
from office_agents.infra.app_state import app_state
from office_agents.infra.broadcaster import Broadcaster
from office_agents.llm.client import LLMClient
from office_agents.office.state import OfficeState
from office_agents.office.store import PersistentStore
from office_agents.routes import health as health_route
from office_agents.routes import query as query_route
from office_agents.routes import sandbox as sandbox_route
from office_agents.routes import state as state_route
from office_agents.routes import ws as ws_route

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Office Agents backend...")

    # 1. LLM client (used by every agent + the /health endpoint).
    llm = LLMClient(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model=settings.llm_model,
    )
    health_route.attach_llm_client(llm)

    # 2. Persistent store + office state.
    store = PersistentStore(db_path=settings.db_path)
    await store.init_db()
    office = OfficeState(store=store)
    await office.load_history()
    logger.info("Loaded %d historical bulletin posts", len(office.bulletin_posts))

    # 3. Build the lobster agents.
    agents: list[Agent] = []
    for role in ALL_ROLES:
        mem = AgentMemory(agent_name=role.name, db_path=settings.db_path)
        await mem.init_db()
        agent = Agent(role_config=role, llm_client=llm, memory=mem)
        agents.append(agent)
        office.register_agent(
            name=role.name,
            role=role.role,
            location=agent.location,
            position=agent.position,
            metadata=get_claw_metadata(role.name),
        )

    # 4. Broadcaster + Orchestrator.
    broadcaster = Broadcaster()
    orchestrator = Orchestrator(
        agents=agents,
        office_state=office,
        broadcast=broadcaster.broadcast,
    )

    # 5. Park everything on the singleton so routes can read it.
    app_state.llm = llm
    app_state.office_state = office
    app_state.broadcaster = broadcaster
    app_state.orchestrator = orchestrator

    # 6. Run the simulation tick loop in the background.
    app_state.sim_task = asyncio.create_task(orchestrator.run())
    logger.info("Simulation loop started as background task")

    try:
        yield
    finally:
        logger.info("Shutting down Office Agents backend...")
        if app_state.orchestrator:
            app_state.orchestrator.stop()
        if app_state.sim_task:
            app_state.sim_task.cancel()
            try:
                await app_state.sim_task
            except asyncio.CancelledError:
                pass


app = FastAPI(
    title="Office Agents",
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
# office_agents.routes and including it here.
app.include_router(state_route.router)
app.include_router(query_route.router)
app.include_router(sandbox_route.router)
app.include_router(health_route.router)
app.include_router(ws_route.router)


def run() -> None:
    """Run the server via ``uvicorn``."""
    uvicorn.run(
        "office_agents.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    run()
