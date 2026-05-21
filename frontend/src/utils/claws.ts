import type { AgentRole, Room } from "../types";

export interface ClawMetadata {
  name: string;
  role: AgentRole;
  roleLabel: string;
  clawId: string;
}

export interface SandboxWorkspace {
  name: string;
  displayName: string;
  homeRoom: Room;
}

export const CLAW_METADATA: Record<string, ClawMetadata> = {
  Clawdia: {
    name: "Clawdia",
    role: "researcher",
    roleLabel: "Researcher",
    clawId: "clawdia-research",
  },
  Shelldon: {
    name: "Shelldon",
    role: "analyst",
    roleLabel: "Analyst",
    clawId: "shelldon-analysis",
  },
  Coraline: {
    name: "Coraline",
    role: "critic",
    roleLabel: "Critic",
    clawId: "coraline-review",
  },
  Reefus: {
    name: "Reefus",
    role: "planner",
    roleLabel: "Planner",
    clawId: "reefus-plan",
  },
  Pearl: {
    name: "Pearl",
    role: "writer",
    roleLabel: "Writer",
    clawId: "pearl-writer",
  },
  Snips: {
    name: "Snips",
    role: "coder",
    roleLabel: "Coder",
    clawId: "snips-code",
  },
  "Captain Claw": {
    name: "Captain Claw",
    role: "lead",
    roleLabel: "Lead",
    clawId: "captain-claw-lead",
  },
};

// Four shared workspaces. Lobsters can team up in any of them; the names
// aren't tied to any one lobster any more. Keep in sync with the backend's
// SANDBOX_WORKSPACES in claw_config.py.
export const SANDBOX_WORKSPACES: SandboxWorkspace[] = [
  { name: "nemoclaw-clawdia-reef",    displayName: "Coral Cove",   homeRoom: "sandbox_cove" },
  { name: "nemoclaw-captain-bridge",  displayName: "The Bridge",   homeRoom: "sandbox_bridge" },
  { name: "nemoclaw-pearl-script",    displayName: "Quill Hollow", homeRoom: "sandbox_hollow" },
  { name: "nemoclaw-snips-workbench", displayName: "Workbench",    homeRoom: "sandbox_bench" },
];

export const CLAW_ORDER = [
  "Clawdia",
  "Shelldon",
  "Coraline",
  "Reefus",
  "Pearl",
  "Snips",
  "Captain Claw",
];

export const SANDBOX_HOME_ROOMS = Object.fromEntries(
  SANDBOX_WORKSPACES.map((workspace) => [workspace.name, workspace.homeRoom])
) as Record<string, Room>;

export const SANDBOX_NAMES = SANDBOX_WORKSPACES.map((workspace) => workspace.name);

export function getClawMetadata(name: string): ClawMetadata | undefined {
  return CLAW_METADATA[name];
}

export function getSandboxHomeRoom(sandboxName: string): Room | undefined {
  return SANDBOX_HOME_ROOMS[sandboxName];
}

export function sandboxConnectCommand(sandboxName: string): string {
  return `nemoclaw ${sandboxName} connect`;
}
