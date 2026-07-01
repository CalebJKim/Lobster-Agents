"""User query submission — the headline action of the demo."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException

from nemoclaw_reef.infra.app_state import app_state
from nemoclaw_reef.models import QueryRequest

router = APIRouter()


@router.post("/query")
async def submit_query(req: QueryRequest) -> dict[str, object]:
    """Drop a query onto the orchestrator's intake queue."""

    if not req.query or not req.query.strip():
        raise HTTPException(status_code=400, detail="query is required")
    await app_state.require_orchestrator().submit_query(req.query, req.files)
    return {
        "status": "accepted",
        "query": req.query,
        "files": req.files or [],
        "timestamp": datetime.now().isoformat(),
    }
