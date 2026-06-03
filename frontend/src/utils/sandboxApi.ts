// Sandbox REST endpoints — keep URL + body construction in one place so
// callers (SandboxOrchestrator, SandboxRunPanel) cannot drift on contract.
// Error handling is intentionally left to the caller; the two consumers want
// different shapes (throw-on-error vs. result-object).

import type {
  DemoReadiness,
  NemoClawPolicyStatus,
  NemoClawStatus,
  OpenClawApprovalsStatus,
  OpenShellNetworkRuleActionResult,
  OpenShellNetworkRulesStatus,
  SandboxRunArtifacts,
  SandboxRunDiagnostics,
} from "../types";

export async function fetchSandboxes(): Promise<NemoClawStatus> {
  const res = await fetch("/sandboxes", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Could not load sandboxes (${res.status})`);
  return res.json();
}

export async function fetchDemoReadiness(sandboxName?: string | null): Promise<DemoReadiness> {
  const suffix = sandboxName ? `?sandbox_name=${encodeURIComponent(sandboxName)}` : "";
  const res = await fetch(`/demo/readiness${suffix}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load demo readiness (${res.status})`);
  return res.json();
}

export async function createSandbox(displayName: string): Promise<{
  status: string;
  sandbox?: NemoClawStatus["sandboxes"][number];
  provision?: { ok?: boolean | null; status?: string; output?: string; error?: string; background?: boolean } | null;
}> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30 * 1000);
  try {
    const res = await fetch("/sandboxes", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: displayName, provision: true }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as {
      status: string;
      sandbox?: NemoClawStatus["sandboxes"][number];
      provision?: { ok?: boolean | null; status?: string; output?: string; error?: string; background?: boolean } | null;
      detail?: string;
    };
    if (!res.ok) throw new Error(body.detail || `Could not create sandbox (${res.status})`);
    return body;
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Throws on non-2xx; otherwise parses JSON. Use when the caller has try/catch. */
export async function fetchPolicies(sandboxName: string): Promise<NemoClawPolicyStatus> {
  const res = await fetch(`/sandboxes/${encodeURIComponent(sandboxName)}/policies`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Could not load policies (${res.status})`);
  return res.json();
}

export async function fetchApprovals(sandboxName: string | null): Promise<OpenClawApprovalsStatus> {
  const suffix = sandboxName ? `?sandbox_name=${encodeURIComponent(sandboxName)}` : "";
  const res = await fetch(`/approvals${suffix}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Could not load approvals (${res.status})`);
  return res.json();
}

export async function fetchNetworkRules(
  sandboxName: string,
  status: "pending" | "approved" | "rejected" | "all" = "all",
): Promise<OpenShellNetworkRulesStatus> {
  const res = await fetch(
    `/sandboxes/${encodeURIComponent(sandboxName)}/network-rules?status=${encodeURIComponent(status)}`,
    { cache: "no-store" },
  );
  const body = (await res.json().catch(() => ({}))) as OpenShellNetworkRulesStatus & {
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(body.detail || body.error || `Could not load network rules (${res.status})`);
  }
  return body;
}

export async function fetchRunDiagnostics(
  sandboxName: string,
  runId: string,
): Promise<SandboxRunDiagnostics> {
  const res = await fetch(
    `/sandboxes/${encodeURIComponent(sandboxName)}/tasks/${encodeURIComponent(runId)}/diagnostics`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Could not load run diagnostics (${res.status})`);
  return res.json();
}

export async function fetchRunArtifacts(
  sandboxName: string,
  runId: string,
): Promise<SandboxRunArtifacts> {
  const res = await fetch(
    `/sandboxes/${encodeURIComponent(sandboxName)}/tasks/${encodeURIComponent(runId)}/artifacts`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Could not load run artifacts (${res.status})`);
  return res.json();
}

export interface SetPolicyResult {
  output?: string;
  ok?: boolean;
  error?: string;
}

async function networkRuleAction(
  url: string,
  init?: RequestInit,
): Promise<OpenShellNetworkRuleActionResult> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as OpenShellNetworkRuleActionResult & {
    detail?: string;
  };
  if (!res.ok) {
    return {
      ok: false,
      error: body.error || body.detail || `Network rule action failed (${res.status})`,
    };
  }
  return body;
}

export async function decideNetworkRule(
  sandboxName: string,
  chunkId: string,
  decision: "approve" | "reject",
): Promise<OpenShellNetworkRuleActionResult> {
  return networkRuleAction(
    `/sandboxes/${encodeURIComponent(sandboxName)}/network-rules/${encodeURIComponent(chunkId)}/decision`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    },
  );
}

export async function approveAllNetworkRules(
  sandboxName: string,
  includeSecurityFlagged = false,
): Promise<OpenShellNetworkRuleActionResult> {
  return networkRuleAction(
    `/sandboxes/${encodeURIComponent(sandboxName)}/network-rules/approve-all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ include_security_flagged: includeSecurityFlagged }),
    },
  );
}

export async function clearPendingNetworkRules(
  sandboxName: string,
): Promise<OpenShellNetworkRuleActionResult> {
  return networkRuleAction(
    `/sandboxes/${encodeURIComponent(sandboxName)}/network-rules/clear-pending`,
    { method: "POST" },
  );
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
      error:
        typeof body?.error === "string"
          ? body.error
          : typeof (body as { detail?: unknown })?.detail === "string"
            ? String((body as { detail: string }).detail)
            : `Policy change failed (${res.status})`,
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
