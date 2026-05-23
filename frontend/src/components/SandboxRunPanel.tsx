import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ChatMessage,
  NemoClawPolicyPreset,
  NemoClawPolicyStatus,
  NemoClawSandbox,
} from "../types";
import { AGENT_COLORS } from "../utils/sprites";

interface SandboxRunPanelProps {
  sandbox: NemoClawSandbox;
  messages: ChatMessage[];
  onClose: () => void;
  /** Force-refresh the parent sandboxes index after a policy change. */
  onAfterChange?: () => void | Promise<void>;
  /** Optimistic local rename — lets the parent update its sandboxes cache
   *  immediately instead of waiting for the next /sandboxes poll. */
  onLocalRename?: (sandboxName: string, displayName: string) => void;
}

function formatTime(ts: string | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function statusDot(status?: string | null): string {
  switch (status) {
    case "running":
      return "bg-cyan-300";
    case "cancelling":
    case "stopping":
    case "cancelled":
      return "bg-amber-300";
    case "finished":
      return "bg-emerald-300";
    case "error":
      return "bg-rose-300";
    default:
      return "bg-white/40";
  }
}

async function fetchPolicies(sandboxName: string): Promise<NemoClawPolicyStatus> {
  const res = await fetch(`/sandboxes/${encodeURIComponent(sandboxName)}/policies`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Could not load policies (${res.status})`);
  return res.json();
}

async function setPolicy(
  sandboxName: string,
  preset: string,
  enabled: boolean,
  dryRun: boolean
): Promise<{ output?: string; ok?: boolean; error?: string }> {
  const res = await fetch(`/sandboxes/${encodeURIComponent(sandboxName)}/policies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset, enabled, dry_run: dryRun }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: body?.detail || `Policy change failed (${res.status})` };
  }
  return body;
}

type Tab = "status" | "policies" | "chat";

/**
 * Centered modal: the canonical Task Monitor for one sandbox. Replaces the
 * cramped inline version in the dock. Opens from the dock's Monitor button or
 * by clicking a sandbox hut in the 3D scene. Backdrop click / Escape closes.
 */
