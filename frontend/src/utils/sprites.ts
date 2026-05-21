import type { AgentRole, AgentState, Room } from "../types";
import { SANDBOX_WORKSPACES } from "./claws";

const WORKSPACE_LABELS = Object.fromEntries(
  SANDBOX_WORKSPACES.map((workspace) => [workspace.homeRoom, workspace.displayName])
) as Partial<Record<Room, string>>;

// Agent display colors (hex strings for UI, numbers for PixiJS)
export const AGENT_COLORS: Record<string, string> = {
  Clawdia: "#4ecdc4",
  Shelldon: "#ff6b6b",
  Coraline: "#feca57",
  Reefus: "#a29bfe",
  Pearl: "#fd79a8",
  Snips: "#00b894",
  "Captain Claw": "#6c5ce7",
};

export const AGENT_COLORS_HEX: Record<string, number> = {
  Clawdia: 0x4ecdc4,
  Shelldon: 0xff6b6b,
  Coraline: 0xfeca57,
  Reefus: 0xa29bfe,
  Pearl: 0xfd79a8,
  Snips: 0x00b894,
  "Captain Claw": 0x6c5ce7,
};

export const ROLE_LABELS: Record<AgentRole, string> = {
  researcher: "Researcher",
  analyst: "Analyst",
  critic: "Critic",
  planner: "Planner",
  writer: "Writer",
  coder: "Coder",
  lead: "Lead",
};

export const STATE_ICONS: Record<AgentState, string> = {
  idle: "",
  researching: "?",
  collaborating: "@",
  presenting: "!",
  coding: "<>",
  thinking: "...",
  walking: "~",
};

// Room background colors for PixiJS (numeric hex)
export const ROOM_COLORS: Record<string, number> = {
  sandbox_cove: 0xf0ddbd,
  sandbox_hollow: 0xf0ddbd,
  sandbox_bench: 0xf0ddbd,
  sandbox_bridge: 0xf0ddbd,
  war_room: 0xd6d8c8,
  break_room: 0xcfe7db,
  lobby: 0xdce9ee,
  bulletin_board: 0xebd7b1,
};

// Room layout in tile coordinates (16px tiles, 40x30 grid = 640x480)
export interface RoomDef {
  id: Room;
  label: string;
  x: number; // tile x
  y: number; // tile y
  w: number; // tile width
  h: number; // tile height
  color: number;
}

export const ROOMS: RoomDef[] = [
  // Four shared sandbox rooms (was 7, one per lobster). Lobsters can team up
  // in any of them now, so they're communal and placed organically — the
  // 3D layout in ThreeUnderwaterMap.tsx ignores these tile coordinates and
  // uses VISUAL_ROOM_LAYOUT instead.
  {
    id: "sandbox_cove",
    label: WORKSPACE_LABELS.sandbox_cove ?? "Coral Cove",
    x: 1, y: 1, w: 9, h: 7,
    color: 0xf0ddbd,
  },
  {
    id: "sandbox_bridge",
    label: WORKSPACE_LABELS.sandbox_bridge ?? "The Bridge",
    x: 31, y: 1, w: 8, h: 7,
    color: 0xf0ddbd,
  },
  {
    id: "sandbox_hollow",
    label: WORKSPACE_LABELS.sandbox_hollow ?? "Quill Hollow",
    x: 11, y: 9, w: 9, h: 7,
    color: 0xf0ddbd,
  },
  {
    id: "sandbox_bench",
    label: WORKSPACE_LABELS.sandbox_bench ?? "Workbench",
    x: 21, y: 9, w: 9, h: 7,
    color: 0xf0ddbd,
  },

  // Break room - middle right
  {
    id: "break_room",
    label: "Shell Lounge",
    x: 31,
    y: 9,
    w: 8,
    h: 7,
    color: 0xcfe7db,
  },

  // Bottom - War Room and Lobby
  {
    id: "war_room",
    label: "Tide Table",
    x: 1,
    y: 17,
    w: 19,
    h: 12,
    color: 0xd6d8c8,
  },
  {
    id: "lobby",
    label: "Tide Pool",
    x: 21,
    y: 17,
    w: 9,
    h: 12,
    color: 0xdce9ee,
  },
  {
    id: "bulletin_board",
    label: "Notice Rock",
    x: 31,
    y: 17,
    w: 8,
    h: 12,
    color: 0xebd7b1,
  },
];

// Default positions for agents when at their desks (pixel coordinates)
export const DEFAULT_AGENT_POSITIONS: Record<string, { x: number; y: number }> =
  {
    Clawdia: { x: 5 * 16 + 8, y: 4 * 16 + 8 },
    Shelldon: { x: 15 * 16 + 8, y: 4 * 16 + 8 },
    Coraline: { x: 25 * 16 + 8, y: 4 * 16 + 8 },
    "Captain Claw": { x: 35 * 16 + 8, y: 4 * 16 + 8 },
    Reefus: { x: 5 * 16 + 8, y: 12 * 16 + 8 },
    Pearl: { x: 15 * 16 + 8, y: 12 * 16 + 8 },
    Snips: { x: 25 * 16 + 8, y: 12 * 16 + 8 },
  };

// Agent name to role mapping
export const AGENT_ROLES: Record<string, AgentRole> = {
  Clawdia: "researcher",
  Shelldon: "analyst",
  Coraline: "critic",
  Reefus: "planner",
  Pearl: "writer",
  Snips: "coder",
  "Captain Claw": "lead",
};
