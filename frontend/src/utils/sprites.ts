import type { AgentRole, AgentState, Room } from "../types";

// Agent display colors (hex strings for UI, numbers for PixiJS)
export const AGENT_COLORS: Record<string, string> = {
  Maya: "#4ecdc4",
  Raj: "#ff6b6b",
  Sophie: "#feca57",
  Alex: "#a29bfe",
  Jordan: "#fd79a8",
  Dev: "#00b894",
  Sam: "#6c5ce7",
};

export const AGENT_COLORS_HEX: Record<string, number> = {
  Maya: 0x4ecdc4,
  Raj: 0xff6b6b,
  Sophie: 0xfeca57,
  Alex: 0xa29bfe,
  Jordan: 0xfd79a8,
  Dev: 0x00b894,
  Sam: 0x6c5ce7,
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
  desk_researcher: 0xe8dfd0,
  desk_analyst: 0xe8dfd0,
  desk_critic: 0xe8dfd0,
  desk_planner: 0xe8dfd0,
  desk_writer: 0xe8dfd0,
  desk_coder: 0xe8dfd0,
  desk_lead: 0xe8dfd0,
  war_room: 0xd4cbbe,
  break_room: 0xd4e4d0,
  lobby: 0xe0ddd8,
  bulletin_board: 0xe8e0cc,
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
    label: "Maya - Research",
    x: 1,
    y: 1,
    w: 9,
    h: 7,
    color: 0xe8dfd0,
  },
  {
    id: "desk_analyst",
    label: "Raj - Analysis",
    x: 11,
    y: 1,
    w: 9,
    h: 7,
    color: 0xe8dfd0,
  },
  {
    id: "desk_critic",
    label: "Sophie - Review",
    x: 21,
    y: 1,
    w: 9,
    h: 7,
    color: 0xe8dfd0,
  },
  {
    id: "desk_lead",
    label: "Sam - Lead",
    x: 31,
    y: 1,
    w: 8,
    h: 7,
    color: 0xe8dfd0,
  },

  // Middle row
  {
    id: "desk_planner",
    label: "Alex - Planning",
    x: 1,
    y: 9,
    w: 9,
    h: 7,
    color: 0xe8dfd0,
  },
  {
    id: "desk_writer",
    label: "Jordan - Writing",
    x: 11,
    y: 9,
    w: 9,
    h: 7,
    color: 0xe8dfd0,
  },
  {
    id: "desk_coder",
    label: "Dev - Coding",
    x: 21,
    y: 9,
    w: 9,
    h: 7,
    color: 0xe8dfd0,
  },

  // Break room - middle right
  {
    id: "break_room",
    label: "Break Room",
    x: 31,
    y: 9,
    w: 8,
    h: 7,
    color: 0xd4e4d0,
  },

  // Bottom - War Room and Lobby
  {
    id: "war_room",
    label: "War Room",
    x: 1,
    y: 17,
    w: 19,
    h: 12,
    color: 0xd4cbbe,
  },
  {
    id: "lobby",
    label: "Lobby",
    x: 21,
    y: 17,
    w: 9,
    h: 12,
    color: 0xe0ddd8,
  },
  {
    id: "bulletin_board",
    label: "Bulletin Board",
    x: 31,
    y: 17,
    w: 8,
    h: 12,
    color: 0xe8e0cc,
  },
];

// Default positions for agents when at their desks (pixel coordinates)
export const DEFAULT_AGENT_POSITIONS: Record<string, { x: number; y: number }> =
  {
    Maya: { x: 5 * 16 + 8, y: 4 * 16 + 8 },
    Raj: { x: 15 * 16 + 8, y: 4 * 16 + 8 },
    Sophie: { x: 25 * 16 + 8, y: 4 * 16 + 8 },
    Sam: { x: 35 * 16 + 8, y: 4 * 16 + 8 },
    Alex: { x: 5 * 16 + 8, y: 12 * 16 + 8 },
    Jordan: { x: 15 * 16 + 8, y: 12 * 16 + 8 },
    Dev: { x: 25 * 16 + 8, y: 12 * 16 + 8 },
  };

// Agent name to role mapping
export const AGENT_ROLES: Record<string, AgentRole> = {
  Maya: "researcher",
  Raj: "analyst",
  Sophie: "critic",
  Alex: "planner",
  Jordan: "writer",
  Dev: "coder",
  Sam: "lead",
};
