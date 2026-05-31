import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ChatMessage,
  DemoReadiness,
  DemoReadinessCheck,
  NemoClawPolicyPreset,
  NemoClawRunStatus,
  NemoClawSandbox,
  OpenClawApprovalsStatus,
  OpenShellNetworkRule,
  OpenShellNetworkRulesStatus,
  SandboxRunDiagnostics,
  SandboxConsoleLine,
} from "../types";
import {
  approveAllNetworkRules,
  clearPendingNetworkRules,
  decideNetworkRule,
  fetchApprovals,
  fetchDemoReadiness,
  fetchNetworkRules,
  fetchPolicies,
  fetchRunDiagnostics,
  setPolicy,
} from "../utils/sandboxApi";
import { DEMO_SCENARIOS } from "../utils/demoScenarios";
import { statusDot } from "./sandbox/format";
import StatusTab from "./sandbox/StatusTab";
import PoliciesTab from "./sandbox/PoliciesTab";
import ChatTab from "./sandbox/ChatTab";
import ConsoleTab from "./sandbox/ConsoleTab";

interface SandboxRunPanelProps {
  sandbox: NemoClawSandbox;
  messages: ChatMessage[];
  /** Live OpenClaw subprocess console lines for this sandbox. */
  consoleLines?: SandboxConsoleLine[];
  onClose: () => void;
  /** Force-refresh the parent sandboxes index after a policy change. */
  onAfterChange?: () => void | Promise<void>;
  /** Optimistic local rename — lets the parent update its sandboxes cache
   *  immediately instead of waiting for the next /sandboxes poll. */
  onLocalRename?: (sandboxName: string, displayName: string) => void;
}

async function clearSandbox(sandboxName: string): Promise<{ archive?: string; error?: string }> {
  const res = await fetch(`/sandboxes/${encodeURIComponent(sandboxName)}/clear`, {
    method: "POST",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: body?.detail || `Clear failed (${res.status})` };
  }
  return body;
}

type Tab = "status" | "policies" | "chat" | "console";

interface PreflightIssue {
  id: string;
  label: string;
  detail: string;
}

interface RunPreflight {
  task: string;
  teamNames: string[];
  blockers: PreflightIssue[];
  warnings: PreflightIssue[];
  readiness: DemoReadiness | null;
  checkedAt: string;
}

const HARD_PREFLIGHT_CHECKS = new Set(["llm", "inference_route", "sandbox_inference"]);

function issueFromCheck(check: DemoReadinessCheck): PreflightIssue {
  return {
    id: check.id,
    label: check.label,
    detail: check.detail || check.status,
  };
}

/**
 * Centered modal: the canonical Task Monitor for one sandbox. Replaces the
 * cramped inline version in the dock. Opens from the dock's Monitor button or
 * by clicking a sandbox hut in the 3D scene. Backdrop click / Escape closes.
 */
