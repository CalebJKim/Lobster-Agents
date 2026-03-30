export type Room =
  | "desk_researcher"
  | "desk_analyst"
  | "desk_critic"
  | "desk_planner"
  | "desk_writer"
  | "desk_coder"
  | "desk_lead"
  | "break_room"
  | "war_room"
  | "lobby"
  | "bulletin_board";

export type AgentState =
  | "idle"
  | "researching"
  | "collaborating"
  | "presenting"
  | "coding"
  | "thinking"
  | "walking";

export type AgentRole =
  | "researcher"
  | "analyst"
  | "critic"
  | "planner"
  | "writer"
  | "coder"
  | "lead";

export interface Position {
  x: number;
  y: number;
}

export interface AgentInfo {
  name: string;
  role: AgentRole;
  state: AgentState;
  location: Room;
  position: Position;
  current_task: string | null;
}

export interface ChatMessage {
  id: string;
  agent: string;
  target: string | "all";
  message: string;
  timestamp: string;
  type: "speak" | "announce" | "think" | "ask_user";
}

export interface BulletinPost {
  id: string;
  agent: string;
  content: string;
  timestamp: string;
}

export interface WhiteboardEntry {
  agent: string;
  content: string;
  timestamp: string;
}

export interface ActivityEntry {
  id: string;
  agent: string;
  action: string; // research, think, move_to, code, idle, etc.
  content: string;
  timestamp: string;
}

export interface OfficeState {
  agents: AgentInfo[];
  messages: ChatMessage[];
  activity: ActivityEntry[];
  bulletin: BulletinPost[];
  whiteboard: WhiteboardEntry[];
  current_query: string | null;
  thinking_agents: string[];  // agents currently doing LLM calls
}

export type WSEvent =
  | { type: "agent_moved"; agent: string; x: number; y: number }
  | {
      type: "agent_spoke";
      agent: string;
      target: string;
      message: string;
    }
  | { type: "agent_thinking"; agent: string; thought: string }
  | {
      type: "agent_state_changed";
      agent: string;
      state: AgentState;
      location?: Room;
      current_task?: string;
    }
  | { type: "bulletin_post"; agent: string; content: string }
  | { type: "whiteboard_update"; agent: string; content: string }
  | { type: "tool_invoked"; agent: string; tool: string; query: string }
  | { type: "tool_result"; agent: string; tool: string; result: string }
  | { type: "query_received"; query: string }
  | { type: "full_state"; state: OfficeState };
