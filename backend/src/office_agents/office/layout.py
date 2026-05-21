"""Office grid layout and room definitions.

Positions are stored and transmitted as PIXEL coordinates (not tiles).
The grid is 40x30 tiles, each tile = 16px → 640x480 pixel canvas.
Room definitions match the frontend's ROOMS array in sprites.ts.
"""

from __future__ import annotations

OFFICE_WIDTH = 40
OFFICE_HEIGHT = 30
TILE_SIZE = 16  # pixels per tile

# Room definitions — tile coordinates (must match frontend/src/utils/sprites.ts).
# Four shared sandbox rooms (was seven, one per lobster) plus the common areas.
ROOMS: dict[str, dict] = {
    "sandbox_cove": {"x": 1,  "y": 1,  "w": 9, "h": 7,  "label": "Coral Cove"},
    "sandbox_bridge":       {"x": 31, "y": 1,  "w": 8, "h": 7,  "label": "The Bridge"},
    "sandbox_hollow":     {"x": 11, "y": 9,  "w": 9, "h": 7,  "label": "Quill Hollow"},
    "sandbox_bench":      {"x": 21, "y": 9,  "w": 9, "h": 7,  "label": "Workbench"},
    "break_room":      {"x": 31, "y": 9,  "w": 8, "h": 7,  "label": "Break Room"},
    "war_room":        {"x": 1,  "y": 17, "w": 19, "h": 12, "label": "War Room"},
    "lobby":           {"x": 21, "y": 17, "w": 9, "h": 12, "label": "Lobby"},
    "bulletin_board":  {"x": 31, "y": 17, "w": 8, "h": 12, "label": "Bulletin Board"},
}

