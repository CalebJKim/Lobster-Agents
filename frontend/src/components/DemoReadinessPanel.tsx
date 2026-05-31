import { useCallback, useEffect, useMemo, useState } from "react";
import type { DemoReadiness, DemoReadinessCheck, DemoReadinessStatus } from "../types";
import { fetchDemoReadiness } from "../utils/sandboxApi";
import { DEMO_SCENARIOS } from "../utils/demoScenarios";

interface DemoReadinessPanelProps {
  open: boolean;
  sandboxName?: string | null;
  onClose: () => void;
}

function statusStyle(status: DemoReadinessStatus) {
  if (status === "ok") return "border-emerald-300/22 bg-emerald-300/[0.06] text-emerald-50";
  if (status === "warn") return "border-amber-300/28 bg-amber-300/[0.07] text-amber-50";
  return "border-rose-300/28 bg-rose-300/[0.08] text-rose-50";
}

function statusDot(status: DemoReadinessStatus) {
  if (status === "ok") return "bg-emerald-200";
  if (status === "warn") return "bg-amber-200";
  return "bg-rose-200";
}

function CheckRow({ check }: { check: DemoReadinessCheck }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${statusStyle(check.status)}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${statusDot(check.status)}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[12px] font-semibold text-white/92">
              {check.label}
            </div>
            <span className="rounded-full bg-white/[0.10] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/72">
              {check.status}
            </span>
          </div>
          {check.detail && (
            <div className="mt-1 break-words text-[11px] leading-4 text-white/68">
              {check.detail}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function readinessSummaryText(readiness: DemoReadiness) {
  const lines = [
    "Lobster Agents demo readiness",
    `sandbox: ${readiness.selected_sandbox ?? "default"}`,
    `ok: ${readiness.summary.ok}`,
    `warnings: ${readiness.summary.warn}`,
    `blockers: ${readiness.summary.fail}`,
    "",
    "checks:",
  ];
  for (const check of readiness.checks) {
    lines.push(`- ${check.status}: ${check.label} - ${check.detail}`);
  }
  const enabled = readiness.policy_snapshot?.enabled ?? [];
  lines.push("", `enabled policies: ${enabled.join(", ") || "none"}`);
  const pending = readiness.network_rules?.counts?.pending ?? 0;
  lines.push(`pending OpenShell rules: ${pending}`);
  lines.push(`Hermes configured: ${readiness.hermes?.configured === true ? "yes" : "no"}`);
  return lines.join("\n");
}

export default function DemoReadinessPanel({
  open,
  sandboxName,
  onClose,
}: DemoReadinessPanelProps) {
  const [readiness, setReadiness] = useState<DemoReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setReadiness(await fetchDemoReadiness(sandboxName));
    } catch (err) {
      setReadiness(null);
      setError(err instanceof Error ? err.message : "Could not load demo readiness");
    } finally {
      setBusy(false);
    }
  }, [sandboxName]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [load, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  const grouped = useMemo(() => {
    const checks = readiness?.checks ?? [];
    return {
      fail: checks.filter((check) => check.status === "fail"),
      warn: checks.filter((check) => check.status === "warn"),
      ok: checks.filter((check) => check.status === "ok"),
    };
  }, [readiness]);

  if (!open) return null;

  const summary = readiness?.summary;
  const selected = readiness?.selected_sandbox ?? sandboxName ?? "default sandbox";
  const nextAction =
    !readiness
      ? "Run a readiness check."
      : grouped.fail.length > 0
        ? `Fix ${grouped.fail[0].label}: ${grouped.fail[0].detail}`
        : grouped.warn.some((check) => check.id === "hermes")
          ? "Demo OpenClaw lobsters first; crabs are visual until Hermes is configured."
          : grouped.warn.length > 0
            ? "Proceed, but call out the listed warnings during the demo."
            : "Start with Relay Check, then show policies and generated accessories.";

  const copyReadiness = async () => {
    if (!readiness) return;
    try {
      await navigator.clipboard.writeText(readinessSummaryText(readiness));
      setCopyNotice("Readiness summary copied.");
    } catch {
      setCopyNotice("Could not copy automatically.");
    }
    window.setTimeout(() => setCopyNotice(null), 2200);
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[min(82vh,760px)] w-[min(92vw,780px)] flex-col overflow-hidden rounded-2xl border border-white/14 bg-slate-950/94 text-white shadow-[0_40px_120px_rgba(4,22,31,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/8 bg-slate-900/45 px-6 py-4">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-cyan-100/60">
              Demo readiness
            </div>
            <div className="mt-1 truncate text-[20px] font-semibold leading-7 text-white">
              {readiness?.ok ? "Ready to demo" : readiness ? "Needs attention" : "Checking demo stack"}
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-white/42">
              {selected}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={load}
              disabled={busy}
              className="h-8 rounded-lg bg-white/[0.08] px-3 text-[11px] font-bold uppercase tracking-wide text-white/70 hover:bg-white/[0.16] hover:text-white disabled:opacity-45"
            >
              {busy ? "Checking" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={copyReadiness}
              disabled={!readiness}
              className="h-8 rounded-lg bg-cyan-300/12 px-3 text-[11px] font-bold uppercase tracking-wide text-cyan-50 hover:bg-cyan-300/20 disabled:opacity-45"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.08] text-white/70 hover:bg-white/[0.16] hover:text-white"
              aria-label="Close"
              title="Close"
            >
              x
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {summary && (
            <div className="mb-4 grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-emerald-300/18 bg-emerald-300/[0.06] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-100/65">Ok</div>
                <div className="mt-0.5 text-lg font-semibold text-emerald-50">{summary.ok}</div>
              </div>
              <div className="rounded-lg border border-amber-300/22 bg-amber-300/[0.07] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-amber-100/65">Warnings</div>
                <div className="mt-0.5 text-lg font-semibold text-amber-50">{summary.warn}</div>
              </div>
              <div className="rounded-lg border border-rose-300/22 bg-rose-300/[0.08] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-rose-100/65">Blockers</div>
                <div className="mt-0.5 text-lg font-semibold text-rose-50">{summary.fail}</div>
              </div>
            </div>
          )}

          <div className="mb-4 rounded-xl border border-cyan-300/18 bg-cyan-300/[0.07] px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-cyan-100/70">
              Next best action
            </div>
            <div className="mt-1 text-[12px] leading-5 text-white/78">
              {nextAction}
            </div>
            {copyNotice && (
              <div className="mt-2 text-[11px] font-medium text-cyan-100/80">
                {copyNotice}
              </div>
            )}
          </div>

          <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-white/42">
                  Demo runbook
                </div>
                <div className="mt-1 text-[12px] leading-5 text-white/58">
                  Use these in the Task Monitor quick-start row.
                </div>
              </div>
              <span className="rounded-full bg-cyan-300/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-50">
                {DEMO_SCENARIOS.length} scenarios
              </span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {DEMO_SCENARIOS.map((scenario, index) => (
                <div
                  key={scenario.id}
                  className="rounded-lg border border-white/10 bg-slate-950/30 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-cyan-300/14 text-[10px] font-bold text-cyan-50">
                      {index + 1}
                    </span>
                    <span className="text-[12px] font-semibold text-white/88">
                      {scenario.label}
                    </span>
                    <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white/45">
                      {scenario.badge}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] leading-4 text-white/58">
                    {scenario.description}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-300/26 bg-rose-300/[0.08] px-4 py-3 text-[12px] leading-5 text-rose-50">
              {error}
            </div>
          )}

          {!readiness && !error && (
            <div className="grid min-h-40 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-[13px] text-white/58">
              Checking the live demo stack...
            </div>
          )}

          {readiness && (
            <div className="space-y-4">
              {grouped.fail.length > 0 && (
                <section>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-rose-100/75">
                    Fix before demo
                  </div>
                  <div className="space-y-2">
                    {grouped.fail.map((check) => <CheckRow key={check.id} check={check} />)}
                  </div>
                </section>
              )}

              {grouped.warn.length > 0 && (
                <section>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-amber-100/75">
                    Safe warnings
                  </div>
                  <div className="space-y-2">
                    {grouped.warn.map((check) => <CheckRow key={check.id} check={check} />)}
                  </div>
                </section>
              )}

              <section>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-white/42">
                  Passing checks
                </div>
                <div className="space-y-2">
                  {grouped.ok.map((check) => <CheckRow key={check.id} check={check} />)}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