export default function SandboxRunPanel({
  sandbox,
  messages,
  consoleLines = [],
  onClose,
  onAfterChange,
  onLocalRename,
}: SandboxRunPanelProps) {
  const [tab, setTab] = useState<Tab>("status");
  const [policies, setPolicies] = useState<NemoClawPolicyPreset[]>([]);
  const [credentialChecks, setCredentialChecks] = useState<
    NonNullable<Awaited<ReturnType<typeof fetchPolicies>>["credential_checks"]>
  >([]);
  const [approvals, setApprovals] = useState<OpenClawApprovalsStatus | null>(null);
  const [networkRules, setNetworkRules] = useState<OpenShellNetworkRulesStatus | null>(null);
  const [networkRulesError, setNetworkRulesError] = useState<string | null>(null);
  const [networkRulesBusy, setNetworkRulesBusy] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<SandboxRunDiagnostics | null>(null);
  const [policiesError, setPoliciesError] = useState<string | null>(null);
  const [policyBusy, setPolicyBusy] = useState<string | null>(null);
  const [policyPreview, setPolicyPreview] = useState<{
    preset: string;
    enabled: boolean;
    output: string;
  } | null>(null);
  const [policyNotice, setPolicyNotice] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearNotice, setClearNotice] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState("");
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskNotice, setTaskNotice] = useState<string | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [runPreflight, setRunPreflight] = useState<RunPreflight | null>(null);
  const [optimisticRun, setOptimisticRun] = useState<NemoClawRunStatus | null>(null);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lazy-load policies the first time the user opens that tab.
  const loadPolicies = useCallback(async () => {
    setNetworkRulesBusy((current) => current ?? "reload");
    try {
      const [data, approvalData, networkData] = await Promise.allSettled([
        fetchPolicies(sandbox.name),
        fetchApprovals(sandbox.name),
        fetchNetworkRules(sandbox.name),
      ]);
      if (data.status === "fulfilled") {
        setPolicies(data.value.policies ?? []);
        setCredentialChecks(data.value.credential_checks ?? []);
        setPoliciesError(data.value.error ?? null);
      } else {
        setPoliciesError(
          data.reason instanceof Error ? data.reason.message : "Could not load policies",
        );
      }
      if (approvalData.status === "fulfilled") {
        setApprovals(approvalData.value);
      }
      if (networkData.status === "fulfilled") {
        setNetworkRules(networkData.value);
        setNetworkRulesError(networkData.value.error ?? null);
      } else {
        setNetworkRules(null);
        setNetworkRulesError(
          networkData.reason instanceof Error
            ? networkData.reason.message
            : "Could not load OpenShell network rules",
        );
      }
    } catch (err) {
      setPoliciesError(err instanceof Error ? err.message : "Could not load policies");
    } finally {
      setNetworkRulesBusy((current) => (current === "reload" ? null : current));
    }
  }, [sandbox.name]);

  useEffect(() => {
    if (tab === "policies" && policies.length === 0 && !policiesError) {
      loadPolicies();
    }
  }, [tab, policies.length, policiesError, loadPolicies]);

  const handlePreviewPolicy = useCallback(
    async (preset: string, nextEnabled: boolean) => {
      setPolicyBusy(preset);
      setPolicyNotice(null);
      const result = await setPolicy(sandbox.name, preset, nextEnabled, true);
      setPolicyBusy(null);
      if (result.error) {
        setPolicyNotice(result.error);
        return;
      }
      setPolicyPreview({
        preset,
        enabled: nextEnabled,
        output: result.output ?? `Will ${nextEnabled ? "enable" : "disable"} ${preset}.`,
      });
    },
    [sandbox.name]
  );

  const handleApplyPolicy = useCallback(async () => {
    if (!policyPreview) return;
    setPolicyBusy(policyPreview.preset);
    const result = await setPolicy(
      sandbox.name,
      policyPreview.preset,
      policyPreview.enabled,
      false
    );
    setPolicyBusy(null);
    setPolicyPreview(null);
    if (result.error) {
      setPolicyNotice(result.error);
      return;
    }
    setPolicyNotice(result.output || `${policyPreview.preset} updated.`);
    await loadPolicies();
    await onAfterChange?.();
  }, [policyPreview, sandbox.name, loadPolicies, onAfterChange]);

  const handleNetworkRuleDecision = useCallback(
    async (rule: OpenShellNetworkRule, decision: "approve" | "reject") => {
      const key = `${decision}:${rule.id}`;
      setNetworkRulesBusy(key);
      setPolicyNotice(null);
      const result = await decideNetworkRule(sandbox.name, rule.id, decision);
      setNetworkRulesBusy(null);
      if (result.error) {
        setPolicyNotice(result.error);
        return;
      }
      const actionLabel =
        decision === "approve"
          ? "approved. Retry the blocked request or rerun the task if it already failed."
          : rule.status === "approved"
            ? "revoked. Future retries will be denied unless another policy allows them."
            : "rejected. Future retries will stay blocked unless you approve this rule.";
      setPolicyNotice(
        result.output || `${rule.rule_name || rule.id} ${actionLabel}`,
      );
      await loadPolicies();
      await onAfterChange?.();
    },
    [loadPolicies, onAfterChange, sandbox.name],
  );

  const handleApproveAllNetworkRules = useCallback(async () => {
    setNetworkRulesBusy("approve-all");
    setPolicyNotice(null);
    const result = await approveAllNetworkRules(sandbox.name);
    setNetworkRulesBusy(null);
    if (result.error) {
      setPolicyNotice(result.error);
      return;
    }
    setPolicyNotice(result.output || "Pending OpenShell network rules approved. Retry blocked requests or rerun failed tasks.");
    await loadPolicies();
    await onAfterChange?.();
  }, [loadPolicies, onAfterChange, sandbox.name]);

  const handleClearPendingNetworkRules = useCallback(async () => {
    setNetworkRulesBusy("clear-pending");
    setPolicyNotice(null);
    const result = await clearPendingNetworkRules(sandbox.name);
    setNetworkRulesBusy(null);
    if (result.error) {
      setPolicyNotice(result.error);
      return;
    }
    setPolicyNotice(result.output || "Pending OpenShell network rules cleared.");
    await loadPolicies();
    await onAfterChange?.();
  }, [loadPolicies, onAfterChange, sandbox.name]);

  const backendRun = sandbox.run_status ?? null;
  const run =
    optimisticRun && backendRun?.run_id !== optimisticRun.run_id
      ? optimisticRun
      : backendRun;
  const runActive = Boolean(run?.running || run?.status === "running" || run?.status === "stopping");
  const clearDisabled = clearBusy || runActive || !sandbox.live;
  const outputs = useMemo(() => Object.entries(run?.outputs ?? {}), [run]);
  const errors = useMemo(() => Object.entries(run?.errors ?? {}), [run]);
  const team = sandbox.assigned_agent_details ?? [];
  const assignedNames = useMemo(
    () =>
      team.length > 0
        ? team.map((agent) => agent.name)
        : [...(sandbox.assigned_agents ?? [])],
    [sandbox.assigned_agents, team],
  );
  const executableNames = useMemo(
    () =>
      team.length > 0
        ? team
            .filter((agent) => agent.runtime !== "hermes" && agent.species !== "crab")
            .map((agent) => agent.name)
        : [...(sandbox.assigned_agents ?? [])],
    [sandbox.assigned_agents, team],
  );
  const hermesAssigned = useMemo(
    () =>
      team.some(
        (agent) => agent.runtime === "hermes" || agent.species === "crab",
      ),
    [team],
  );
  const localMessages = useMemo(
    () => messages.filter((m) => m.sandbox_name === sandbox.name).slice(-50),
    [messages, sandbox.name]
  );

  const loadDiagnostics = useCallback(async () => {
    if (!run?.run_id) {
      setDiagnostics(null);
      return;
    }
    try {
      setDiagnostics(await fetchRunDiagnostics(sandbox.name, run.run_id));
    } catch {
      setDiagnostics(null);
    }
  }, [run?.run_id, sandbox.name]);

  useEffect(() => {
    loadDiagnostics();
  }, [loadDiagnostics]);

  useEffect(() => {
    if (backendRun?.run_id === optimisticRun?.run_id) {
      setOptimisticRun(null);
    }
  }, [backendRun?.run_id, optimisticRun?.run_id]);

  // Inline rename state. Empty draft means "use default."
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const currentLabel = sandbox.display_name || sandbox.name;
  const defaultLabel = sandbox.default_display_name || "";
  const isCustomLabel =
    Boolean(defaultLabel) && currentLabel !== defaultLabel;

  const startRename = useCallback(() => {
    setRenameDraft(currentLabel);
    setRenameError(null);
    setIsRenaming(true);
  }, [currentLabel]);

  const cancelRename = useCallback(() => {
    setIsRenaming(false);
    setRenameError(null);
  }, []);

  const submitRename = useCallback(
    async (raw: string) => {
      try {
        const res = await fetch(
          `/sandboxes/${encodeURIComponent(sandbox.name)}/display-name`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ display_name: raw }),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.detail || `Rename failed (${res.status})`);
        }
        const body = await res.json().catch(() => ({}));
        const effective = typeof body?.display_name === "string"
          ? body.display_name
          : (raw.trim() || defaultLabel || sandbox.name);
        setIsRenaming(false);
        setRenameError(null);
        // Update local cached label using what the server actually stored;
        // onAfterChange then refreshes the source of truth from /sandboxes.
        onLocalRename?.(sandbox.name, effective);
        await onAfterChange?.();
      } catch (err) {
        setRenameError(err instanceof Error ? err.message : "Rename failed");
      }
    },
    [sandbox.name, defaultLabel, onAfterChange, onLocalRename]
  );

  useEffect(() => {
    setClearConfirm(false);
    setClearNotice(null);
    setTaskNotice(null);
    setOptimisticRun(null);
    setDiagnostics(null);
    setNetworkRules(null);
    setNetworkRulesError(null);
    setNetworkRulesBusy(null);
    setRunPreflight(null);
  }, [sandbox.name]);

  const startTask = useCallback(async (task: string, agentNamesOverride?: string[]) => {
    if (!task || taskBusy) return;
    setTaskBusy(true);
    setTaskNotice(null);
    const runAgents = agentNamesOverride && agentNamesOverride.length > 0
      ? agentNamesOverride
      : assignedNames;
    try {
      const res = await fetch(
        `/sandboxes/${encodeURIComponent(sandbox.name)}/task`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, agent_names: runAgents }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTaskNotice(body?.detail || `Run failed (${res.status})`);
        return;
      }
      setTaskDraft("");
      const runId = typeof body?.run_id === "string" ? body.run_id : "";
      if (runId) {
        const now = new Date().toISOString();
        setDiagnostics(null);
        setOptimisticRun({
          run_id: runId,
          sandbox_name: sandbox.name,
          agents: runAgents,
          task,
          status: "running",
          started_at: now,
          phase: "openclaw",
          current_agent: runAgents[0],
          last_message: runAgents[0]
            ? `Starting ${runAgents[0]}'s OpenClaw turn in this sandbox.`
            : "Starting NemoClaw run.",
          last_update_at: now,
          outputs: {},
          errors: {},
          running: true,
          mode: runAgents.length > 1 ? "coordinated" : "single",
          policies: sandbox.policies ?? [],
          policy_snapshot: sandbox.policies ?? [],
          success_count: 0,
          error_count: 0,
          total_count: runAgents.length,
        });
      }
      setTaskNotice(runId ? `Run started: ${runId.slice(0, 8)}…` : "Run started.");
      await onAfterChange?.();
    } catch (err) {
      setTaskNotice(err instanceof Error ? err.message : "Run failed");
    } finally {
      setTaskBusy(false);
    }
  }, [assignedNames, taskBusy, sandbox.name, sandbox.policies, onAfterChange]);

  const requestRunTask = useCallback(async () => {
    const task = taskDraft.trim();
    if (!task || taskBusy || preflightBusy || runActive) return;
    setPreflightBusy(true);
    setTaskNotice(null);
    try {
      const readiness = await fetchDemoReadiness(sandbox.name);
      const blockers: PreflightIssue[] = [];
      const warnings: PreflightIssue[] = [];

      if (!sandbox.live) {
        blockers.push({
          id: "sandbox_live",
          label: "Sandbox is not live",
          detail: "Start or create this NemoClaw/OpenShell sandbox before running a task.",
        });
      }
      if (assignedNames.length === 0) {
        blockers.push({
          id: "assigned_agents",
          label: "No assigned agents",
          detail: "Drag at least one lobster or crab into this sandbox before running.",
        });
      }

      for (const check of readiness.checks ?? []) {
        if (check.status === "fail" && HARD_PREFLIGHT_CHECKS.has(check.id)) {
          blockers.push(issueFromCheck(check));
        } else if (check.id === "hermes") {
          continue;
        } else if (check.status === "warn") {
          warnings.push(issueFromCheck(check));
        } else if (check.status === "fail") {
          warnings.push(issueFromCheck(check));
        }
      }

      if (hermesAssigned && readiness.hermes?.configured !== true) {
        warnings.push({
          id: "hermes_assigned",
          label: "Hermes crab runtime is not configured",
          detail: "Crabs can be displayed and assigned, but they will not execute Hermes turns until OFFICE_AGENTS_HERMES_COMMAND is set.",
        });
      }

      setRunPreflight({
        task,
        teamNames: assignedNames,
        blockers,
        warnings,
        readiness,
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      setRunPreflight({
        task,
        teamNames: assignedNames,
        blockers: [{
          id: "preflight_unavailable",
          label: "Preflight failed",
          detail: err instanceof Error ? err.message : "Could not load demo readiness.",
        }],
        warnings: [],
        readiness: null,
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setPreflightBusy(false);
    }
  }, [assignedNames, hermesAssigned, preflightBusy, runActive, sandbox.live, sandbox.name, taskBusy, taskDraft]);

  const confirmRunTask = useCallback(async () => {
    if (!runPreflight || runPreflight.blockers.length > 0) return;
    const task = runPreflight.task;
    setRunPreflight(null);
    await startTask(task);
  }, [runPreflight, startTask]);

  const confirmRunWithoutCrabs = useCallback(async () => {
    if (!runPreflight || runPreflight.blockers.length > 0 || executableNames.length === 0) return;
    const task = runPreflight.task;
    setRunPreflight(null);
    await startTask(task, executableNames);
  }, [executableNames, runPreflight, startTask]);

  const cancelRun = useCallback(async () => {
    if (!run?.run_id) return;
    setTaskBusy(true);
    try {
      await fetch(
        `/sandboxes/${encodeURIComponent(sandbox.name)}/task/${encodeURIComponent(run.run_id)}/cancel`,
        { method: "POST" },
      );
      await onAfterChange?.();
    } finally {
      setTaskBusy(false);
    }
  }, [run?.run_id, sandbox.name, onAfterChange]);

  const handleClearSandbox = useCallback(async () => {
    if (clearDisabled) return;
    if (!clearConfirm) {
      setClearConfirm(true);
      setClearNotice(null);
      return;
    }
    setClearBusy(true);
    const result = await clearSandbox(sandbox.name);
    setClearBusy(false);
    setClearConfirm(false);
    if (result.error) {
      setClearNotice(result.error);
      return;
    }
    setClearNotice(result.archive ? `Cleared. Archive: ${result.archive}` : "Cleared.");
    await onAfterChange?.();
  }, [clearConfirm, clearDisabled, onAfterChange, sandbox.name]);

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex h-[min(82vh,820px)] w-[min(92vw,960px)] flex-col overflow-hidden rounded-2xl border border-white/14 bg-slate-950/92 shadow-[0_40px_120px_rgba(4,22,31,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/8 bg-gradient-to-b from-slate-900/60 to-slate-900/30 px-7 py-5">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200/65">
              NemoClaw Sandbox
            </div>
            {isRenaming ? (
              <form
                className="mt-1 flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitRename(renameDraft);
                }}
              >
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") cancelRename();
                  }}
                  maxLength={80}
                  placeholder={defaultLabel || "Display name"}
                  className="min-w-0 flex-1 rounded-md border border-white/14 bg-slate-950/60 px-2.5 py-1.5 text-[16px] font-semibold text-white outline-none focus:border-cyan-200/45"
                />
                <button
                  type="submit"
                  className="rounded-md bg-cyan-300/30 px-3 py-1.5 text-[11px] font-bold uppercase text-cyan-50 hover:bg-cyan-300/45"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancelRename}
                  className="rounded-md bg-white/[0.08] px-3 py-1.5 text-[11px] font-bold uppercase text-white/70 hover:bg-white/[0.16]"
                >
                  Cancel
                </button>
                {isCustomLabel && (
                  <button
                    type="button"
                    onClick={() => submitRename("")}
                    title={`Reset to "${defaultLabel}"`}
                    className="rounded-md bg-white/[0.05] px-2 py-1.5 text-[11px] font-semibold text-white/55 hover:bg-white/[0.12]"
                  >
                    Reset
                  </button>
                )}
              </form>
            ) : (
              <button
                type="button"
                onClick={startRename}
                title="Rename this sandbox"
                className="group/title mt-1.5 flex max-w-full items-center gap-2.5 text-left"
              >
                <span className="truncate text-[22px] font-semibold leading-7 text-white">
                  {currentLabel}
                </span>
                <span className="shrink-0 text-[13px] text-white/30 transition group-hover/title:text-white/70">
                  ✎
                </span>
                {isCustomLabel && (
                  <span className="shrink-0 rounded-full bg-amber-300/14 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-100">
                    renamed
                  </span>
                )}
              </button>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-white/45">
                {sandbox.name}
              </span>
              {sandbox.home_room && (
                <span className="rounded-md bg-white/[0.06] px-2 py-0.5 font-medium text-white/55">
                  {sandbox.home_room}
                </span>
              )}
              <span className={`rounded-md px-2 py-0.5 font-semibold ${
                sandbox.live
                  ? "bg-emerald-300/14 text-emerald-100"
                  : "bg-amber-300/14 text-amber-100"
              }`}>
                {sandbox.live ? "● live" : "● not live"}
              </span>
            </div>
            {renameError && (
              <div className="mt-1.5 text-[11px] font-medium text-rose-200">
                {renameError}
              </div>
            )}
            {clearNotice && (
              <div className="mt-1.5 truncate text-[11px] font-medium text-cyan-100/72">
                {clearNotice}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {run && (
              <span className="flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/80">
                <span className={`h-2 w-2 rounded-full ${statusDot(run.status, run.outcome)}`} />
                {run.outcome && run.status === "finished" ? run.outcome : run.status}
              </span>
            )}
            <button
              type="button"
              disabled={clearDisabled}
              onClick={handleClearSandbox}
              className={`h-9 rounded-lg px-3 text-[11px] font-bold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40 ${
                clearConfirm
                  ? "bg-rose-300/22 text-rose-50 hover:bg-rose-300/34"
                  : "bg-white/[0.07] text-white/68 hover:bg-white/[0.16] hover:text-white"
              }`}
              title={
                runActive
                  ? "Stop the active run before clearing"
                  : !sandbox.live
                    ? "Sandbox is not live"
                  : "Archive and wipe this sandbox's workspace files"
              }
            >
              {clearBusy ? "Clearing" : clearConfirm ? "Confirm" : "Clear"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.07] text-[15px] text-white/72 hover:bg-white/[0.16] hover:text-white"
              aria-label="Close"
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 gap-1 border-b border-white/10 bg-slate-900/40 px-6">
          {(
            [
              { id: "status" as Tab, label: "Run + Outputs", count: 0 },
              { id: "policies" as Tab, label: "Policies", count: policies.filter((p) => p.enabled).length },
              { id: "chat" as Tab, label: "Chat", count: localMessages.length },
              { id: "console" as Tab, label: "Console", count: consoleLines.length },
            ] as const
          ).map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`relative flex items-center gap-2 px-4 py-5 text-[15px] font-semibold transition ${
                  active
                    ? "text-cyan-100"
                    : "text-white/55 hover:text-white"
                }`}
              >
                {t.label}
                {t.count > 0 && (
                  <span
                    className={`inline-grid min-w-[22px] place-items-center rounded-full px-2 py-0.5 text-[11px] font-bold leading-4 ${
                      active
                        ? "bg-cyan-300/25 text-cyan-50"
                        : "bg-white/[0.10] text-white/65"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
                {active && (
                  <span className="absolute inset-x-2 -bottom-px h-[3px] rounded-t-full bg-cyan-300/80" />
                )}
              </button>
            );
          })}
        </div>

        {/* Run prompt bar — always visible, drives the sandbox directly. */}
        <div className="shrink-0 border-b border-white/8 bg-slate-900/25 px-6 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-white/35">
              Quick starts
            </span>
            {DEMO_SCENARIOS.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                onClick={() => setTaskDraft(scenario.task)}
                disabled={taskBusy || preflightBusy || runActive}
                className="rounded-md border border-white/10 bg-white/[0.045] px-2 py-1 text-[10px] font-semibold text-white/62 transition hover:border-cyan-200/28 hover:bg-cyan-300/[0.08] hover:text-cyan-50 disabled:opacity-40"
                title={scenario.description}
              >
                {scenario.label}
                <span className="ml-1 rounded bg-white/[0.08] px-1 py-0.5 text-[8px] uppercase tracking-wide text-white/42">
                  {scenario.badge}
                </span>
              </button>
            ))}
            {run?.task && !runActive && (
              <button
                type="button"
                onClick={() => setTaskDraft(run.task)}
                className="rounded-md border border-emerald-300/16 bg-emerald-300/[0.08] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-50/85 hover:bg-emerald-300/[0.14]"
                title="Copy the last run task into the task box"
              >
                Retry last
              </button>
            )}
          </div>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">
                Run a task in this sandbox
              </label>
              <textarea
                value={taskDraft}
                onChange={(e) => setTaskDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    requestRunTask();
                  }
                }}
                disabled={taskBusy || preflightBusy || runActive}
                rows={1}
                placeholder={
                  !sandbox.live
                    ? "Sandbox is not live"
                    : runActive
                      ? "Run in progress — cancel it to start another"
                      : team.length === 0
                        ? "Assign at least one lobster or crab before running"
                        : `What should the team do? (⌘↵ to run)`
                }
                className="min-h-[40px] max-h-32 w-full resize-none rounded-lg border border-white/12 bg-slate-950/55 px-3 py-2 text-[13px] leading-5 text-white outline-none placeholder:text-white/35 focus:border-cyan-200/45 disabled:opacity-60"
              />
            </div>
            {runActive ? (
              <button
                type="button"
                onClick={cancelRun}
                disabled={taskBusy}
                className="h-10 shrink-0 rounded-lg bg-rose-300/22 px-4 text-[12px] font-bold uppercase tracking-wide text-rose-50 transition hover:bg-rose-300/34 disabled:opacity-50"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={requestRunTask}
                disabled={!taskDraft.trim() || taskBusy || preflightBusy || runActive}
                className="h-10 shrink-0 rounded-lg bg-cyan-300/30 px-4 text-[12px] font-bold uppercase tracking-wide text-cyan-50 transition hover:bg-cyan-300/45 disabled:cursor-not-allowed disabled:bg-white/[0.07] disabled:text-white/35"
              >
                {taskBusy ? "Starting…" : preflightBusy ? "Checking…" : "Run"}
              </button>
            )}
          </div>
          {taskNotice && (
            <div className="mt-1.5 text-[11px] font-medium text-cyan-100/80">
              {taskNotice}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
            <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-white/45">
              assigned {assignedNames.length}
            </span>
            <span className="rounded-full bg-emerald-300/12 px-2 py-0.5 text-emerald-100/82">
              executable {executableNames.length}
            </span>
            {hermesAssigned && (
              <span className="rounded-full bg-amber-300/12 px-2 py-0.5 text-amber-100/82">
                crab present
              </span>
            )}
            {(sandbox.policies ?? []).slice(0, 5).map((policy) => (
              <span
                key={policy}
                className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-cyan-100/72"
              >
                {policy}
              </span>
            ))}
          </div>
        </div>

        {runPreflight && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/72 p-6 backdrop-blur-sm">
            <div className="w-[min(92vw,640px)] overflow-hidden rounded-xl border border-white/14 bg-slate-950 text-white shadow-[0_32px_90px_rgba(2,6,23,0.55)]">
              <div className="border-b border-white/10 bg-slate-900/55 px-5 py-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/60">
                  Run preflight
                </div>
                <div className="mt-1 text-[18px] font-semibold leading-6">
                  {runPreflight.blockers.length > 0 ? "Fix blockers before running" : "Ready to start task"}
                </div>
                <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-white/58">
                  {runPreflight.task}
                </div>
              </div>

              <div className="max-h-[56vh] overflow-y-auto px-5 py-4">
                <div className="mb-4 grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-white/38">Agents</div>
                    <div className="mt-1 text-[15px] font-semibold text-white">{runPreflight.teamNames.length}</div>
                  </div>
                  <div className="rounded-lg border border-rose-300/24 bg-rose-300/[0.08] px-3 py-2">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-rose-100/60">Blockers</div>
                    <div className="mt-1 text-[15px] font-semibold text-rose-50">{runPreflight.blockers.length}</div>
                  </div>
                  <div className="rounded-lg border border-amber-300/24 bg-amber-300/[0.07] px-3 py-2">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-amber-100/60">Warnings</div>
                    <div className="mt-1 text-[15px] font-semibold text-amber-50">{runPreflight.warnings.length}</div>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-white/42">
                    Team
                  </div>
                  {runPreflight.teamNames.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {runPreflight.teamNames.map((name) => (
                        <span
                          key={name}
                          className="rounded-full bg-cyan-300/12 px-2.5 py-1 text-[11px] font-semibold text-cyan-50 ring-1 ring-cyan-200/14"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-rose-300/22 bg-rose-300/[0.08] px-3 py-2 text-[12px] text-rose-50">
                      No profiles are assigned to this sandbox.
                    </div>
                  )}
                </div>

                {runPreflight.blockers.length > 0 && (
                  <section className="mb-4">
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-rose-100/72">
                      Blockers
                    </div>
                    <div className="space-y-2">
                      {runPreflight.blockers.map((issue) => (
                        <div key={issue.id} className="rounded-lg border border-rose-300/24 bg-rose-300/[0.08] px-3 py-2.5">
                          <div className="text-[12px] font-semibold text-rose-50">{issue.label}</div>
                          <div className="mt-1 text-[11px] leading-4 text-rose-50/72">{issue.detail}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {runPreflight.warnings.length > 0 && (
                  <section>
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-amber-100/72">
                      Warnings
                    </div>
                    <div className="space-y-2">
                      {runPreflight.warnings.map((issue, index) => (
                        <div key={`${issue.id}-${index}`} className="rounded-lg border border-amber-300/24 bg-amber-300/[0.07] px-3 py-2.5">
                          <div className="text-[12px] font-semibold text-amber-50">{issue.label}</div>
                          <div className="mt-1 text-[11px] leading-4 text-amber-50/72">{issue.detail}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {runPreflight.blockers.length === 0 && runPreflight.warnings.length === 0 && (
                  <div className="rounded-lg border border-emerald-300/22 bg-emerald-300/[0.07] px-3 py-2.5 text-[12px] font-medium text-emerald-50">
                    Sandbox, team assignment, and inference checks passed.
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-white/10 bg-slate-900/40 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setRunPreflight(null)}
                  className="h-9 rounded-lg bg-white/[0.08] px-3 text-[11px] font-bold uppercase tracking-wide text-white/70 hover:bg-white/[0.16] hover:text-white"
                >
                  {runPreflight.blockers.length > 0 ? "Close" : "Cancel"}
                </button>
                <button
                  type="button"
                  onClick={confirmRunTask}
                  disabled={taskBusy || runPreflight.blockers.length > 0}
                  className="h-9 rounded-lg bg-cyan-300/30 px-4 text-[11px] font-bold uppercase tracking-wide text-cyan-50 hover:bg-cyan-300/45 disabled:cursor-not-allowed disabled:bg-white/[0.07] disabled:text-white/35"
                >
                  {taskBusy ? "Starting" : "Start Run"}
                </button>
                {hermesAssigned && executableNames.length > 0 && runPreflight.blockers.length === 0 && (
                  <button
                    type="button"
                    onClick={confirmRunWithoutCrabs}
                    disabled={taskBusy}
                    className="h-9 rounded-lg border border-amber-300/24 bg-amber-300/[0.10] px-3 text-[11px] font-bold uppercase tracking-wide text-amber-50 hover:bg-amber-300/[0.16] disabled:opacity-45"
                    title="Run only OpenClaw lobsters and leave Hermes crabs visual-only"
                  >
                    Lobsters only
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 text-white/82">
          {tab === "status" && (
            <StatusTab
              run={run}
              outputs={outputs}
              errors={errors}
              team={team}
              diagnostics={diagnostics}
            />
          )}

          {tab === "policies" && (
            <PoliciesTab
              policies={policies}
              error={policiesError}
              busy={policyBusy}
              notice={policyNotice}
              preview={policyPreview}
              onPreview={handlePreviewPolicy}
              onApply={handleApplyPolicy}
              onCancelPreview={() => setPolicyPreview(null)}
              onReload={loadPolicies}
              credentialChecks={credentialChecks}
              approvals={approvals}
              networkRules={networkRules}
              networkRulesError={networkRulesError}
              networkRulesBusy={networkRulesBusy}
              onNetworkRulesReload={loadPolicies}
              onNetworkRuleDecision={handleNetworkRuleDecision}
              onNetworkRulesApproveAll={handleApproveAllNetworkRules}
              onNetworkRulesClearPending={handleClearPendingNetworkRules}
            />
          )}

          {tab === "chat" && <ChatTab messages={localMessages} />}

          {tab === "console" && <ConsoleTab lines={consoleLines} />}
        </div>
      </div>
    </div>
  );
}
