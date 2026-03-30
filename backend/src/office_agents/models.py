from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class Room(str, Enum):
    desk_researcher = "desk_researcher"
    desk_analyst = "desk_analyst"
    desk_critic = "desk_critic"
    desk_planner = "desk_planner"
    desk_writer = "desk_writer"
    desk_coder = "desk_coder"
    desk_lead = "desk_lead"
    break_room = "break_room"
    war_room = "war_room"
    lobby = "lobby"
    bulletin_board = "bulletin_board"


class AgentState(str, Enum):
    idle = "idle"
    researching = "researching"
    collaborating = "collaborating"
    presenting = "presenting"
    coding = "coding"
    thinking = "thinking"
    walking = "walking"


class Position(BaseModel):
    x: int
    y: int


class ActionType(str, Enum):
    move_to = "move_to"
    speak = "speak"
    announce = "announce"
    research = "research"
    read_file = "read_file"
    code = "code"
    post_bulletin = "post_bulletin"
    write_whiteboard = "write_whiteboard"
    think = "think"
    ask_user = "ask_user"
    idle = "idle"


class Action(BaseModel):
    type: ActionType
    target: str | None = None
    content: str = ""
    metadata: dict[str, Any] | None = None
    reasoning: str = ""


class AgentInfo(BaseModel):
    name: str
    role: str
    state: AgentState
    location: str
    position: Position
    current_task: str | None = None


class OfficeEvent(BaseModel):
    type: str
    agent: str
    data: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.now)


class WSMessage(BaseModel):
    type: str
    data: dict[str, Any] = Field(default_factory=dict)


class QueryRequest(BaseModel):
    query: str
    files: list[str] | None = None
