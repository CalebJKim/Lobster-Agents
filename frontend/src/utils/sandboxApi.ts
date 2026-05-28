// Sandbox REST endpoints — keep URL + body construction in one place so
// callers (SandboxOrchestrator, SandboxRunPanel) cannot drift on contract.
// Error handling is intentionally left to the caller; the two consumers want
// different shapes (throw-on-error vs. result-object).

import type { NemoClawPolicyStatus } from "../types";

/** Throws on non-2xx; otherwise parses JSON. Use when the caller has try/catch. */
export async function fetchPolicies(sandboxName: string): Promise<NemoClawPolicyStatus> {
  const res = await fetch(`/sandboxes/${encodeURIComponent(sandboxName)}/policies`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Could not load policies (${res.status})`);
  return res.json();
}

export interface SetPolicyResult {
  output?: string;
  ok?: boolean;
  error?: string;
}

/** Never throws — failures return `{ ok: false, error }`. Use when the caller
 *  prefers to inspect the result over wrapping in try/catch. */
export async function setPolicy(
  sandboxName: string,
  preset: string,
  enabled: boolean,
  dryRun: boolean,
): Promise<SetPolicyResult> {
  const res = await fetch(`/sandboxes/${encodeURIComponent(sandboxName)}/policies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset, enabled, dry_run: dryRun }),
  });
  const body = (await res.json().catch(() => ({}))) as SetPolicyResult;
  if (!res.ok) {
    return {
      ok: false,
      error: typeof body?.error === "string" ? body.error : `Policy change failed (${res.status})`,
    };
  }
  return body;
}

/** Throws on non-2xx. Same body as setPolicy. */
export async function setPolicyOrThrow(
  sandboxName: string,
  preset: string,
  enabled: boolean,
  dryRun: boolean,
): Promise<SetPolicyResult> {
  const result = await setPolicy(sandboxName, preset, enabled, dryRun);
  if (result.error) throw new Error(result.error);
  return result;
}
