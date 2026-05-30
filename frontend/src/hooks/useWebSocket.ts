import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OfficeState,
  AgentInfo,
  AccessoryDecorationKind,
  ChatMessage,
  LobsterAppearance,
  LobsterEyewear,
  GeneratedHeadwear,
  GeneratedHeadwearKind,
  LobsterHeadwear,
} from "../types";
import type { BackendAgentSnapshot, WSClientMessage, WSServerEvent } from "../types/ws";
import {
  CLAW_METADATA,
  SANDBOX_HOME_ROOMS,
  sandboxConnectCommand,
} from "../utils/claws";
import {
  MESSAGE_DEDUP_WINDOW,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
} from "../utils/config";
import { isLandOfficeIdleMessage } from "../utils/messageFilters";
import { DEFAULT_AGENT_POSITIONS } from "../utils/sprites";
import { playSpeak, playSearch, playAnswerReady } from "../utils/sounds";

const WS_URL = "ws://" + window.location.host + "/ws";

function createInitialState(): OfficeState {
  const defaultAgents: AgentInfo[] = [
    { name: "Clawdia", role: "researcher", state: "idle", location: "break_room", position: DEFAULT_AGENT_POSITIONS.Clawdia, current_task: null, claw_id: CLAW_METADATA.Clawdia.clawId },
    { name: "Shelldon", role: "analyst", state: "idle", location: "war_room", position: DEFAULT_AGENT_POSITIONS.Shelldon, current_task: null, claw_id: CLAW_METADATA.Shelldon.clawId },
    { name: "Coraline", role: "critic", state: "idle", location: "lobby", position: DEFAULT_AGENT_POSITIONS.Coraline, current_task: null, claw_id: CLAW_METADATA.Coraline.clawId },
    { name: "Reefus", role: "planner", state: "idle", location: "break_room", position: DEFAULT_AGENT_POSITIONS.Reefus, current_task: null, claw_id: CLAW_METADATA.Reefus.clawId },
    { name: "Pearl", role: "writer", state: "idle", location: "lobby", position: DEFAULT_AGENT_POSITIONS.Pearl, current_task: null, claw_id: CLAW_METADATA.Pearl.clawId },
    { name: "Snips", role: "coder", state: "idle", location: "war_room", position: DEFAULT_AGENT_POSITIONS.Snips, current_task: null, claw_id: CLAW_METADATA.Snips.clawId },
    { name: "Captain Claw", role: "lead", state: "idle", location: "war_room", position: DEFAULT_AGENT_POSITIONS["Captain Claw"], current_task: null, claw_id: CLAW_METADATA["Captain Claw"].clawId },
  ];

  return {
    agents: defaultAgents,
    messages: [],
    activity: [],
    bulletin: [],
    whiteboard: [],
    current_query: null,
    thinking_agents: [],
    sandbox_consoles: {},
  };
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function chatFingerprint(msg: Pick<ChatMessage, "agent" | "target" | "message" | "type">): string {
  return [msg.agent, msg.target, msg.type, msg.message.trim()].join("\u0001");
}

function appendUniqueMessage(messages: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  if (isLandOfficeIdleMessage(msg)) return messages;
  const key = chatFingerprint(msg);
  const duplicate = messages
    .slice(-MESSAGE_DEDUP_WINDOW)
    .some((existing) => chatFingerprint(existing) === key);
  return duplicate ? messages : [...messages, msg];
}

const DEFAULT_LOBSTER_APPEARANCE: LobsterAppearance = {
  headwear: "none",
  eyewear: "none",
  generated_headwear: null,
};

const HEADWEAR_VALUES = new Set<LobsterHeadwear>([
  "none",
  "cowboy_hat",
  "baseball_cap",
  "generated",
]);
const EYEWEAR_VALUES = new Set<LobsterEyewear>(["none", "sunglasses"]);
const GENERATED_HEADWEAR_VALUES = new Set<GeneratedHeadwearKind>([
  "party_hat",
  "wizard_hat",
  "top_hat",
  "crown",
  "beanie",
]);
const DECORATION_VALUES = new Set<AccessoryDecorationKind>([
  "star",
  "dot",
  "stripe",
  "band",
  "gem",
  "pom",
]);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function normalizeGeneratedHeadwear(raw: unknown): GeneratedHeadwear | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const kind =
    typeof value.kind === "string" && GENERATED_HEADWEAR_VALUES.has(value.kind as GeneratedHeadwearKind)
      ? (value.kind as GeneratedHeadwearKind)
      : null;
  if (!kind) return null;
  const primary = typeof value.primary === "string" && HEX_COLOR.test(value.primary)
    ? value.primary
    : "#7c3aed";
  const accent = typeof value.accent === "string" && HEX_COLOR.test(value.accent)
    ? value.accent
    : null;
  const decorations = Array.isArray(value.decorations)
    ? value.decorations
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const dec = item as Record<string, unknown>;
          const type =
            typeof dec.type === "string" && DECORATION_VALUES.has(dec.type as AccessoryDecorationKind)
              ? (dec.type as AccessoryDecorationKind)
              : null;
          if (!type) return null;
          const color = typeof dec.color === "string" && HEX_COLOR.test(dec.color)
            ? dec.color
            : accent ?? "#facc15";
          const count = typeof dec.count === "number"
            ? Math.max(1, Math.min(8, Math.round(dec.count)))
            : 1;
          return { type, color, count };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : [];
  return {
    kind,
    label: typeof value.label === "string" && value.label.trim()
      ? value.label.trim().slice(0, 36)
      : "Custom hat",
    primary,
    accent,
    decorations,
  };
}

