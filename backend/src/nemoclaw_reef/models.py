from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class Room(str, Enum):
    # Four shared sandbox rooms — not personal "desks" any more.
    sandbox_cove = "sandbox_cove"        # Coral Cove
    sandbox_bridge = "sandbox_bridge"    # The Bridge
    sandbox_hollow = "sandbox_hollow"    # Quill Hollow
    sandbox_bench = "sandbox_bench"      # Workbench
    # Common areas.
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


class ReefEvent(BaseModel):
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


class SandboxTeamRequest(BaseModel):
    agent_names: list[str] = Field(default_factory=list)


class SandboxCreateRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    sandbox_name: str | None = Field(default=None, min_length=3, max_length=80)
    provision: bool = True


class SandboxTaskRequest(BaseModel):
    task: str
    agent_names: list[str] | None = None


class SandboxPolicyRequest(BaseModel):
    preset: str
    enabled: bool
    dry_run: bool = True


class NetworkRuleDecisionRequest(BaseModel):
    decision: str


class NetworkRuleApproveAllRequest(BaseModel):
    include_security_flagged: bool = False


class WebSearchProviderRequest(BaseModel):
    provider: str = Field(pattern=r"^(auto|brave|duckduckgo|ollama|searxng|google|tavily)$")
    ollama_base_url: str | None = Field(default=None, max_length=240)
    rebuild_sandbox: bool = False
