import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentInfo, ChatMessage, ReefState } from "../types";
import type { WSClientMessage, WSServerEvent } from "../types/ws";
import {
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
} from "../utils/config";
import { playSpeak, playSearch, playAnswerReady } from "../utils/sounds";
import {
  agentsFromBackendState,
  appendUniqueMessage,
  applyAssignmentsToAgents,
  assignmentsFromAgents,
  createInitialState,
  generateId,
  normalizeAgentSnapshot,
  sanitizeAssignments,
} from "./reefStateModel";

const WS_URL = "ws://" + window.location.host + "/ws";

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [reefState, setReefState] = useState<ReefState>(createInitialState);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_BASE_DELAY_MS);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const connectionIdRef = useRef(0);

  const processEvent = useCallback((event: WSServerEvent) => {
    setReefState((prev) => {
      // Full snapshot (sent on connect + every 5 ticks).
      if (event.type === "full_state") {
        const reef = event.office ?? {};
        const agents: AgentInfo[] = (event.agents ?? []).map((a) =>
          normalizeAgentSnapshot(a.name, a),
        );
        const currentQuery =
          reef.current_query === undefined ? prev.current_query : reef.current_query ?? null;
        const speechLanguage =
          event.speech_language ?? reef.speech_language ?? prev.speech_language;
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
          speech_language: speechLanguage,
          bulletin: Array.isArray(reef.bulletin_posts) ? reef.bulletin_posts : prev.bulletin,
          whiteboard: Array.isArray(reef.whiteboard) ? reef.whiteboard : prev.whiteboard,
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
          species,
          runtime,
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
            ...(species ? { species } : {}),
            ...(runtime ? { runtime } : {}),
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

      if (event.type === "speech_language_status") {
        return { ...prev, speech_language: event.language };
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
        console.log("[WS] Connected to NemoClaw Reef backend");
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
      setReefState((prev) => {
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
          message: prev.speech_language === "zh"
            ? "收到。空闲的爪子们，我们到 war room 集合。"
            : "On it. Free claws, let's gather in the war room.",
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

  const resetReef = useCallback(() => {
    sendClient({ type: "reset" });
    setReefState((prev) => ({
      ...createInitialState(),
      speech_language: prev.speech_language,
    }));
  }, [sendClient]);

  const setWaterCooler = useCallback((opts: { enabled?: boolean; topic?: string | null }) => {
    sendClient({ type: "water_cooler", ...opts });
  }, [sendClient]);

  const setSpeechLanguage = useCallback((language: "en" | "zh") => {
    sendClient({ type: "speech_language", language });
    setReefState((prev) => ({ ...prev, speech_language: language }));
  }, [sendClient]);

  const refreshReefState = useCallback(async () => {
    try {
      const res = await fetch("/state", { cache: "no-store" });
      if (!res.ok) return;
      const state = await res.json();
      const agents = agentsFromBackendState(state);
      if (agents.length === 0) return;
      setReefState((prev) => ({
        ...prev,
        agents: applyAssignmentsToAgents(
          agents,
          assignmentsFromAgents(prev.agents),
          state.current_query ?? null,
          "replace"
        ),
        current_query: state.current_query ?? null,
        speech_language: state.speech_language ?? prev.speech_language,
        bulletin: Array.isArray(state.bulletin_posts) ? state.bulletin_posts : prev.bulletin,
        whiteboard: Array.isArray(state.whiteboard) ? state.whiteboard : prev.whiteboard,
      }));
    } catch (err) {
      console.warn("[state] refresh failed", err);
    }
  }, []);

  const applySandboxAssignments = useCallback((assignments: Record<string, string[]>) => {
    setReefState((prev) => ({
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
    reefState,
    sendQuery,
    resetReef,
    setWaterCooler,
    setSpeechLanguage,
    refreshReefState,
    applySandboxAssignments,
  };
}