function normalizeLobsterAppearance(raw: unknown): LobsterAppearance {
  if (!raw || typeof raw !== "object") return DEFAULT_LOBSTER_APPEARANCE;
  const value = raw as Record<string, unknown>;
  const generated_headwear = normalizeGeneratedHeadwear(value.generated_headwear);
  const headwear = typeof value.headwear === "string" && HEADWEAR_VALUES.has(value.headwear as LobsterHeadwear)
    ? value.headwear as LobsterHeadwear
    : "none";
  const eyewear = typeof value.eyewear === "string" && EYEWEAR_VALUES.has(value.eyewear as LobsterEyewear)
    ? value.eyewear as LobsterEyewear
    : "none";
  return {
    headwear: headwear === "generated" && !generated_headwear ? "none" : headwear,
    eyewear,
    generated_headwear,
  };
}

function sanitizeAssignments(assignments: Record<string, string[]>): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [sandboxName, agentNames] of Object.entries(assignments)) {
    if (!Array.isArray(agentNames)) continue;
    next[sandboxName] = Array.from(
      new Set(agentNames.filter((name): name is string => typeof name === "string"))
    );
  }
  return next;
}

function assignmentsFromAgents(agents: AgentInfo[]): Record<string, string[]> {
  const assignments: Record<string, string[]> = {};
  for (const agent of agents) {
    if (!agent.sandbox_name) continue;
    assignments[agent.sandbox_name] ??= [];
    assignments[agent.sandbox_name].push(agent.name);
  }
  return assignments;
}

function applyAssignmentsToAgents(
  agents: AgentInfo[],
  assignments: Record<string, string[]>,
  currentQuery: string | null,
  mode: "replace" | "patch" = "patch"
): AgentInfo[] {
  const cleanAssignments = sanitizeAssignments(assignments);
  const nextAssignments =
    mode === "replace"
      ? cleanAssignments
      : { ...assignmentsFromAgents(agents), ...cleanAssignments };
  const assignedSandboxByAgent = new Map<string, string>();
  for (const [sandboxName, agentNames] of Object.entries(nextAssignments)) {
    for (const agentName of agentNames ?? []) {
      assignedSandboxByAgent.set(agentName, sandboxName);
    }
  }

  return agents.map((agent) => {
    const sandboxName = assignedSandboxByAgent.get(agent.name);
    if (!sandboxName) {
      if (!agent.sandbox_name) return agent;
      return {
        ...agent,
        location: currentQuery ? "war_room" : "break_room",
        sandbox_name: undefined,
        sandbox_home_room: null,
        connect_command: undefined,
      };
    }

    const homeRoom = SANDBOX_HOME_ROOMS[sandboxName];
    if (!homeRoom) {
      console.warn("[sandbox] assignment has no physical room", { sandboxName, agent: agent.name });
      return agent;
    }

    return {
      ...agent,
      location: homeRoom,
      sandbox_name: sandboxName,
      sandbox_home_room: homeRoom,
      connect_command: sandboxConnectCommand(sandboxName),
    };
  });
}

