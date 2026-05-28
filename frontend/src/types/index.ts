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

export type LobsterHeadwear = "none" | "cowboy_hat" | "baseball_cap" | "generated";
export type LobsterEyewear = "none" | "sunglasses";
export type GeneratedHeadwearKind =
  | "party_hat"
  | "wizard_hat"
  | "top_hat"
  | "crown"
  | "beanie";
export type AccessoryDecorationKind =
  | "star"
  | "dot"
  | "stripe"
  | "band"
  | "gem"
  | "pom";

export interface AccessoryDecoration {
  type: AccessoryDecorationKind;
  color: string;
  count: number;
}

export interface GeneratedHeadwear {
  kind: GeneratedHeadwearKind;
  label: string;
  primary: string;
  accent?: string | null;
  decorations?: AccessoryDecoration[];
}

export interface LobsterAppearance {
  headwear: LobsterHeadwear;
  eyewear: LobsterEyewear;
  generated_headwear?: GeneratedHeadwear | null;
}

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
  /** Optional shell color override (hex like "#ff6f61"). Set when a user
   *  builds a lobster with the color picker; null/undefined means fall back
   *  to the name-keyed default palette. */
  color?: string | null;
  /** Visual accessory slots. Defaults to none when omitted so starter lobsters
   *  keep their established silhouettes. */
  appearance?: LobsterAppearance | null;
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
  /** Live console lines streamed from OpenClaw subprocesses, keyed by sandbox name.
   *  Used by the Task Monitor to render what's actually happening during a run. */
  sandbox_consoles: Record<string, SandboxConsoleLine[]>;
}

export interface SandboxConsoleLine {
  run_id: string;
  agent: string;
  stream: "stdout" | "stderr";
  line: string;
  timestamp: string;
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

// WebSocket event union moved to ./ws.ts. Import { WSServerEvent, WSClientMessage } from there.
