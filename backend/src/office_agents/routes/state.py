"""Read-only state endpoints + root liveness + file upload.

These all hand back current in-memory state and do not mutate the simulation.
The router is mounted at the application root with no prefix.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime

from fastapi import APIRouter, HTTPException, UploadFile

from office_agents.config import settings
from office_agents.infra.app_state import app_state
from office_agents.office.layout import ROOM_POSITIONS, ROOMS

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/")
async def root_liveness() -> dict[str, object]:
    """Cheap liveness probe — proves the FastAPI process is up."""

    orch = app_state.orchestrator
    return {
        "status": "ok",
        "service": "office-agents",
        "simulation_running": orch.running if orch else False,
    }


@router.get("/state")
async def get_state() -> dict[str, object]:
    """Full office snapshot — agents, current_query, bulletin, whiteboard."""

    return app_state.require_office_state().to_dict()


@router.get("/bulletin")
async def get_bulletin() -> dict[str, object]:
    return {"posts": app_state.require_office_state().bulletin_posts}


@router.get("/whiteboard")
async def get_whiteboard() -> dict[str, object]:
    return {"entries": app_state.require_office_state().whiteboard}


@router.get("/layout")
async def get_layout() -> dict[str, object]:
    return {
        "rooms": ROOMS,
        "room_positions": {
            name: {"x": pos[0], "y": pos[1]}
            for name, pos in ROOM_POSITIONS.items()
        },
    }


@router.get("/history")
async def get_history() -> dict[str, object]:
    office = app_state.office_state
    if not office or not office._store:
        return {"deliverables": []}
    return {"deliverables": await office._store.get_deliverables(limit=20)}


@router.get("/agents")
async def get_agents() -> dict[str, object]:
    return {"agents": [a.to_info() for a in app_state.require_orchestrator().agents]}


@router.post("/upload")
async def upload_file(file: UploadFile) -> dict[str, object]:
    """Save an uploaded file and expose it to agents via the file_reader tool."""

    upload_dir = "/data/uploads"
    os.makedirs(upload_dir, exist_ok=True)

    safe_name = os.path.basename(file.filename or "uploaded_file")
    dest = os.path.join(upload_dir, safe_name)
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)

    if upload_dir not in settings.allowed_file_paths:
        settings.allowed_file_paths.append(upload_dir)

    logger.info("File uploaded: %s (%d bytes)", dest, len(content))
    return {"path": dest, "name": safe_name, "size": len(content)}