// /state REST payload — shape is wider than any single WS event so we accept
// loose Record<string, unknown> and narrow inside the function. The agents
// dictionary uses lobster name as key (Pydantic serialized AgentState).
type BackendStateResponse = {
  agents?: Record<string, Record<string, unknown>>;
  current_query?: string | null;
  bulletin_posts?: unknown;
  whiteboard?: unknown;
};

function normalizeAgentSnapshot(
  name: string,
  a: BackendAgentSnapshot | Record<string, unknown>,
): AgentInfo {
  const raw = a as Record<string, unknown>;
  const role = raw.role as AgentInfo["role"];
  const state = (raw.state as AgentInfo["state"]) ?? "idle";
  const location = (raw.location as AgentInfo["location"]) ?? "lobby";
  const position =
    (raw.position as AgentInfo["position"]) ??
    DEFAULT_AGENT_POSITIONS[name] ??
    { x: 0, y: 0 };
  const tools = Array.isArray(raw.tools)
    ? (raw.tools as unknown[]).filter((t): t is string => typeof t === "string")
    : undefined;
  const openclaw_skills = Array.isArray(raw.openclaw_skills)
    ? (raw.openclaw_skills as unknown[]).filter(
        (t): t is string => typeof t === "string",
      )
    : undefined;
  return {
    name,
    role,
    state,
    location,
    position,
    current_task: (raw.current_task as string | null | undefined) ?? null,
    openclaw_capable: Boolean(raw.openclaw_capable ?? true),
    claw_id: (raw.claw_id as string | undefined) ?? CLAW_METADATA[name]?.clawId,
    sandbox_name:
      typeof raw.sandbox_name === "string" ? raw.sandbox_name : undefined,
    sandbox_home_room:
      typeof raw.sandbox_home_room === "string" ? raw.sandbox_home_room : null,
    connect_command:
      typeof raw.connect_command === "string" ? raw.connect_command : undefined,
    tools,
    openclaw_skills,
    // User-picked shell color from the Build a Claw form. Without this,
    // the map falls back to the name-keyed palette and every spawned
    // lobster reads as plain-coral.
    color: typeof raw.color === "string" ? raw.color : null,
    appearance: normalizeLobsterAppearance(raw.appearance),
  };
}

