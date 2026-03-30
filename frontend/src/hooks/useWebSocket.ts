import { useCallback, useEffect, useRef, useState } from "react";
import type { OfficeState, AgentInfo, ChatMessage, ActivityEntry } from "../types";
import { DEFAULT_AGENT_POSITIONS, AGENT_ROLES } from "../utils/sprites";
import { playSpeak, playSearch, playAnswerReady, playChatBlip } from "../utils/sounds";

const WS_URL = "ws://" + window.location.host + "/ws";
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;

function createInitialState(): OfficeState {
  const defaultAgents: AgentInfo[] = [
    { name: "Maya", role: "researcher", state: "idle", location: "desk_researcher", position: DEFAULT_AGENT_POSITIONS.Maya, current_task: null },
    { name: "Raj", role: "analyst", state: "idle", location: "desk_analyst", position: DEFAULT_AGENT_POSITIONS.Raj, current_task: null },
    { name: "Sophie", role: "critic", state: "idle", location: "desk_critic", position: DEFAULT_AGENT_POSITIONS.Sophie, current_task: null },
    { name: "Alex", role: "planner", state: "idle", location: "desk_planner", position: DEFAULT_AGENT_POSITIONS.Alex, current_task: null },
    { name: "Jordan", role: "writer", state: "idle", location: "desk_writer", position: DEFAULT_AGENT_POSITIONS.Jordan, current_task: null },
    { name: "Dev", role: "coder", state: "idle", location: "desk_coder", position: DEFAULT_AGENT_POSITIONS.Dev, current_task: null },
    { name: "Sam", role: "lead", state: "idle", location: "desk_lead", position: DEFAULT_AGENT_POSITIONS.Sam, current_task: null },
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendEvent = Record<string, any>;

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [officeState, setOfficeState] = useState<OfficeState>(createInitialState);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_BASE_DELAY);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const processEvent = useCallback((event: BackendEvent) => {
    setOfficeState((prev) => {
      const type = event.type as string;

      // ── Full state sync (sent on connect + every 5 ticks) ─────────
      if (type === "full_state") {
        const agents: AgentInfo[] = (event.agents ?? []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (a: any) => ({
            name: a.name,
            role: a.role,
            state: a.state ?? "idle",
            location: a.location ?? "",
            position: a.position ?? DEFAULT_AGENT_POSITIONS[a.name] ?? { x: 0, y: 0 },
            current_task: a.current_task ?? null,
          })
        );
        // Preserve accumulated messages/bulletin/whiteboard — don't wipe
        return {
          ...prev,
          agents: agents.length > 0 ? agents : prev.agents,
          current_query: event.office?.current_query ?? prev.current_query,
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

        // Update agent position/state
        const agents = prev.agents.map((a) => {
          if (a.name !== agentName) return a;
          return {
            ...a,
            ...(position ? { position } : {}),
            ...(state ? { state: state as AgentInfo["state"] } : {}),
            ...(location ? { location: location as AgentInfo["location"] } : {}),
            ...(event.current_task !== undefined ? { current_task: event.current_task } : {}),
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
          };
          messages = [...messages, msg];
          setTimeout(playSpeak, 0);
        } else if (action === "ask_user") {
          const msg: ChatMessage = {
            id: generateId(),
            agent: agentName,
            target: "user",
            message: content,
            timestamp: new Date().toISOString(),
            type: "ask_user",
          };
          messages = [...messages, msg];
        } else if (action === "research") {
          // Research goes to BOTH chat and activity — this is key visible action
          setTimeout(playSearch, 0);
          const searchQuery = content.length > 100 ? content.slice(0, 97) + "..." : content;
          messages = [...messages, {
            id: generateId(),
            agent: agentName,
            target: "all",
            message: `Searching: "${searchQuery}"`,
            timestamp: new Date().toISOString(),
            type: "speak" as const,
          }];
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
          messages = [...messages, {
            id: generateId(),
            agent: agentName,
            target: "all",
            message: `Writing code: ${taskDesc}`,
            timestamp: new Date().toISOString(),
            type: "speak" as const,
          }];
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

      // ── query_received ──────────────────────────────────────────────
      if (type === "query_received") {
        const q = (event.query as string) || null;
        return { ...prev, current_query: q };
      }

      // ── query_accepted (confirmation from WS submit) ────────────────
      if (type === "query_accepted") {
        return { ...prev, current_query: event.query as string };
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
        return { ...prev, messages: [...prev.messages, msg] };
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

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        reconnectDelay.current = RECONNECT_BASE_DELAY;
        console.log("[WS] Connected to Office Agents backend");
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          processEvent(data);
        } catch (e) {
          console.error("[WS] Failed to parse message:", e);
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        wsRef.current = null;
        console.log(`[WS] Disconnected. Reconnecting in ${reconnectDelay.current}ms...`);
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, RECONNECT_MAX_DELAY);
          connect();
        }, reconnectDelay.current);
      };

      ws.onerror = (err) => {
        console.error("[WS] Error:", err);
        ws.close();
      };
    } catch (err) {
      console.error("[WS] Connection failed:", err);
      reconnectTimer.current = setTimeout(() => {
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
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  const sendQuery = useCallback((query: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // If there's an active query, send as a reply instead of a new query
      setOfficeState((prev) => {
        if (prev.current_query) {
          // This is a reply to an agent question
          wsRef.current!.send(JSON.stringify({ type: "reply", message: query }));
          return {
            ...prev,
            messages: [
              ...prev.messages,
              {
                id: generateId(),
                agent: "You",
                target: "all",
                message: query,
                timestamp: new Date().toISOString(),
                type: "speak" as const,
              },
            ],
          };
        }

        // New query — send and animate agents to war room
        wsRef.current!.send(JSON.stringify({ type: "query", query }));
        const warRoomSeats = [
          { x: 112, y: 340 }, { x: 168, y: 340 }, { x: 224, y: 340 },
          { x: 112, y: 412 }, { x: 168, y: 412 }, { x: 224, y: 412 },
          { x: 168, y: 432 },
        ];
        return {
          ...prev,
          current_query: query,
          agents: prev.agents.map((a, i) => ({
            ...a,
            position: warRoomSeats[i % warRoomSeats.length],
            location: "war_room" as const,
            current_task: query,
            state: "collaborating" as const,
          })),
          messages: [
            ...prev.messages,
            {
              id: generateId(),
              agent: "You",
              target: "all",
              message: query,
              timestamp: new Date().toISOString(),
              type: "speak" as const,
            },
            {
              id: generateId(),
              agent: "Sam",
              target: "all",
              message: `On it. Team, let's head to the war room.`,
              timestamp: new Date().toISOString(),
              type: "speak" as const,
            },
          ],
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

  return { connected, officeState, sendQuery, resetOffice, setWaterCooler };
}