# Center position for each room in PIXEL coordinates
ROOM_POSITIONS: dict[str, tuple[int, int]] = {
    name: (
        (r["x"] + r["w"] // 2) * TILE_SIZE + TILE_SIZE // 2,
        (r["y"] + r["h"] // 2) * TILE_SIZE + TILE_SIZE // 2,
    )
    for name, r in ROOMS.items()
}

# War room seats around the conference table (7 seats for 7 agents)
# Table center is at ROOM_POSITIONS["war_room"] ≈ (168, 376)
_wr = ROOMS["war_room"]
_wcx = (_wr["x"] + _wr["w"] // 2) * TILE_SIZE + TILE_SIZE // 2
_wcy = (_wr["y"] + _wr["h"] // 2) * TILE_SIZE + TILE_SIZE // 2

WAR_ROOM_SEATS: list[tuple[int, int]] = [
    (_wcx - 56, _wcy - 36),  # top-left
    (_wcx,      _wcy - 36),  # top-center
    (_wcx + 56, _wcy - 36),  # top-right
    (_wcx - 56, _wcy + 36),  # bottom-left
    (_wcx,      _wcy + 36),  # bottom-center
    (_wcx + 56, _wcy + 36),  # bottom-right
    (_wcx,      _wcy + 56),  # head of table
]

# Break room has a few spots too
_br = ROOMS["break_room"]
_bcx = (_br["x"] + _br["w"] // 2) * TILE_SIZE + TILE_SIZE // 2
_bcy = (_br["y"] + _br["h"] // 2) * TILE_SIZE + TILE_SIZE // 2

BREAK_ROOM_SPOTS: list[tuple[int, int]] = [
    (_bcx - 20, _bcy - 12),
    (_bcx + 20, _bcy - 12),
    (_bcx - 20, _bcy + 16),
    (_bcx + 20, _bcy + 16),
    (_bcx,      _bcy + 28),
]

# Lobby spots
_lb = ROOMS["lobby"]
_lcx = (_lb["x"] + _lb["w"] // 2) * TILE_SIZE + TILE_SIZE // 2
_lcy = (_lb["y"] + _lb["h"] // 2) * TILE_SIZE + TILE_SIZE // 2

LOBBY_SPOTS: list[tuple[int, int]] = [
    (_lcx - 40, _lcy - 20),
    (_lcx,      _lcy - 20),
    (_lcx + 40, _lcy - 20),
    (_lcx - 40, _lcy + 20),
    (_lcx,      _lcy + 20),
    (_lcx + 40, _lcy + 20),
    (_lcx,      _lcy + 40),
]

# Bulletin board spots
_bb = ROOMS["bulletin_board"]
_bbcx = (_bb["x"] + _bb["w"] // 2) * TILE_SIZE + TILE_SIZE // 2
_bbcy = (_bb["y"] + _bb["h"] // 2) * TILE_SIZE + TILE_SIZE // 2

BULLETIN_SPOTS: list[tuple[int, int]] = [
    (_bbcx - 20, _bbcy - 20),
    (_bbcx + 20, _bbcy - 20),
    (_bbcx - 20, _bbcy + 20),
    (_bbcx + 20, _bbcy + 20),
    (_bbcx,      _bbcy + 40),
]

SANDBOX_ROOMS = (
    "sandbox_cove",
    "sandbox_bridge",
    "sandbox_hollow",
    "sandbox_bench",
)


def _sandbox_spots(room: str) -> list[tuple[int, int]]:
    """Small gathering spots around one sandbox hut."""

    cx, cy = ROOM_POSITIONS[room]
    return [
        (cx - 18, cy - 10),
        (cx + 18, cy - 10),
        (cx - 20, cy + 14),
        (cx + 20, cy + 14),
        (cx, cy + 28),
        (cx, cy - 26),
    ]


# Track seat assignments per room
_room_assignments: dict[str, dict[str, int]] = {
    "war_room": {},
    "break_room": {},
    "lobby": {},
    "bulletin_board": {},
}

_ROOM_SPOTS: dict[str, list[tuple[int, int]]] = {
    "war_room": WAR_ROOM_SEATS,
    "break_room": BREAK_ROOM_SPOTS,
    "lobby": LOBBY_SPOTS,
    "bulletin_board": BULLETIN_SPOTS,
}

for _room in SANDBOX_ROOMS:
    _room_assignments[_room] = {}
    _ROOM_SPOTS[_room] = _sandbox_spots(_room)


def get_room_position(room: str, agent_name: str) -> tuple[int, int]:
    """Get a unique position within a room for an agent (avoids overlap)."""
    spots = _ROOM_SPOTS.get(room)
    if spots:
        assignments = _room_assignments.setdefault(room, {})
        if agent_name not in assignments:
            taken = set(assignments.values())
            for i in range(len(spots)):
                if i not in taken:
                    assignments[agent_name] = i
                    break
            else:
                return ROOM_POSITIONS.get(room, (320, 240))
        return spots[assignments[agent_name]]

    # For desks and other rooms, use the center
    return ROOM_POSITIONS.get(room, (320, 240))


def release_room_seat(room: str, agent_name: str) -> None:
    """Free up an agent's seat when they leave a room."""
    if room in _room_assignments:
        _room_assignments[room].pop(agent_name, None)


def move_toward(
    current: tuple[int, int], target: tuple[int, int], speed: int = 8
) -> tuple[int, int]:
    """Move *current* position toward *target* by up to *speed* pixels.

    Uses simple linear interpolation with no obstacle avoidance (MVP).
    """
    dx = target[0] - current[0]
    dy = target[1] - current[1]
    dist = max(abs(dx), abs(dy), 1)
    if dist <= speed:
        return target
    ratio = speed / dist
    return (current[0] + int(dx * ratio), current[1] + int(dy * ratio))


def room_for_position(x: int, y: int) -> str | None:
    """Return the room name that contains the pixel position (x, y), or None."""
    tx = x // TILE_SIZE
    ty = y // TILE_SIZE
    for name, r in ROOMS.items():
        if r["x"] <= tx < r["x"] + r["w"] and r["y"] <= ty < r["y"] + r["h"]:
            return name
    return None
