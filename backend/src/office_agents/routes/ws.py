"""WebSocket endpoint — pushes events to clients, receives query/reply/reset.

The connection lifecycle and event fan-out live in
``infra/broadcaster.py``. This file just decides which inbound message types
are accepted and what they do; outbound events come from the orchestrator and
sandbox manager via the broadcaster's ``broadcast()`` callable.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from office_agents.infra.app_state import app_state
from office_agents.models import AgentState
from office_agents.office.layout import get_room_position, release_room_seat

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    broadcaster = app_state.require_broadcaster()
    await broadcaster.connect(ws)

    # Push an initial snapshot so the client doesn't render an empty reef.
    orch = app_state.orchestrator
    office = app_state.office_state
    if orch and office:
        await ws.send_json({
            "type": "full_state",
            "agents": [a.to_info() for a in orch.agents],
            "office": office.to_dict(),
            "sandbox_assignments": orch.get_sandbox_assignments(),
            "timestamp": datetime.now().isoformat(),
        })

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "Invalid JSON"})
                continue
            await _handle_message(ws, msg)
    except WebSocketDisconnect:
        broadcaster.disconnect(ws)
    except Exception:
        logger.exception("WebSocket error")
        broadcaster.disconnect(ws)


async def _handle_message(ws: WebSocket, msg: dict) -> None:
    msg_type = msg.get("type")
    orch = app_state.orchestrator
    office = app_state.office_state
    broadcaster = app_state.broadcaster

    if msg_type == "query" and orch:
        query_text = msg.get("query", "")
        files = msg.get("files", [])
        if not query_text:
            await ws.send_json({"type": "error", "message": "Empty query"})
            return
        await orch.submit_query(query_text, files)
        await ws.send_json({
            "type": "query_accepted",
            "query": query_text,
            "timestamp": datetime.now().isoformat(),
        })
        return

    if msg_type == "reply" and orch:
        reply_text = msg.get("message", "")
        if not reply_text:
            return
        await orch.submit_reply(reply_text)
        await ws.send_json({
            "type": "reply_accepted",
            "message": reply_text,
            "timestamp": datetime.now().isoformat(),
        })
        return

    if msg_type == "reset" and orch and office and broadcaster:
        await _reset_simulation(orch, office, broadcaster)
        return

    if msg_type == "water_cooler" and orch:
        if "enabled" in msg:
            orch.water_cooler_enabled = bool(msg["enabled"])
        if "topic" in msg:
            orch.water_cooler_topic = msg["topic"] or None
        await ws.send_json({
            "type": "water_cooler_status",
            "enabled": orch.water_cooler_enabled,
            "topic": orch.water_cooler_topic,
            "timestamp": datetime.now().isoformat(),
        })
        return

    if msg_type == "ping":
        await ws.send_json({"type": "pong"})
        return

    await ws.send_json({"type": "error", "message": f"Unknown message type: {msg_type}"})


async def _reset_simulation(orch, office, broadcaster) -> None:
    """Clear the active query, drop every claw back into the war room."""

    await orch.cancel_all_sandbox_runs(reason="reset")
    orch.clear_sandbox_run_statuses()
    # Drop idle-chat conversation threads so the reef starts a fresh discussion
    # after reset rather than continuing whatever happened before.
    orch._idle_chat.reset()
    office.current_query = None
    office.current_files = []
    office.whiteboard.clear()
    orch._query_tick = 0
    orch.sandbox_assignments.clear()
    for agent in orch.agents:
        agent.current_task = None
        agent.event_queue.clear()
        agent.state = AgentState.idle
        release_room_seat(agent.location, agent.name)
        agent.sandbox_name = None
        agent.sandbox_home_room = None
        agent.connect_command = None
        agent.location = "war_room"
        agent.position = get_room_position("war_room", agent.name)
        state = office.agent_states[agent.name]
        state["state"] = "idle"
        state["location"] = agent.location
        state["position"] = {"x": agent.position[0], "y": agent.position[1]}
        state["current_task"] = None
        state["sandbox_name"] = None
        state["sandbox_home_room"] = None
        state["connect_command"] = None
    await broadcaster.broadcast({
        "type": "sandbox_team_updated",
        "sandbox_name": None,
        "assignments": {},
        "timestamp": datetime.now().isoformat(),
    })
    await broadcaster.broadcast({
        "type": "full_state",
        "agents": [a.to_info() for a in orch.agents],
        "office": office.to_dict(),
        "sandbox_assignments": orch.get_sandbox_assignments(),
        "timestamp": datetime.now().isoformat(),
    })
    logger.info("Office reset - all agents back to shared reef")
