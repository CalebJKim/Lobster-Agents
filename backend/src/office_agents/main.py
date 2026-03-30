"""FastAPI application — HTTP + WebSocket entry-point for Office Agents."""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

import uvicorn
from fastapi import FastAPI, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from office_agents.agents.base import Agent
from office_agents.agents.memory import AgentMemory
from office_agents.agents.orchestrator import Orchestrator
from office_agents.agents.roles import ALL_ROLES
from office_agents.config import settings
from office_agents.llm.client import LLMClient
from office_agents.models import AgentState, QueryRequest
from office_agents.office.layout import ROOMS, ROOM_POSITIONS
from office_agents.office.state import OfficeState
from office_agents.office.store import PersistentStore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


# ======================================================================
# WebSocket connection manager
# ======================================================================

class ConnectionManager:
    """Keeps track of active WebSocket clients and broadcasts messages."""

    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active_connections.append(ws)
        logger.info(
            "WebSocket client connected (%d total)", len(self.active_connections)
        )

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.active_connections:
            self.active_connections.remove(ws)
        logger.info(
            "WebSocket client disconnected (%d remaining)",
            len(self.active_connections),
        )

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Send a JSON message to every connected client."""
        dead: list[WebSocket] = []
        for ws in self.active_connections:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


# ======================================================================
# Application state (populated during startup)
# ======================================================================

_orchestrator: Orchestrator | None = None
_office_state: OfficeState | None = None
_sim_task: asyncio.Task[None] | None = None


# ======================================================================
# Lifespan — startup / shutdown
# ======================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _orchestrator, _office_state, _sim_task

    logger.info("Starting Office Agents backend...")

    # 1. LLM client
    llm = LLMClient(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model=settings.llm_model,
    )

    # 2. Persistent store + office state
    store = PersistentStore(db_path=settings.db_path)
    await store.init_db()
    _office_state = OfficeState(store=store)
    await _office_state.load_history()
    logger.info("Loaded %d historical bulletin posts", len(_office_state.bulletin_posts))

    # 3. Create agents (memory + role config)
    agents: list[Agent] = []
    for role in ALL_ROLES:
        mem = AgentMemory(agent_name=role.name, db_path=settings.db_path)
        await mem.init_db()
        agent = Agent(role_config=role, llm_client=llm, memory=mem)
        agents.append(agent)
        _office_state.register_agent(
            name=role.name,
            role=role.role,
            location=role.default_desk,
            position=ROOM_POSITIONS[role.default_desk],
        )

    # 4. Orchestrator
    _orchestrator = Orchestrator(
        agents=agents,
        office_state=_office_state,
        broadcast=manager.broadcast,
    )

    # 5. Start simulation loop as background task
    _sim_task = asyncio.create_task(_orchestrator.run())
    logger.info("Simulation loop started as background task")

    yield  # ← application is running

    # Shutdown
    logger.info("Shutting down Office Agents backend...")
    if _orchestrator:
        _orchestrator.stop()
    if _sim_task:
        _sim_task.cancel()
        try:
            await _sim_task
        except asyncio.CancelledError:
            pass


# ======================================================================
# FastAPI app
# ======================================================================

app = FastAPI(
    title="Office Agents",
    description="Backend for Office Agents pixel-art simulation",
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


# ======================================================================
# HTTP endpoints
# ======================================================================

@app.get("/")
async def health_check():
    """Health check."""
    return {
        "status": "ok",
        "service": "office-agents",
        "simulation_running": _orchestrator.running if _orchestrator else False,
    }


@app.post("/query")
async def submit_query(req: QueryRequest):
    """Submit a user query for the agents to work on."""
    if not _orchestrator:
        return {"error": "Orchestrator not initialized"}, 503
    await _orchestrator.submit_query(req.query, req.files)
    return {
        "status": "accepted",
        "query": req.query,
        "files": req.files or [],
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/state")
async def get_state():
    """Return the current office state snapshot."""
    if not _office_state:
        return {"error": "Office state not initialized"}, 503
    return _office_state.to_dict()


@app.get("/bulletin")
async def get_bulletin():
    """Return all bulletin board posts."""
    if not _office_state:
        return {"error": "Office state not initialized"}, 503
    return {"posts": _office_state.bulletin_posts}


@app.get("/whiteboard")
async def get_whiteboard():
    """Return the current whiteboard content."""
    if not _office_state:
        return {"error": "Office state not initialized"}, 503
    return {"entries": _office_state.whiteboard}


@app.get("/layout")
async def get_layout():
    """Return the office layout (room definitions and positions)."""
    return {
        "rooms": ROOMS,
        "room_positions": {
            name: {"x": pos[0], "y": pos[1]}
            for name, pos in ROOM_POSITIONS.items()
        },
    }


@app.post("/upload")
async def upload_file(file: UploadFile):
    """Upload a file for agents to read. Saves to a writable uploads directory."""
    import os
    upload_dir = "/data/uploads"
    os.makedirs(upload_dir, exist_ok=True)

    # Sanitize filename
    safe_name = os.path.basename(file.filename or "uploaded_file")
    dest = os.path.join(upload_dir, safe_name)
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)

    # Dynamically allow the uploads dir so agents can read it
    if upload_dir not in settings.allowed_file_paths:
        settings.allowed_file_paths.append(upload_dir)

    logger.info("File uploaded: %s (%d bytes)", dest, len(content))
    return {"path": dest, "name": safe_name, "size": len(content)}


@app.get("/history")
async def get_history():
    """Return past deliverables (query + answer pairs)."""
    if not _office_state or not _office_state._store:
        return {"deliverables": []}
    deliverables = await _office_state._store.get_deliverables(limit=20)
    return {"deliverables": deliverables}


@app.get("/agents")
async def get_agents():
    """Return info on all agents."""
    if not _orchestrator:
        return {"error": "Orchestrator not initialized"}, 503
    return {"agents": [a.to_info() for a in _orchestrator.agents]}


# ======================================================================
# WebSocket endpoint
# ======================================================================

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)

    # Send initial full state so the client can render immediately
    if _office_state and _orchestrator:
        await ws.send_json(
            {
                "type": "full_state",
                "agents": [a.to_info() for a in _orchestrator.agents],
                "office": _office_state.to_dict(),
                "timestamp": datetime.now().isoformat(),
            }
        )

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = msg.get("type")

            if msg_type == "query" and _orchestrator:
                query_text = msg.get("query", "")
                files = msg.get("files", [])
                if query_text:
                    await _orchestrator.submit_query(query_text, files)
                    await ws.send_json(
                        {
                            "type": "query_accepted",
                            "query": query_text,
                            "timestamp": datetime.now().isoformat(),
                        }
                    )
                else:
                    await ws.send_json(
                        {"type": "error", "message": "Empty query"}
                    )

            elif msg_type == "reply" and _orchestrator:
                reply_text = msg.get("message", "")
                if reply_text:
                    await _orchestrator.submit_reply(reply_text)
                    await ws.send_json({
                        "type": "reply_accepted",
                        "message": reply_text,
                        "timestamp": datetime.now().isoformat(),
                    })

            elif msg_type == "reset" and _orchestrator and _office_state:
                # Clear query, reset agents to desks
                _office_state.current_query = None
                _office_state.current_files = []
                _office_state.whiteboard.clear()
                _orchestrator._query_tick = 0
                for agent in _orchestrator.agents:
                    agent.current_task = None
                    agent.event_queue.clear()
                    agent.state = AgentState.idle
                    default_desk = agent.default_desk
                    agent.location = default_desk
                    agent.position = ROOM_POSITIONS[default_desk]
                    _office_state.agent_states[agent.name]["state"] = "idle"
                    _office_state.agent_states[agent.name]["location"] = default_desk
                    _office_state.agent_states[agent.name]["position"] = {
                        "x": agent.position[0], "y": agent.position[1]
                    }
                    _office_state.agent_states[agent.name]["current_task"] = None
                # Broadcast full state to all clients
                await manager.broadcast({
                    "type": "full_state",
                    "agents": [a.to_info() for a in _orchestrator.agents],
                    "office": _office_state.to_dict(),
                    "timestamp": datetime.now().isoformat(),
                })
                logger.info("Office reset — all agents back to desks")

            elif msg_type == "water_cooler" and _orchestrator:
                # Toggle or set topic: {type: "water_cooler", enabled: bool, topic: str|null}
                if "enabled" in msg:
                    _orchestrator.water_cooler_enabled = bool(msg["enabled"])
                if "topic" in msg:
                    _orchestrator.water_cooler_topic = msg["topic"] or None
                await ws.send_json({
                    "type": "water_cooler_status",
                    "enabled": _orchestrator.water_cooler_enabled,
                    "topic": _orchestrator.water_cooler_topic,
                    "timestamp": datetime.now().isoformat(),
                })
                logger.info(
                    "Water cooler: enabled=%s, topic=%s",
                    _orchestrator.water_cooler_enabled,
                    _orchestrator.water_cooler_topic,
                )

            elif msg_type == "ping":
                await ws.send_json({"type": "pong"})

            else:
                await ws.send_json(
                    {"type": "error", "message": f"Unknown message type: {msg_type}"}
                )

    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception:
        logger.exception("WebSocket error")
        manager.disconnect(ws)


# ======================================================================
# CLI entry-point
# ======================================================================

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