export default function SandboxRunPanel({
  sandbox,
  messages,
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
        // Optimistic local update so this panel + the dock card flip instantly.
        onLocalRename?.(sandbox.name, effective);
        await onAfterChange?.();
      } catch (err) {
        setRenameError(err instanceof Error ? err.message : "Rename failed");
      }
    },
    [sandbox.name, defaultLabel, onAfterChange, onLocalRename]
  );

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
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/8 bg-slate-900/40 px-6 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
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
                className="mt-0.5 flex max-w-full items-center gap-2 text-left"
              >
                <span className="truncate text-[18px] font-semibold leading-6 text-white">
                  {currentLabel}
                </span>
                <span className="shrink-0 text-[12px] text-white/35 group-hover:text-white/70">
                  ✎
                </span>
                {isCustomLabel && (
                  <span className="shrink-0 rounded-full bg-amber-300/14 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-100">
                    renamed
                  </span>
                )}
              </button>
            )}
            {renameError && (
              <div className="mt-1 text-[11px] font-medium text-rose-200">
                {renameError}
              </div>
            )}
            <div className="mt-0.5 truncate font-mono text-[11px] leading-4 text-white/35">
              {sandbox.name}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {run && (
              <span className="flex items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/75">
                <span className={`h-2 w-2 rounded-full ${statusDot(run.status)}`} />
                {run.status}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-md bg-white/[0.07] text-white/72 hover:bg-white/[0.16] hover:text-white"
              aria-label="Close"
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 gap-1 border-b border-white/8 bg-slate-900/30 px-4 py-2">
          {(
            [
              { id: "status" as Tab, label: "Run + Outputs" },
              { id: "policies" as Tab, label: `Policies${policies.length ? ` (${policies.filter((p) => p.enabled).length})` : ""}` },
              { id: "chat" as Tab, label: `Sandbox Chat${localMessages.length ? ` (${localMessages.length})` : ""}` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition ${
                tab === t.id
                  ? "bg-cyan-300/14 text-cyan-100"
                  : "text-white/55 hover:bg-white/[0.06] hover:text-white/82"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 text-white/82">
          {tab === "status" && (
            <StatusTab
              run={run}
              outputs={outputs}
              errors={errors}
              team={team}
              sandbox={sandbox}
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
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status tab
// ─────────────────────────────────────────────────────────────────────────────

function StatusTab({
  run,
  outputs,
  errors,
  team,
  sandbox,
}: {
  run: NemoClawSandbox["run_status"] | null | undefined;
  outputs: [string, string][];
  errors: [string, string][];
  team: NonNullable<NemoClawSandbox["assigned_agent_details"]>;
  sandbox: NemoClawSandbox;
}) {
  return (
    <div className="space-y-4">
      {/* Run summary */}
      {run ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            {run.mode && (
              <span
                title={
                  run.mode === "coordinated"
                    ? "Each lobster's OpenClaw turn sees the prior teammates' outputs and builds on them."
                    : undefined
                }
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                  run.mode === "coordinated"
                    ? "bg-cyan-300/22 text-cyan-50"
                    : run.mode === "sequential"
                      ? "bg-amber-300/18 text-amber-100"
                      : "bg-cyan-300/16 text-cyan-100"
                }`}
              >
                {run.mode === "coordinated"
                  ? "Coordinated relay"
                  : run.mode === "sequential"
                    ? "Sequential — no in-sandbox chat"
                    : "Single agent"}
              </span>
            )}
            {(run.policies ?? []).map((p) => (
              <span
                key={p}
                className="rounded-full bg-emerald-300/14 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-100"
              >
                policy: {p}
              </span>
            ))}
            {run.phase && (
              <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/70">
                phase: {run.phase}
              </span>
            )}
          </div>
          {run.task && (
            <div className="mt-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">
                Task
              </div>
              <div className="mt-1 break-words text-[13px] leading-5 text-white/85">
                {run.task}
              </div>
            </div>
          )}
          {run.last_message && (
            <div className="mt-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">
                Latest
              </div>
              <div className="mt-1 text-[12px] leading-5 text-white/72">
                {run.last_message}
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-white/38">
            <span>run_id: {run.run_id}</span>
            {run.current_agent && <span>active: {run.current_agent}</span>}
            {run.started_at && <span>started: {formatTime(run.started_at)}</span>}
            {run.finished_at && <span>finished: {formatTime(run.finished_at)}</span>}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-10 text-center text-[13px] font-medium text-white/55">
          No active run for this sandbox.
          <br />
          Drop lobsters in and click <span className="font-semibold text-white/82">Run Team</span> in the dock to start one.
        </div>
      )}

      {/* Attempted violations — red rows visible to the user */}
      {run?.violations && run.violations.length > 0 && (
        <section>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-rose-100/85">
            🔒 Attempted violations ({run.violations.length})
          </div>
          <div className="space-y-2">
            {run.violations.map((v, idx) => (
              <div
                key={`v-${idx}`}
                className="rounded-xl border border-rose-300/26 bg-rose-300/[0.08] px-4 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-rose-300/22 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-50">
                    {v.kind}
                  </span>
                  <span className="text-[12px] font-semibold text-rose-50">
                    {v.agent}
                  </span>
                  <span className="text-[11px] text-rose-100/80">
                    {v.label}
                  </span>
                </div>
                <pre className="mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded bg-slate-950/40 px-2.5 py-1.5 font-mono text-[10px] leading-4 text-white/65">
                  {v.snippet}
                </pre>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Per-agent outputs */}
      {(outputs.length > 0 || errors.length > 0) && (
        <section>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/40">
            Per-agent results
          </div>
          <div className="space-y-2.5">
            {outputs.map(([agent, text]) => (
              <div
                key={`out-${agent}`}
                className="rounded-xl border border-emerald-300/22 bg-emerald-300/[0.05] px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: AGENT_COLORS[agent] ?? "#5eead4" }}
                  />
                  <span className="text-[13px] font-semibold text-emerald-50">
                    {agent}
                  </span>
                  <span className="text-[11px] font-medium uppercase text-emerald-200/75">
                    finished
                  </span>
                </div>
                <div className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-white/85">
                  {text}
                </div>
              </div>
            ))}
            {errors.map(([agent, text]) => (
              <div
                key={`err-${agent}`}
                className="rounded-xl border border-rose-300/24 bg-rose-300/[0.07] px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: AGENT_COLORS[agent] ?? "#fda4af" }}
                  />
                  <span className="text-[13px] font-semibold text-rose-50">
                    {agent}
                  </span>
                  <span className="text-[11px] font-medium uppercase text-rose-200/85">
                    error
                  </span>
                </div>
                <div className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-white/85">
                  {text}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Team capabilities — real OpenClaw skills first (these are actually
          installed on each agent inside the sandbox), then soft trait chips. */}
      {team.length > 0 && (
        <section>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/40">
            Team capabilities
          </div>
          {(() => {
            const skills: string[] = [];
            const traits: string[] = [];
            for (const agent of team) {
              for (const s of agent.openclaw_skills ?? []) {
                if (!skills.includes(s)) skills.push(s);
              }
              for (const t of agent.tools ?? []) {
                if (!traits.includes(t)) traits.push(t);
              }
            }
            if (skills.length === 0 && traits.length === 0) {
              return (
                <div className="text-[12px] text-white/45">
                  None of this team's lobsters have capabilities listed.
                </div>
              );
            }
            return (
              <div className="space-y-2">
                {skills.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-100/72">
                      Installed OpenClaw skills
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {skills.map((s) => (
                        <span
                          key={s}
                          className="rounded-full bg-emerald-300/16 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-50"
                          title={`Real ClawHub skill installed via openclaw skills install ${s}`}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {traits.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-white/40">
                      Personality traits (soft prompt bias)
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {traits.map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-cyan-300/14 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-50"
                          title={`Soft trait: ${t}`}
                        >
                          {t.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </section>
      )}

      {/* Team roster */}
      <section>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/40">
          Team in this sandbox
        </div>
        {team.length === 0 ? (
          <div className="text-[12px] text-white/45">
            No lobsters assigned. Drag claws into this workspace from the dock or the reef.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {team.map((agent) => (
              <span
                key={agent.name}
                title={agent.tools?.length ? `Tools: ${agent.tools.join(", ")}` : undefined}
                className="flex items-center gap-2 rounded-full bg-white/[0.08] px-3 py-1.5 text-[12px] font-semibold text-white/85"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: AGENT_COLORS[agent.name] ?? "#94a3b8" }}
                />
                {agent.name}
                <span className="text-[10px] font-medium text-white/45">
                  {agent.role}
                </span>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-white/[0.04] px-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">
            Live
          </div>
          <div className="mt-0.5 text-[12px] font-semibold text-white/82">
            {sandbox.live ? "Yes — managed by NemoClaw" : "Configured but not live"}
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.04] px-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">
            Home room
          </div>
          <div className="mt-0.5 text-[12px] font-semibold text-white/82">
            {sandbox.home_room ?? "—"}
          </div>
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Policies tab — live editor
// ─────────────────────────────────────────────────────────────────────────────

function PoliciesTab({
  policies,
  error,
  busy,
  notice,
  preview,
  onPreview,
  onApply,
  onCancelPreview,
  onReload,
}: {
  policies: NemoClawPolicyPreset[];
  error: string | null;
  busy: string | null;
  notice: string | null;
  preview: { preset: string; enabled: boolean; output: string } | null;
  onPreview: (preset: string, enabled: boolean) => void;
  onApply: () => void;
  onCancelPreview: () => void;
  onReload: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] leading-5 text-white/65">
          Toggle a preset to preview what the NemoClaw policy CLI would do.
          Nothing is applied until you click <span className="font-semibold text-white/82">Apply</span>.
        </p>
        <button
          type="button"
          onClick={onReload}
          className="rounded-md bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white/72 hover:bg-white/[0.16] hover:text-white"
        >
          Reload
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-[12px] text-rose-100">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-300/24 bg-emerald-300/10 px-3 py-2 text-[12px] text-emerald-100">
          {notice}
        </div>
      )}

      {policies.length === 0 && !error ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-6 text-center text-[12px] text-white/55">
          Loading policies…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {policies.map((p) => {
            const isBusy = busy === p.name;
            const previewMatches = preview?.preset === p.name;
            const nextEnabled = previewMatches ? preview!.enabled : !p.enabled;
            return (
              <div
                key={p.name}
                className={`rounded-xl border px-3 py-3 transition ${
                  p.enabled
                    ? "border-emerald-300/22 bg-emerald-300/[0.05]"
                    : "border-white/10 bg-white/[0.04]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-white/88">
                      {p.name}
                    </div>
                    {p.description && (
                      <div className="mt-0.5 break-words text-[11px] leading-4 text-white/55">
                        {p.description}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      p.enabled
                        ? "bg-emerald-300/16 text-emerald-100"
                        : "bg-white/[0.08] text-white/65"
                    }`}
                  >
                    {p.enabled ? "on" : "off"}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onPreview(p.name, nextEnabled)}
                    className="rounded-md bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white/82 hover:bg-white/[0.16] disabled:opacity-40"
                  >
                    {isBusy ? "Working…" : `Preview turning ${nextEnabled ? "on" : "off"}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {preview && (
        <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/[0.08] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-cyan-100/85">
                Preview
              </div>
              <div className="mt-0.5 text-[13px] font-semibold text-white">
                Will {preview.enabled ? "enable" : "disable"} {preview.preset}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={onCancelPreview}
                className="rounded-md bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white/72 hover:bg-white/[0.16] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onApply}
                disabled={busy === preview.preset}
                className="rounded-md bg-cyan-300/30 px-3 py-1 text-[11px] font-bold uppercase text-cyan-50 hover:bg-cyan-300/45 disabled:opacity-40"
              >
                {busy === preview.preset ? "Applying…" : "Apply"}
              </button>
            </div>
          </div>
          {preview.output && (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-slate-950/40 px-3 py-2 font-mono text-[11px] leading-4 text-white/75">
              {preview.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat tab
// ─────────────────────────────────────────────────────────────────────────────

function ChatTab({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-10 text-center text-[13px] font-medium text-white/55">
        No chatter in this sandbox yet. Reef chat between 2+ assigned lobsters
        will appear here; nothing from the reef commons leaks in.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className="rounded-lg bg-white/[0.05] px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: AGENT_COLORS[msg.agent] ?? "#94a3b8" }}
            />
            <span className="text-[12px] font-semibold text-white/86">
              {msg.agent}
            </span>
            <span className="text-[11px] font-medium text-white/35">
              {formatTime(msg.timestamp)}
            </span>
            {msg.target && msg.target !== "all" && (
              <span className="text-[10px] font-medium uppercase text-white/35">
                → {msg.target}
              </span>
            )}
          </div>
          <div className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-white/82">
            {msg.message}
          </div>
        </div>
      ))}
    </div>
  );
}
