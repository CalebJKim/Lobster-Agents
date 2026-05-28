// WebSocket event types — discriminated union mirroring backend emissions.
//
// Keep in sync with the broadcast() / send_json() call sites in:
//   backend/src/office_agents/agents/orchestrator.py
//   backend/src/office_agents/sandbox_runtime/manager.py
//   backend/src/office_agents/reef/{idle_chat,query_workflow}.py
//   backend/src/office_agents/routes/{ws,sandbox}.py
//
// Inbound (client -> server) types are in `WSClientMessage`.

import type {
  AgentInfo,
  AgentState,
  BulletinPost,
  Position,
  Room,
  WhiteboardEntry,
} from "./index";

// Action verbs the orchestrator emits inside an `agent_action` payload.
// Keep aligned with backend/src/office_agents/models.py::ActionType.
export type AgentAction =
  | "move_to"
  | "speak"
  | "announce"
  | "research"
  | "read_file"
  | "code"
  | "post_bulletin"
  | "write_whiteboard"
  | "think"
  | "ask_user"
  | "idle";

export interface SandboxViolation {
  agent: string;
  kind: "policy" | "skill";
  label: string;
  snippet: string;
}

// `office` payload nested inside `full_state`. Mirrors OfficeState fields the
// backend serializes (currently a subset of the in-memory state).
export interface BackendOfficeSnapshot {
  current_query?: string | null;
  bulletin_posts?: BulletinPost[];
  whiteboard?: WhiteboardEntry[];
}

// Backend agent snapshot inside `full_state.agents`. Looser than AgentInfo
// because some fields may be omitted; useWebSocket normalizes them.
export interface BackendAgentSnapshot {
  name: string;
  role: AgentInfo["role"];
  state?: AgentState;
  location?: Room;
  position?: Position;
  current_task?: string | null;
  openclaw_capable?: boolean;
  claw_id?: string;
  sandbox_name?: string;
  connect_command?: string;
  tools?: string[];
  openclaw_skills?: string[];
  color?: string | null;
  appearance?: AgentInfo["appearance"];
}

// ----------------------------------------------------------------------------
// Server -> client events
// ----------------------------------------------------------------------------

export type WSServerEvent =
  // Full snapshot, sent on connect and every 5 ticks.
  | {
      type: "full_state";
      agents?: BackendAgentSnapshot[];
      office?: BackendOfficeSnapshot;
      sandbox_assignments?: Record<string, string[]>;
      tick?: number;
    }

  // One agent took an action. The action verb is in `action`; payload fields
  // vary by action but the orchestrator emits them uniformly.
  | {
      type: "agent_action";
      agent: string;
      action: AgentAction | string;
      content: string;
      target?: string | null;
      position?: Position;
      state?: AgentState;
      location?: Room;
      current_task?: string | null;
      claw_id?: string;
      sandbox_name?: string;
      connect_command?: string;
    }

  // Names of lobsters about to make an LLM call. Drives the spinner badges.
  | { type: "agents_thinking"; agents: string[] }

  // Query lifecycle.
  | { type: "query_received"; query: string }
  | { type: "query_completed" }
  | { type: "query_accepted"; query: string }
  | { type: "reply_accepted"; message?: string }

  // Lobster population changes (triggered by /lobsters POST/DELETE).
  | { type: "lobster_added"; lobster: BackendAgentSnapshot }
  | { type: "lobster_removed"; name: string }

  // Sandbox assignments + runs.
  | { type: "sandbox_team_updated"; assignments: Record<string, string[]> }
  | {
      type: "sandbox_task_started";
      sandbox_name: string;
      run_id: string;
      agents: string[];
      task: string;
      mode?: "single" | "sequential" | "coordinated";
    }
  | {
      type: "sandbox_task_progress";
      sandbox_name: string;
      run_id: string;
      message: string;
      agent?: string;
      phase?: string;
    }
  | {
      type: "sandbox_task_finished";
      sandbox_name: string;
      run_id: string;
      outputs?: Record<string, string>;
      errors?: Record<string, string>;
    }
  | { type: "sandbox_task_cancelling"; sandbox_name: string; run_id: string }
  | { type: "sandbox_task_cancelled"; sandbox_name: string; run_id: string }
  | {
      type: "sandbox_console";
      sandbox_name: string;
      run_id: string;
      agent: string;
      stream: "stdout" | "stderr";
      line: string;
      timestamp: string;
    }
  | {
      // Backend emits one event per violation, not one event with a list.
      // See _detect_and_broadcast_violations in sandbox_runtime/manager.py.
      type: "sandbox_violation";
      sandbox_name: string;
      run_id: string;
      agent: string;
      claw_id?: string;
      kind: "policy" | "skill";
      label: string;
      snippet: string;
    }
  | { type: "sandbox_cleared"; sandbox_name: string; archive?: string }
  | {
      type: "sandbox_renamed";
      sandbox_name: string;
      display_name: string | null;
    }

  // Misc.
  | { type: "water_cooler_status"; enabled: boolean; topic: string | null }
  | { type: "system_warning"; message: string }
  | { type: "error"; message: string }
  | { type: "pong" };

// Narrow on the discriminator to a specific event variant.
export type WSEventOf<T extends WSServerEvent["type"]> = Extract<
  WSServerEvent,
  { type: T }
>;

// ----------------------------------------------------------------------------
// Client -> server messages
// ----------------------------------------------------------------------------

export type WSClientMessage =
  | { type: "query"; query: string }
  | { type: "reply"; message: string }
  | { type: "reset" }
  | { type: "water_cooler"; enabled?: boolean; topic?: string | null }
  | { type: "ping" };