function agentsFromBackendState(state: BackendStateResponse): AgentInfo[] {
  const rawAgents = state.agents;
  if (!rawAgents || typeof rawAgents !== "object") return [];
  return Object.entries(rawAgents).map(([name, raw]) => normalizeAgentSnapshot(name, raw));
}

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [officeState, setOfficeState] = useState<OfficeState>(createInitialState);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_BASE_DELAY_MS);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const connectionIdRef = useRef(0);

  const processEvent = useCallback((event: WSServerEvent) => {
    setOfficeState((prev) => {
      // Full snapshot (sent on connect + every 5 ticks).
      if (event.type === "full_state") {
        const office = event.office ?? {};
        const agents: AgentInfo[] = (event.agents ?? []).map((a) =>
          normalizeAgentSnapshot(a.name, a),
        );
        const currentQuery =
          office.current_query === undefined ? prev.current_query : office.current_query ?? null;
        const sandboxAssignments = event.sandbox_assignments
          ? sanitizeAssignments(event.sandbox_assignments)
          : {};
        const hasSandboxAssignments = event.sandbox_assignments !== undefined;
        const nextAgents = hasSandboxAssignments
          ? applyAssignmentsToAgents(
              agents.length > 0 ? agents : prev.agents,
              sandboxAssignments,
              currentQuery,
              "replace",
            )
          : agents.length > 0
            ? agents
            : prev.agents;
        // Preserve accumulated messages/bulletin/whiteboard — don't wipe.
        return {
          ...prev,
          agents: nextAgents,
          current_query: currentQuery,
          bulletin: Array.isArray(office.bulletin_posts) ? office.bulletin_posts : prev.bulletin,
          whiteboard: Array.isArray(office.whiteboard) ? office.whiteboard : prev.whiteboard,
        };
      }

      // The main event type from the orchestrator — covers all 10 ActionTypes.
      if (event.type === "agent_action") {
        const {
          agent: agentName,
          action,
          content,
          target,
          position,
          state,
          location,
          claw_id: clawId,
          current_task,
        } = event;
        const hasSandboxName = "sandbox_name" in event;
        const sandboxName = event.sandbox_name;
        const hasSandboxHomeRoom = "sandbox_home_room" in event;
        const sandboxHomeRoom = event.sandbox_home_room;
        const hasConnectCommand = "connect_command" in event;
        const connectCommand = event.connect_command;

        const agents = prev.agents.map((a) => {
          if (a.name !== agentName) return a;
          return {
            ...a,
            ...(position ? { position } : {}),
            ...(state ? { state } : {}),
            ...(location ? { location } : {}),
            ...(current_task !== undefined ? { current_task } : {}),
            ...(clawId ? { claw_id: clawId } : {}),
            ...(hasSandboxName ? { sandbox_name: sandboxName } : {}),
            ...(hasSandboxHomeRoom ? { sandbox_home_room: sandboxHomeRoom } : {}),
            ...(hasConnectCommand ? { connect_command: connectCommand } : {}),
          };
        });

        let messages = prev.messages;
        let activity = prev.activity;
        let bulletin = prev.bulletin;
        let whiteboard = prev.whiteboard;

        // Key actions go to BOTH Chat (audience) and Activity (detail).
        if (action === "speak" || action === "announce") {
          messages = appendUniqueMessage(messages, {
            id: generateId(),
            agent: agentName,
            target: target ?? "all",
            message: content,
            timestamp: new Date().toISOString(),
            type: action === "announce" ? "announce" : "speak",
            sandbox_name: sandboxName ?? null,
          });
          setTimeout(playSpeak, 0);
        } else if (action === "ask_user") {
          messages = appendUniqueMessage(messages, {
            id: generateId(),
            agent: agentName,
            target: "user",
            message: content,
            timestamp: new Date().toISOString(),
            type: "ask_user",
            sandbox_name: sandboxName ?? null,
          });
        } else if (action === "research") {
          setTimeout(playSearch, 0);
          const searchQuery = content.length > 100 ? content.slice(0, 97) + "..." : content;
          messages = appendUniqueMessage(messages, {
            id: generateId(),
            agent: agentName,
            target: "all",
            message: `Searching: "${searchQuery}"`,
            timestamp: new Date().toISOString(),
            type: "speak" as const,
            sandbox_name: sandboxName ?? null,
          });
          activity = [
            ...activity,
            { id: generateId(), agent: agentName, action, content, timestamp: new Date().toISOString() },
          ];
        } else if (action === "code") {
          const taskDesc = content.length > 100 ? content.slice(0, 97) + "..." : content;
          messages = appendUniqueMessage(messages, {
            id: generateId(),
            agent: agentName,
            target: "all",
            message: `Opening OpenClaw in ${sandboxName ?? "shared reef workspace"}: ${taskDesc}`,
            timestamp: new Date().toISOString(),
            type: "speak" as const,
            sandbox_name: sandboxName,
          });
          activity = [
            ...activity,
            { id: generateId(), agent: agentName, action, content, timestamp: new Date().toISOString() },
          ];
        } else if (action === "think" || action === "move_to" || action === "idle") {
          activity = [
            ...activity,
            { id: generateId(), agent: agentName, action, content, timestamp: new Date().toISOString() },
          ];
        } else if (action === "post_bulletin") {
          bulletin = [
            ...bulletin,
            { id: generateId(), agent: agentName, content, timestamp: new Date().toISOString() },
          ];
        } else if (action === "write_whiteboard") {
          setTimeout(playAnswerReady, 0);
          whiteboard = [...whiteboard, { agent: agentName, content, timestamp: new Date().toISOString() }];
        }

        // Clear this agent from thinking list since they've acted.
        const thinking_agents = prev.thinking_agents.filter((n) => n !== agentName);
        return { ...prev, agents, messages, activity, bulletin, whiteboard, thinking_agents };
      }

      if (event.type === "agents_thinking") {
        return { ...prev, thinking_agents: event.agents ?? [] };
      }

      if (event.type === "sandbox_team_updated") {
        const assignments = event.assignments ?? {};
        return {
          ...prev,
          agents: applyAssignmentsToAgents(
            prev.agents,
            assignments,
            prev.current_query,
            Object.keys(assignments).length === 0 ? "replace" : "patch",
          ),
        };
      }

      if (event.type === "query_received") {
        return { ...prev, current_query: event.query || null };
      }

      if (event.type === "query_completed") {
        return { ...prev, current_query: null, thinking_agents: [] };
      }

      if (event.type === "query_accepted") {
        return { ...prev, current_query: event.query };
      }

      if (event.type === "sandbox_task_started") {
        const agentsLabel = event.agents.length > 0 ? event.agents.join(", ") : "team";
        return {
          ...prev,
          messages: appendUniqueMessage(prev.messages, {
            id: generateId(),
            agent: "NemoClaw",
            target: event.sandbox_name,
            message: `Run started for ${agentsLabel}.`,
            timestamp: new Date().toISOString(),
            type: "announce",
            sandbox_name: event.sandbox_name,
            run_id: event.run_id,
          }),
        };
      }

      if (event.type === "sandbox_task_finished") {
        return {
          ...prev,
          messages: appendUniqueMessage(prev.messages, {
            id: generateId(),
            agent: "NemoClaw",
            target: event.sandbox_name,
            message: "Run finished. Agent results are above.",
            timestamp: new Date().toISOString(),
            type: "announce",
            sandbox_name: event.sandbox_name,
            run_id: event.run_id,
          }),
        };
      }

      if (event.type === "sandbox_task_cancelling") {
        return {
          ...prev,
          messages: appendUniqueMessage(prev.messages, {
            id: generateId(),
            agent: "NemoClaw",
            target: event.sandbox_name,
            message: "Stop requested. Waiting for the active OpenClaw turn to unwind.",
            timestamp: new Date().toISOString(),
            type: "announce",
            sandbox_name: event.sandbox_name,
            run_id: event.run_id,
          }),
        };
      }

      if (event.type === "sandbox_console") {
        if (!event.sandbox_name || !event.line) return prev;
        const existing = prev.sandbox_consoles[event.sandbox_name] ?? [];
        // Cap to avoid unbounded memory if a long run streams thousands of lines.
        const next = [
          ...existing.slice(Math.max(0, existing.length - 999)),
          {
            run_id: event.run_id,
            agent: event.agent,
            stream: event.stream,
            line: event.line,
            timestamp: event.timestamp,
          },
        ];
        return {
          ...prev,
          sandbox_consoles: { ...prev.sandbox_consoles, [event.sandbox_name]: next },
        };
      }

      if (event.type === "sandbox_task_progress") {
        return {
          ...prev,
          messages: appendUniqueMessage(prev.messages, {
            id: generateId(),
            agent: "NemoClaw",
            target: event.sandbox_name,
            message: event.message,
            timestamp: new Date().toISOString(),
            type: "announce",
            sandbox_name: event.sandbox_name,
            run_id: event.run_id,
          }),
        };
      }

      if (event.type === "sandbox_task_cancelled") {
        return {
          ...prev,
          messages: appendUniqueMessage(prev.messages, {
            id: generateId(),
            agent: "NemoClaw",
            target: event.sandbox_name,
            message: "Run cancelled.",
            timestamp: new Date().toISOString(),
            type: "announce",
            sandbox_name: event.sandbox_name,
            run_id: event.run_id,
          }),
        };
      }

      if (event.type === "sandbox_cleared") {
        if (!event.sandbox_name) return prev;
        const { [event.sandbox_name]: _cleared, ...sandbox_consoles } = prev.sandbox_consoles;
        void _cleared;
        return {
          ...prev,
          sandbox_consoles,
          messages: appendUniqueMessage(
            prev.messages.filter((m) => m.sandbox_name !== event.sandbox_name),
            {
              id: generateId(),
              agent: "NemoClaw",
              target: event.sandbox_name,
              message: "Sandbox cleared. Old workspace files were archived.",
              timestamp: new Date().toISOString(),
              type: "announce",
              sandbox_name: event.sandbox_name,
            },
          ),
        };
      }

      // Backend-side incidents — surface them in chat so the user sees the
      // warning even between state snapshots. HealthBanner handles persistent
      // outages via /health polling; StatusTab renders the running violations
      // list from run_status. This branch covers the transient gap.
      if (event.type === "system_warning") {
        return {
          ...prev,
          messages: appendUniqueMessage(prev.messages, {
            id: generateId(),
            agent: "System",
            target: "all",
            message: `⚠️ ${event.message}`,
            timestamp: new Date().toISOString(),
            type: "announce",
          }),
        };
      }

      if (event.type === "sandbox_violation") {
        return {
          ...prev,
          messages: appendUniqueMessage(prev.messages, {
            id: generateId(),
            agent: "NemoClaw",
            target: event.sandbox_name,
            message: `🔒 ${event.agent} hit "${event.label}" — see Task Monitor.`,
            timestamp: new Date().toISOString(),
            type: "announce",
            sandbox_name: event.sandbox_name,
            run_id: event.run_id,
          }),
        };
      }

      // Other backend-emitted types (lobster_added, lobster_removed,
      // sandbox_renamed, water_cooler_status, reply_accepted, error, pong)
      // are not yet acted on here — they reconcile via the next `full_state` snapshot.
      return prev;
    });
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      const connectionId = connectionIdRef.current + 1;
      connectionIdRef.current = connectionId;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current || wsRef.current !== ws || connectionIdRef.current !== connectionId) {
          return;
        }
        setConnected(true);
        reconnectDelay.current = RECONNECT_BASE_DELAY_MS;
        console.log("[WS] Connected to Office Agents backend");
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current || wsRef.current !== ws || connectionIdRef.current !== connectionId) {
          return;
        }
        try {
          const data = JSON.parse(event.data);
          // The discriminated union is asserted here at the boundary. Any
          // unrecognized `type` simply falls through processEvent's switch
          // and is ignored — there's no runtime crash on contract drift.
          if (data && typeof data === "object" && typeof data.type === "string") {
            processEvent(data as WSServerEvent);
          } else {
            console.warn("[WS] Dropping malformed message:", data);
          }
        } catch (e) {
          console.error("[WS] Failed to parse message:", e);
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        if (!mountedRef.current || connectionIdRef.current !== connectionId) return;
        setConnected(false);
        console.log(`[WS] Disconnected. Reconnecting in ${reconnectDelay.current}ms...`);
        reconnectTimer.current = setTimeout(() => {
          reconnectTimer.current = null;
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_MAX_DELAY_MS);
          connect();
        }, reconnectDelay.current);
      };

      ws.onerror = (err) => {
        if (wsRef.current !== ws || connectionIdRef.current !== connectionId) return;
        console.error("[WS] Error:", err);
        ws.close();
      };
    } catch (err) {
      console.error("[WS] Connection failed:", err);
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_MAX_DELAY_MS);
        connect();
      }, reconnectDelay.current);
    }
  }, [processEvent]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      connectionIdRef.current += 1;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) ws.close();
    };
  }, [connect]);

  const sendClient = useCallback((msg: WSClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const sendQuery = useCallback((query: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // If there's an active query, send as a reply instead of a new query
      setOfficeState((prev) => {
        if (prev.current_query) {
          // This is a reply to an agent question
          sendClient({ type: "reply", message: query });
          const userMessage: ChatMessage = {
            id: generateId(),
            agent: "You",
            target: "all",
            message: query,
            timestamp: new Date().toISOString(),
            type: "speak" as const,
          };
          return {
            ...prev,
            messages: appendUniqueMessage(prev.messages, userMessage),
          };
        }

        // New query: free lobsters gather in the war room immediately.
        // Sandbox-assigned lobsters stay reserved for sandbox-specific work.
        sendClient({ type: "query", query });
        const warRoomSeats = [
          { x: 112, y: 340 }, { x: 168, y: 340 }, { x: 224, y: 340 },
          { x: 112, y: 412 }, { x: 168, y: 412 }, { x: 224, y: 412 },
          { x: 168, y: 432 },
        ];
        const userMessage: ChatMessage = {
          id: generateId(),
          agent: "You",
          target: "all",
          message: query,
          timestamp: new Date().toISOString(),
          type: "speak" as const,
        };
        const captainMessage: ChatMessage = {
          id: generateId(),
          agent: "Captain Claw",
          target: "all",
          message: `On it. Free claws, let's gather in the war room.`,
          timestamp: new Date().toISOString(),
          type: "speak" as const,
        };
        return {
          ...prev,
          current_query: query,
          agents: prev.agents.map((a, i) => {
            if (a.state === "coding") return a;
            if (a.sandbox_name) return a;
            return {
              ...a,
              position: warRoomSeats[i % warRoomSeats.length],
              location: "war_room" as const,
              current_task: query,
              state: "collaborating" as const,
            };
          }),
          messages: appendUniqueMessage(appendUniqueMessage(prev.messages, userMessage), captainMessage),
        };
      });
    } else {
      console.warn("[WS] Cannot send query - not connected");
    }
  }, [sendClient]);

  const resetOffice = useCallback(() => {
    sendClient({ type: "reset" });
    setOfficeState(createInitialState());
  }, [sendClient]);

  const setWaterCooler = useCallback((opts: { enabled?: boolean; topic?: string | null }) => {
    sendClient({ type: "water_cooler", ...opts });
  }, [sendClient]);

  const refreshOfficeState = useCallback(async () => {
    try {
      const res = await fetch("/state", { cache: "no-store" });
      if (!res.ok) return;
      const state = await res.json();
      const agents = agentsFromBackendState(state);
      if (agents.length === 0) return;
      setOfficeState((prev) => ({
        ...prev,
        agents: applyAssignmentsToAgents(
          agents,
          assignmentsFromAgents(prev.agents),
          state.current_query ?? null,
          "replace"
        ),
        current_query: state.current_query ?? null,
        bulletin: Array.isArray(state.bulletin_posts) ? state.bulletin_posts : prev.bulletin,
        whiteboard: Array.isArray(state.whiteboard) ? state.whiteboard : prev.whiteboard,
      }));
    } catch (err) {
      console.warn("[state] refresh failed", err);
    }
  }, []);

  const applySandboxAssignments = useCallback((assignments: Record<string, string[]>) => {
    setOfficeState((prev) => ({
      ...prev,
      agents: applyAssignmentsToAgents(
        prev.agents,
        assignments,
        prev.current_query,
        Object.keys(assignments).length === 0 ? "replace" : "patch"
      ),
    }));
  }, []);

  return {
    connected,
    officeState,
    sendQuery,
    resetOffice,
    setWaterCooler,
    refreshOfficeState,
    applySandboxAssignments,
  };
}
