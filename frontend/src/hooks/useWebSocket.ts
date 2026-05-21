import { useCallback, useEffect, useRef, useState } from "react";
import type { OfficeState, AgentInfo, ChatMessage, ActivityEntry } from "../types";
import {
  CLAW_METADATA,
  SANDBOX_HOME_ROOMS,
  sandboxConnectCommand,
} from "../utils/claws";
import { isLandOfficeIdleMessage } from "../utils/messageFilters";
import { DEFAULT_AGENT_POSITIONS } from "../utils/sprites";
import { playSpeak, playSearch, playAnswerReady } from "../utils/sounds";

const WS_URL = "ws://" + window.location.host + "/ws";
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;

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
  const duplicate = messages.slice(-12).some((existing) => chatFingerprint(existing) === key);
  return duplicate ? messages : [...messages, msg];
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
      connect_command: sandboxConnectCommand(sandboxName),
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendEvent = Record<string, any>;

function agentsFromBackendState(state: BackendEvent): AgentInfo[] {
  const rawAgents = state.agents;
  if (!rawAgents || typeof rawAgents !== "object") return [];

  return Object.entries(rawAgents).map(([name, raw]) => {
    const a = raw as BackendEvent;
    return {
      name,
      role: a.role,
      state: a.state ?? "idle",
      location: a.location ?? "lobby",
      position: a.position ?? DEFAULT_AGENT_POSITIONS[name] ?? { x: 0, y: 0 },
      current_task: a.current_task ?? null,
      openclaw_capable: Boolean(a.openclaw_capable ?? true),
      claw_id: a.claw_id ?? CLAW_METADATA[name]?.clawId,
      sandbox_name: typeof a.sandbox_name === "string" ? a.sandbox_name : undefined,
      connect_command: typeof a.connect_command === "string" ? a.connect_command : undefined,
    } as AgentInfo;
  });
}

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [officeState, setOfficeState] = useState<OfficeState>(createInitialState);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_BASE_DELAY);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const connectionIdRef = useRef(0);

  const processEvent = useCallback((event: BackendEvent) => {
    setOfficeState((prev) => {
      const type = event.type as string;

      // ── Full state sync (sent on connect + every 5 ticks) ─────────
      if (type === "full_state") {
        const office = event.office && typeof event.office === "object" ? event.office : {};
        const agents: AgentInfo[] = (event.agents ?? []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (a: any) => ({
            name: a.name,
            role: a.role,
            state: a.state ?? "idle",
            location: a.location ?? "",
            position: a.position ?? DEFAULT_AGENT_POSITIONS[a.name] ?? { x: 0, y: 0 },
            current_task: a.current_task ?? null,
            openclaw_capable: Boolean(a.openclaw_capable ?? true),
            claw_id: a.claw_id ?? CLAW_METADATA[a.name]?.clawId,
            sandbox_name: typeof a.sandbox_name === "string" ? a.sandbox_name : undefined,
            connect_command: typeof a.connect_command === "string" ? a.connect_command : undefined,
          })
        );
        const currentQuery = Object.prototype.hasOwnProperty.call(office, "current_query")
          ? (office.current_query || null)
          : prev.current_query;
        const sandboxAssignments =
          event.sandbox_assignments && typeof event.sandbox_assignments === "object"
            ? sanitizeAssignments(event.sandbox_assignments as Record<string, string[]>)
            : {};
        const hasSandboxAssignments = Object.prototype.hasOwnProperty.call(event, "sandbox_assignments");
        const nextAgents = hasSandboxAssignments
          ? applyAssignmentsToAgents(
              agents.length > 0 ? agents : prev.agents,
              sandboxAssignments,
              currentQuery,
              "replace"
            )
          : agents.length > 0
            ? agents
            : prev.agents;
        // Preserve accumulated messages/bulletin/whiteboard — don't wipe
        return {
          ...prev,
          agents: nextAgents,
          current_query: currentQuery,
          bulletin: Array.isArray(office.bulletin_posts) ? office.bulletin_posts : prev.bulletin,
          whiteboard: Array.isArray(office.whiteboard) ? office.whiteboard : prev.whiteboard,
        };
      }

      // ── agent_action: the main event type from backend orchestrator ─
      if (type === "agent_action") {
        const agentName = event.agent as string;
        const action = event.action as string;
        const content = event.content as string;
        const target = event.target as string | null;
        const position = event.position as { x: number; y: number } | undefined;
        const state = event.state as string | undefined;
        const location = event.location as string | undefined;
        const clawId = event.claw_id as string | undefined;
        const hasSandboxName = Object.prototype.hasOwnProperty.call(event, "sandbox_name");
        const sandboxName = typeof event.sandbox_name === "string" ? event.sandbox_name : undefined;
        const hasConnectCommand = Object.prototype.hasOwnProperty.call(event, "connect_command");
        const connectCommand = typeof event.connect_command === "string" ? event.connect_command : undefined;

        // Update agent position/state
        const agents = prev.agents.map((a) => {
          if (a.name !== agentName) return a;
          return {
            ...a,
            ...(position ? { position } : {}),
            ...(state ? { state: state as AgentInfo["state"] } : {}),
            ...(location ? { location: location as AgentInfo["location"] } : {}),
            ...(event.current_task !== undefined ? { current_task: event.current_task } : {}),
            ...(clawId ? { claw_id: clawId } : {}),
            ...(hasSandboxName ? { sandbox_name: sandboxName } : {}),
            ...(hasConnectCommand ? { connect_command: connectCommand } : {}),
          };
        });

        let messages = prev.messages;
        let activity = prev.activity;
        let bulletin = prev.bulletin;
        let whiteboard = prev.whiteboard;

        // Create chat message based on action type
        // Key actions go to BOTH Chat (for audience) and Activity (for detail)
        if (action === "speak" || action === "announce") {
          const msg: ChatMessage = {
            id: generateId(),
            agent: agentName,
            target: target ?? "all",
            message: content,
            timestamp: new Date().toISOString(),
            type: action === "announce" ? "announce" : "speak",
            sandbox_name: sandboxName ?? null,
          };
          messages = appendUniqueMessage(messages, msg);
          setTimeout(playSpeak, 0);
        } else if (action === "ask_user") {
          const msg: ChatMessage = {
            id: generateId(),
            agent: agentName,
            target: "user",
            message: content,
            timestamp: new Date().toISOString(),
            type: "ask_user",
            sandbox_name: sandboxName ?? null,
          };
          messages = appendUniqueMessage(messages, msg);
        } else if (action === "research") {
          // Research goes to BOTH chat and activity — this is key visible action
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
          activity = [...activity, {
            id: generateId(),
            agent: agentName,
            action,
            content: content ?? "",
            timestamp: new Date().toISOString(),
          }];
        } else if (action === "code") {
          // Code actions are interesting — show in chat
          const taskDesc = content.length > 100 ? content.slice(0, 97) + "..." : content;
          const sandbox = sandboxName;
          messages = appendUniqueMessage(messages, {
            id: generateId(),
            agent: agentName,
            target: "all",
            message: `Opening OpenClaw in ${sandbox ?? "shared reef workspace"}: ${taskDesc}`,
            timestamp: new Date().toISOString(),
            type: "speak" as const,
            sandbox_name: sandbox,
          });
          activity = [...activity, {
            id: generateId(),
            agent: agentName,
            action,
            content: content ?? "",
            timestamp: new Date().toISOString(),
          }];
        } else if (action === "think" || action === "move_to" || action === "idle") {
          // Only activity tab for these
          activity = [...activity, {
            id: generateId(),
            agent: agentName,
            action,
            content: content ?? "",
            timestamp: new Date().toISOString(),
          }];
        } else if (action === "post_bulletin") {
          bulletin = [
            ...bulletin,
            { id: generateId(), agent: agentName, content, timestamp: new Date().toISOString() },
          ];
        } else if (action === "write_whiteboard") {
          setTimeout(playAnswerReady, 0);
          whiteboard = [
            ...whiteboard,
            { agent: agentName, content, timestamp: new Date().toISOString() },
          ];
        }

        // Clear this agent from thinking list since they've acted
        const thinking_agents = prev.thinking_agents.filter((n) => n !== agentName);
        return { ...prev, agents, messages, activity, bulletin, whiteboard, thinking_agents };
      }

      // ── agents_thinking: broadcast before each LLM batch ────────────
      if (type === "agents_thinking") {
        return { ...prev, thinking_agents: (event.agents as string[]) ?? [] };
      }

      if (type === "sandbox_team_updated") {
        const assignments =
          event.assignments && typeof event.assignments === "object"
            ? (event.assignments as Record<string, string[]>)
            : {};
        return {
          ...prev,
          agents: applyAssignmentsToAgents(
            prev.agents,
            assignments,
            prev.current_query,
            Object.keys(assignments).length === 0 ? "replace" : "patch"
          ),
        };
      }

      // ── query_received ──────────────────────────────────────────────
      if (type === "query_received") {
        const q = (event.query as string) || null;
        return { ...prev, current_query: q };
      }

      if (type === "query_completed") {
        return { ...prev, current_query: null, thinking_agents: [] };
      }

      // ── query_accepted (confirmation from WS submit) ────────────────
      if (type === "query_accepted") {
        return { ...prev, current_query: event.query as string };
      }

      if (type === "sandbox_task_started") {
        const sandboxName = typeof event.sandbox_name === "string" ? event.sandbox_name : undefined;
        const runId = typeof event.run_id === "string" ? event.run_id : undefined;
        const agents = Array.isArray(event.agents) ? event.agents.join(", ") : "team";
        const msg: ChatMessage = {
          id: generateId(),
          agent: "NemoClaw",
          target: sandboxName ?? "all",
          message: `Run started for ${agents}.`,
          timestamp: new Date().toISOString(),
          type: "announce",
          sandbox_name: sandboxName ?? null,
          run_id: runId ?? null,
        };
        return { ...prev, messages: appendUniqueMessage(prev.messages, msg) };
      }

      if (type === "sandbox_task_finished") {
        const sandboxName = typeof event.sandbox_name === "string" ? event.sandbox_name : undefined;
        const runId = typeof event.run_id === "string" ? event.run_id : undefined;
        const msg: ChatMessage = {
          id: generateId(),
          agent: "NemoClaw",
          target: sandboxName ?? "all",
          message: "Run finished. Agent results are above.",
          timestamp: new Date().toISOString(),
          type: "announce",
          sandbox_name: sandboxName ?? null,
          run_id: runId ?? null,
        };
        return { ...prev, messages: appendUniqueMessage(prev.messages, msg) };
      }

      if (type === "sandbox_task_cancelling") {
        const sandboxName = typeof event.sandbox_name === "string" ? event.sandbox_name : undefined;
        const runId = typeof event.run_id === "string" ? event.run_id : undefined;
        const msg: ChatMessage = {
          id: generateId(),
          agent: "NemoClaw",
          target: sandboxName ?? "all",
          message: "Stop requested. Waiting for the active OpenClaw turn to unwind.",
          timestamp: new Date().toISOString(),
          type: "announce",
          sandbox_name: sandboxName ?? null,
          run_id: runId ?? null,
        };
        return { ...prev, messages: appendUniqueMessage(prev.messages, msg) };
      }

      if (type === "sandbox_task_progress") {
        const sandboxName = typeof event.sandbox_name === "string" ? event.sandbox_name : undefined;
        const runId = typeof event.run_id === "string" ? event.run_id : undefined;
        const msg: ChatMessage = {
          id: generateId(),
          agent: "NemoClaw",
          target: sandboxName ?? "all",
          message: String(event.message ?? "Sandbox run is progressing."),
          timestamp: new Date().toISOString(),
          type: "announce",
          sandbox_name: sandboxName ?? null,
          run_id: runId ?? null,
        };
        return { ...prev, messages: appendUniqueMessage(prev.messages, msg) };
      }

      if (type === "sandbox_task_cancelled") {
        const sandboxName = typeof event.sandbox_name === "string" ? event.sandbox_name : undefined;
        const runId = typeof event.run_id === "string" ? event.run_id : undefined;
        const msg: ChatMessage = {
          id: generateId(),
          agent: "NemoClaw",
          target: sandboxName ?? "all",
          message: "Run cancelled.",
          timestamp: new Date().toISOString(),
          type: "announce",
          sandbox_name: sandboxName ?? null,
          run_id: runId ?? null,
        };
        return { ...prev, messages: appendUniqueMessage(prev.messages, msg) };
      }

      // ── Legacy / specific event types (fallback) ────────────────────
      if (type === "agent_moved") {
        const agents = prev.agents.map((a) =>
          a.name === event.agent ? { ...a, position: { x: event.x, y: event.y } } : a
        );
        return { ...prev, agents };
      }

      if (type === "agent_spoke") {
        const msg: ChatMessage = {
          id: generateId(),
          agent: event.agent,
          target: event.target,
          message: event.message,
          timestamp: new Date().toISOString(),
          type: "speak",
        };
        return { ...prev, messages: appendUniqueMessage(prev.messages, msg) };
      }

      if (type === "agent_thinking") {
        const entry: ActivityEntry = {
          id: generateId(),
          agent: event.agent,
          action: "think",
          content: event.thought,
          timestamp: new Date().toISOString(),
        };
        return { ...prev, activity: [...prev.activity, entry] };
      }

      if (type === "agent_state_changed") {
        const agents = prev.agents.map((a) =>
          a.name === event.agent
            ? {
                ...a,
                state: event.state,
                ...(event.location ? { location: event.location } : {}),
                ...(event.current_task !== undefined ? { current_task: event.current_task } : {}),
              }
            : a
        );
        return { ...prev, agents };
      }

      if (type === "bulletin_post") {
        const post = {
          id: generateId(),
          agent: event.agent,
          content: event.content,
          timestamp: new Date().toISOString(),
        };
        return { ...prev, bulletin: [...prev.bulletin, post] };
      }

      if (type === "whiteboard_update") {
        const entry = {
          agent: event.agent,
          content: event.content,
          timestamp: new Date().toISOString(),
        };
        return { ...prev, whiteboard: [...prev.whiteboard, entry] };
      }

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
        reconnectDelay.current = RECONNECT_BASE_DELAY;
        console.log("[WS] Connected to Office Agents backend");
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current || wsRef.current !== ws || connectionIdRef.current !== connectionId) {
          return;
        }
        try {
          const data = JSON.parse(event.data);
          processEvent(data);
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
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_MAX_DELAY);
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
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_MAX_DELAY);
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

  const sendQuery = useCallback((query: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // If there's an active query, send as a reply instead of a new query
      setOfficeState((prev) => {
        if (prev.current_query) {
          // This is a reply to an agent question
          wsRef.current!.send(JSON.stringify({ type: "reply", message: query }));
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
        wsRef.current!.send(JSON.stringify({ type: "query", query }));
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
  }, []);

  const resetOffice = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "reset" }));
    }
    setOfficeState(createInitialState());
  }, []);

  const setWaterCooler = useCallback((opts: { enabled?: boolean; topic?: string | null }) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "water_cooler", ...opts }));
    }
  }, []);

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
