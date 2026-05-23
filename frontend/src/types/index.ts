// Four shared sandbox rooms (was 7, one per lobster) + the common areas.
export type Room =
  | "sandbox_cove"
  | "sandbox_hollow"
  | "sandbox_bench"
  | "sandbox_bridge"
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
  openclaw_capable?: boolean;
  claw_id?: string;
  sandbox_name?: string;
  connect_command?: string;
  /** Trait/tool labels (e.g. "web_research", "code_authoring") — soft
   *  prompt biases. Not gated. UI shows them as muted trait chips. */
  tools?: string[];
  /** Real ClawHub skill slugs installed into this lobster's OpenClaw agent
   *  via `openclaw skills install <slug> --agent <claw_id>`. These ARE
   *  real, persistent skills the agent can invoke inside the sandbox. */
  openclaw_skills?: string[];
}

export interface ChatMessage {
  id: string;
  agent: string;
  target: string | "all";
  message: string;
  timestamp: string;
  type: "speak" | "announce" | "think" | "ask_user";
  sandbox_name?: string | null;
  run_id?: string | null;
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

export interface NemoClawSandbox {
  name: string;
  display_name?: string | null;
  /** Original label from claw_config — shown as a "reset to default" hint
   *  in the rename UI. */
  default_display_name?: string | null;
  model?: string | null;
  provider?: string | null;
  policies?: string[];
  phase?: string;
  connected?: boolean;
  isDefault?: boolean;
  dashboardPort?: number;
  configured?: boolean;
  assignable?: boolean;
  live?: boolean;
  home_room?: Room;
  claw_id?: string;
  assigned_agents: string[];
  assigned_agent_details?: AgentInfo[];
  run_status?: NemoClawRunStatus | null;
}

export interface NemoClawRunStatus {
  run_id: string;
  sandbox_name: string;
  agents: string[];
  task: string;
  status: string;
  started_at?: string;
  finished_at?: string;
  cancelled_at?: string;
  cancel_requested_at?: string;
  phase?: string;
  current_agent?: string;
  last_message?: string;
  last_update_at?: string;
  outputs?: Record<string, string>;
  errors?: Record<string, string>;
  running?: boolean;
  /** "single" for one-lobster runs, "sequential" for multi-lobster.
   *  Frontend uses this to label the row honestly — multi-lobster
   *  runs are not collaborative; each agent gets its own subprocess turn. */
  mode?: "single" | "sequential" | "coordinated";
  /** Names of NemoClaw policy presets that were enabled when the run started.
   *  Empty list means the sandbox is running without any restrictive policies. */
  policies?: string[];
  /** Attempted violations detected in agent outputs — refusals to reach blocked
   *  hosts, denied tool calls, etc. Surfaced so the UI can render red rows. */
  violations?: {
    agent: string;
    kind: "policy" | "skill";
    label: string;
    snippet: string;
  }[];
}

export interface NemoClawStatus {
  available: boolean;
  nemoclaw_path?: string | null;
  openshell_path?: string | null;
  gatewayHealth?: {
    healthy?: boolean;
    state?: string;
  } | null;
  liveInference?: {
    provider?: string;
    model?: string;
  } | null;
  defaultSandbox?: string | null;
  error?: string | null;
  sandboxes: NemoClawSandbox[];
}

export interface NemoClawPolicyPreset {
  name: string;
  description: string;
  enabled: boolean;
}

export interface NemoClawPolicyStatus {
  sandbox_name: string;
  policies: NemoClawPolicyPreset[];
  raw?: string;
  error?: string | null;
}

export interface OpenClawApprovalsStatus {
  approvals_path?: string | null;
  snapshot?: {
    version?: number;
    defaults?: Record<string, unknown>;
    agents?: Record<string, unknown>;
    socket?: {
      path?: string;
    };
  } | null;
  error?: string | null;
  sandbox_name?: string | null;
  effective_policy?: string;
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
