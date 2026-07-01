import type {
  ReefState,
  AgentInfo,
  AccessoryDecorationKind,
  ChatMessage,
  LobsterAppearance,
  LobsterEyewear,
  GeneratedHeadwear,
  GeneratedHeadwearKind,
  LobsterHeadwear,
} from "../types";
import type { BackendAgentSnapshot } from "../types/ws";
import {
  CLAW_METADATA,
  SANDBOX_HOME_ROOMS,
  sandboxConnectCommand,
} from "../utils/claws";
import { MESSAGE_DEDUP_WINDOW } from "../utils/config";
import { isLandOfficeIdleMessage } from "../utils/messageFilters";
import { DEFAULT_AGENT_POSITIONS } from "../utils/sprites";

export function createInitialState(): ReefState {
  const defaultAgents: AgentInfo[] = [
    { name: "Clawdia", role: "researcher", species: "lobster", runtime: "openclaw", state: "idle", location: "break_room", position: DEFAULT_AGENT_POSITIONS.Clawdia, current_task: null, claw_id: CLAW_METADATA.Clawdia.clawId },
    { name: "Shelldon", role: "analyst", species: "lobster", runtime: "openclaw", state: "idle", location: "war_room", position: DEFAULT_AGENT_POSITIONS.Shelldon, current_task: null, claw_id: CLAW_METADATA.Shelldon.clawId },
    { name: "Coraline", role: "critic", species: "lobster", runtime: "openclaw", state: "idle", location: "lobby", position: DEFAULT_AGENT_POSITIONS.Coraline, current_task: null, claw_id: CLAW_METADATA.Coraline.clawId },
    { name: "Reefus", role: "planner", species: "lobster", runtime: "openclaw", state: "idle", location: "break_room", position: DEFAULT_AGENT_POSITIONS.Reefus, current_task: null, claw_id: CLAW_METADATA.Reefus.clawId },
    { name: "Pearl", role: "writer", species: "lobster", runtime: "openclaw", state: "idle", location: "lobby", position: DEFAULT_AGENT_POSITIONS.Pearl, current_task: null, claw_id: CLAW_METADATA.Pearl.clawId },
    { name: "Snips", role: "coder", species: "lobster", runtime: "openclaw", state: "idle", location: "war_room", position: DEFAULT_AGENT_POSITIONS.Snips, current_task: null, claw_id: CLAW_METADATA.Snips.clawId },
    { name: "Captain Claw", role: "lead", species: "lobster", runtime: "openclaw", state: "idle", location: "war_room", position: DEFAULT_AGENT_POSITIONS["Captain Claw"], current_task: null, claw_id: CLAW_METADATA["Captain Claw"].clawId },
  ];

  return {
    agents: defaultAgents,
    messages: [],
    activity: [],
    bulletin: [],
    whiteboard: [],
    current_query: null,
    speech_language: "en",
    thinking_agents: [],
    sandbox_consoles: {},
  };
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function chatFingerprint(msg: Pick<ChatMessage, "agent" | "target" | "message" | "type">): string {
  return [msg.agent, msg.target, msg.type, msg.message.trim()].join("\u0001");
}

export function appendUniqueMessage(messages: ChatMessage[], msg: ChatMessage): ChatMessage[] {
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

export function sanitizeAssignments(assignments: Record<string, string[]>): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [sandboxName, agentNames] of Object.entries(assignments)) {
    if (!Array.isArray(agentNames)) continue;
    next[sandboxName] = Array.from(
      new Set(agentNames.filter((name): name is string => typeof name === "string"))
    );
  }
  return next;
}

export function assignmentsFromAgents(agents: AgentInfo[]): Record<string, string[]> {
  const assignments: Record<string, string[]> = {};
  for (const agent of agents) {
    if (!agent.sandbox_name) continue;
    assignments[agent.sandbox_name] ??= [];
    assignments[agent.sandbox_name].push(agent.name);
  }
  return assignments;
}

export function applyAssignmentsToAgents(
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
export type BackendStateResponse = {
  agents?: Record<string, Record<string, unknown>>;
  current_query?: string | null;
  bulletin_posts?: unknown;
  whiteboard?: unknown;
};

export function normalizeAgentSnapshot(
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
    species: raw.species === "crab" ? "crab" : "lobster",
    runtime: typeof raw.runtime === "string" ? raw.runtime : "openclaw",
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

export function agentsFromBackendState(state: BackendStateResponse): AgentInfo[] {
  const rawAgents = state.agents;
  if (!rawAgents || typeof rawAgents !== "object") return [];
  return Object.entries(rawAgents).map(([name, raw]) => normalizeAgentSnapshot(name, raw));
}
