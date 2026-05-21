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
  desk_researcher: 0xf0ddbd,
  desk_analyst: 0xf0ddbd,
  desk_critic: 0xf0ddbd,
  desk_planner: 0xf0ddbd,
  desk_writer: 0xf0ddbd,
  desk_coder: 0xf0ddbd,
  desk_lead: 0xf0ddbd,
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
  // Top row - individual desks
  {
    id: "desk_researcher",
    label: WORKSPACE_LABELS.desk_researcher ?? "Reef Workspace",
    x: 1,
    y: 1,
    w: 9,
    h: 7,
    color: 0xf0ddbd,
  },
  {
    id: "desk_analyst",
    label: WORKSPACE_LABELS.desk_analyst ?? "Charts Workspace",
    x: 11,
    y: 1,
    w: 9,
    h: 7,
    color: 0xf0ddbd,
  },
  {
    id: "desk_critic",
    label: WORKSPACE_LABELS.desk_critic ?? "Review Workspace",
    x: 21,
    y: 1,
    w: 9,
    h: 7,
    color: 0xf0ddbd,
  },
  {
    id: "desk_lead",
    label: WORKSPACE_LABELS.desk_lead ?? "Bridge Workspace",
    x: 31,
    y: 1,
    w: 8,
    h: 7,
    color: 0xf0ddbd,
  },

  // Middle row
  {
    id: "desk_planner",
    label: WORKSPACE_LABELS.desk_planner ?? "Route Workspace",
    x: 1,
    y: 9,
    w: 9,
    h: 7,
    color: 0xf0ddbd,
  },
  {
    id: "desk_writer",
    label: WORKSPACE_LABELS.desk_writer ?? "Writing Workspace",
    x: 11,
    y: 9,
    w: 9,
    h: 7,
    color: 0xf0ddbd,
  },
  {
    id: "desk_coder",
    label: WORKSPACE_LABELS.desk_coder ?? "Workbench Workspace",
    x: 21,
    y: 9,
    w: 9,
    h: 7,
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
