import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ChatMessage,
  NemoClawPolicyPreset,
  NemoClawSandbox,
  SandboxConsoleLine,
} from "../types";
import { fetchPolicies, setPolicy } from "../utils/sandboxApi";
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
    try {
      const data = await fetchPolicies(sandbox.name);
      setPolicies(data.policies ?? []);
      setPoliciesError(data.error ?? null);
    } catch (err) {
      setPoliciesError(err instanceof Error ? err.message : "Could not load policies");
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

  const run = sandbox.run_status ?? null;
  const runActive = Boolean(run?.running || run?.status === "running" || run?.status === "stopping");
  const clearDisabled = clearBusy || runActive || !sandbox.live;
  const outputs = useMemo(() => Object.entries(run?.outputs ?? {}), [run]);
  const errors = useMemo(() => Object.entries(run?.errors ?? {}), [run]);
  const team = sandbox.assigned_agent_details ?? [];
  const localMessages = useMemo(
    () => messages.filter((m) => m.sandbox_name === sandbox.name).slice(-50),
    [messages, sandbox.name]
  );

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
  }, [sandbox.name]);

  const runTask = useCallback(async () => {
    const task = taskDraft.trim();
    if (!task || taskBusy) return;
    setTaskBusy(true);
    setTaskNotice(null);
    try {
      const res = await fetch(
        `/sandboxes/${encodeURIComponent(sandbox.name)}/task`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTaskNotice(body?.detail || `Run failed (${res.status})`);
        return;
      }
      setTaskDraft("");
      setTaskNotice(body?.run_id ? `Run started: ${body.run_id.slice(0, 8)}…` : "Run started.");
      await onAfterChange?.();
    } catch (err) {
      setTaskNotice(err instanceof Error ? err.message : "Run failed");
    } finally {
      setTaskBusy(false);
    }
  }, [taskDraft, taskBusy, sandbox.name, onAfterChange]);

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
        className="flex h-[min(82vh,820px)] w-[min(92vw,960px)] flex-col overflow-hidden rounded-2xl border border-white/14 bg-slate-950/92 shadow-[0_40px_120px_rgba(4,22,31,0.55)]"
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
                <span className={`h-2 w-2 rounded-full ${statusDot(run.status)}`} />
                {run.status}
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
                    runTask();
                  }
                }}
                disabled={taskBusy || runActive || !sandbox.live}
                rows={1}
                placeholder={
                  !sandbox.live
                    ? "Sandbox is not live"
                    : runActive
                      ? "Run in progress — cancel it to start another"
                      : team.length === 0
                        ? "No lobsters assigned — runs the default solo team"
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
                onClick={runTask}
                disabled={!taskDraft.trim() || taskBusy || !sandbox.live}
                className="h-10 shrink-0 rounded-lg bg-cyan-300/30 px-4 text-[12px] font-bold uppercase tracking-wide text-cyan-50 transition hover:bg-cyan-300/45 disabled:cursor-not-allowed disabled:bg-white/[0.07] disabled:text-white/35"
              >
                {taskBusy ? "Starting…" : "Run"}
              </button>
            )}
          </div>
          {taskNotice && (
            <div className="mt-1.5 text-[11px] font-medium text-cyan-100/80">
              {taskNotice}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 text-white/82">
          {tab === "status" && (
            <StatusTab
              run={run}
              outputs={outputs}
              errors={errors}
              team={team}
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
            />
          )}

          {tab === "chat" && <ChatTab messages={localMessages} />}

          {tab === "console" && <ConsoleTab lines={consoleLines} />}
        </div>
      </div>
    </div>
  );
}
