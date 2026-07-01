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

from nemoclaw_reef.infra.app_state import app_state
from nemoclaw_reef.models import AgentState
from nemoclaw_reef.state.layout import get_room_position, release_room_seat

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    broadcaster = app_state.require_broadcaster()
    await broadcaster.connect(ws)

    # Push an initial snapshot so the client doesn't render an empty reef.
    orch = app_state.orchestrator
    reef = app_state.reef_state
    if orch and reef:
        await ws.send_json({
            "type": "full_state",
            "agents": [a.to_info() for a in orch.agents],
            "office": reef.to_dict(),
            "sandbox_assignments": orch.get_sandbox_assignments(),
            "speech_language": reef.speech_language,
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
    reef = app_state.reef_state
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

    if msg_type == "reset" and orch and reef and broadcaster:
        await _reset_simulation(orch, reef, broadcaster)
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

    if msg_type == "speech_language" and orch and reef:
        language = str(msg.get("language") or "en").strip().lower()
        if language not in {"en", "zh"}:
            await ws.send_json({"type": "error", "message": "Unsupported speech language"})
            return
        reef.speech_language = language
        orch._idle_chat.reset()
        payload = {
            "type": "speech_language_status",
            "language": reef.speech_language,
            "timestamp": datetime.now().isoformat(),
        }
        if broadcaster:
            await broadcaster.broadcast(payload)
        else:
            await ws.send_json(payload)
        return

    if msg_type == "ping":
        await ws.send_json({"type": "pong"})
        return

    await ws.send_json({"type": "error", "message": f"Unknown message type: {msg_type}"})


async def _reset_simulation(orch, reef, broadcaster) -> None:
    """Clear the active query, drop every claw back into the war room."""

    await orch.cancel_all_sandbox_runs(reason="reset")
    orch.clear_sandbox_run_statuses()
    # Drop idle-chat conversation threads so the reef starts a fresh discussion
    # after reset rather than continuing whatever happened before.
    orch._idle_chat.reset()
    reef.current_query = None
    reef.current_files = []
    reef.whiteboard.clear()
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
        state = reef.agent_states[agent.name]
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
        "office": reef.to_dict(),
        "sandbox_assignments": orch.get_sandbox_assignments(),
        "speech_language": reef.speech_language,
        "timestamp": datetime.now().isoformat(),
    })
    logger.info("Reef reset - all agents back to shared reef")
