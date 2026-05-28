// Label/short-name helpers for sandbox UI surfaces. Shared by
// SandboxOrchestrator and its subcomponents so display strings cannot drift.

import { SANDBOX_WORKSPACES } from "../../utils/claws";
import type { NemoClawSandbox } from "../../types";

export function shortName(name: string): string {
  return name.replace(/^nemoclaw-/, "").replace(/-/g, " ");
}

export function sandboxLabel(
  sandbox: Pick<NemoClawSandbox, "name" | "display_name">,
): string {
  return sandbox.display_name || shortName(sandbox.name);
}

const SANDBOX_LABELS = Object.fromEntries(
  SANDBOX_WORKSPACES.map((workspace) => [workspace.name, workspace.displayName]),
) as Record<string, string>;

export function sandboxNameLabel(sandboxName: string): string {
  return SANDBOX_LABELS[sandboxName] ?? shortName(sandboxName);
}

export function policySummary(policies?: string[]): string {
  if (!policies || policies.length === 0) return "No policy presets";
  if (policies.length <= 3) return policies.join(", ");
  return `${policies.slice(0, 3).join(", ")} +${policies.length - 3}`;
}
