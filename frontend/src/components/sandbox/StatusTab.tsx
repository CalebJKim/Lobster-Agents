import type {
  NemoClawSandbox,
  NemoClawRunStatus,
  OpenClawSkillStatus,
  SandboxRunDiagnostics,
} from "../../types";
import { AGENT_COLORS } from "../../utils/sprites";
import { formatDuration, formatTime } from "./format";

interface StatusTabProps {
  run: NemoClawSandbox["run_status"] | null | undefined;
  outputs: [string, string][];
  errors: [string, string][];
  team: NonNullable<NemoClawSandbox["assigned_agent_details"]>;
  diagnostics?: SandboxRunDiagnostics | null;
}

type TimelineState = "done" | "active" | "failed" | "partial" | "pending";

interface TimelineStep {
  id: string;
  label: string;
  detail: string;
  state: TimelineState;
  meta?: string;
}

function timelineTone(state: TimelineState): string {
  if (state === "done") return "border-emerald-300/24 bg-emerald-300/[0.07] text-emerald-50";
  if (state === "active") return "border-cyan-300/28 bg-cyan-300/[0.08] text-cyan-50";
  if (state === "partial") return "border-amber-300/28 bg-amber-300/[0.08] text-amber-50";
  if (state === "failed") return "border-rose-300/28 bg-rose-300/[0.08] text-rose-50";
  return "border-white/10 bg-white/[0.035] text-white/55";
}

function timelineDot(state: TimelineState): string {
  if (state === "done") return "bg-emerald-200";
  if (state === "active") return "bg-cyan-200 shadow-[0_0_18px_rgba(125,211,252,0.55)]";
  if (state === "partial") return "bg-amber-200";
  if (state === "failed") return "bg-rose-200";
  return "bg-white/28";
}

function buildTimeline(
  run: NemoClawRunStatus,
  skillStatus: Record<string, OpenClawSkillStatus>,
): TimelineStep[] {
  const agentRuns = run.agent_runs ?? {};
  const agents = run.agents?.length ? run.agents : Object.keys(agentRuns);
  const outputs = run.outputs ?? {};
  const errors = run.errors ?? {};
  const skillEntries = Object.entries(skillStatus);
  const finished = run.status === "finished";

  const profileState: TimelineState =
    run.phase === "profile"
      ? "active"
      : skillEntries.length > 0 || run.phase === "openclaw" || finished
        ? "done"
        : "pending";
  const skillProblems = skillEntries.filter(([, status]) => status.success === false).length;
  const readySkillCount = skillEntries.reduce(
    (sum, [, status]) => sum + (status.ready?.length ?? 0),
    0,
  );

  const steps: TimelineStep[] = [
    {
      id: "profile",
      label: "Profile setup",
      detail:
        profileState === "active"
          ? `Preparing ${run.current_agent ?? "the first agent"} in OpenClaw.`
          : profileState === "done"
            ? `${skillEntries.length || agents.length} profile${(skillEntries.length || agents.length) === 1 ? "" : "s"} prepared.`
            : "Waiting for OpenClaw profile setup.",
      state: profileState,
      meta: run.phase === "profile" ? "active" : undefined,
    },
    {
      id: "skills",
      label: "Skill readiness",
      detail:
        skillEntries.length > 0
          ? `${readySkillCount} ready skill${readySkillCount === 1 ? "" : "s"} reported${skillProblems ? `; ${skillProblems} profile issue${skillProblems === 1 ? "" : "s"}` : ""}.`
          : "Skill readiness will appear after profile setup.",
      state: skillProblems > 0 ? "partial" : skillEntries.length > 0 ? "done" : "pending",
    },
  ];

  for (const agent of agents) {
    const agentRun = agentRuns[agent];
    const output = outputs[agent];
    const error = errors[agent] || agentRun?.failure_detail || agentRun?.partial_output;
    const isActive = run.current_agent === agent && run.phase === "openclaw" && !finished;
    const state: TimelineState =
      agentRun?.success === true || output
        ? "done"
        : agentRun?.success === false || error
          ? "failed"
          : isActive
            ? "active"
            : "pending";
    steps.push({
      id: `agent-${agent}`,
      label: agent,
      detail:
        state === "done"
          ? "OpenClaw turn finished."
          : state === "failed"
            ? String(error || "OpenClaw turn failed.")
            : state === "active"
              ? "OpenClaw turn is running; timeout guard is active."
              : "Waiting for relay turn.",
      state,
      meta: agentRun?.execution_mode || (isActive ? "active turn" : undefined),
    });
  }

  steps.push({
    id: "result",
    label: "Result",
    detail:
      finished
        ? run.last_message || "Run finished."
        : run.last_message || "Waiting for final relay result.",
    state:
      finished && run.outcome === "success"
        ? "done"
        : finished && run.outcome === "partial"
          ? "partial"
          : finished
            ? "failed"
            : run.phase === "result"
              ? "active"
              : "pending",
  });
  steps.push({
    id: "diagnostics",
    label: "Diagnostics",
    detail:
      finished
        ? "Run diagnostics, partial output, and tool errors are preserved below."
        : "Diagnostics will be available when the run finishes.",
    state: finished ? "done" : "pending",
  });
  return steps;
}

function TimelineRow({ step }: { step: TimelineStep }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${timelineTone(step.state)}`}>
      <div className="flex items-start gap-2.5">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${timelineDot(step.state)}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-white/92">{step.label}</span>
            <span className="rounded-full bg-white/[0.10] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/64">
              {step.state}
            </span>
            {step.meta && (
              <span className="rounded-full bg-slate-950/28 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/45">
                {step.meta}
              </span>
            )}
          </div>
          <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/68">
            {step.detail}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StatusTab({
  run,
  outputs,
  errors,
  team,
  diagnostics,
}: StatusTabProps) {
  const skillStatus = diagnostics?.skill_status ?? run?.skill_status ?? {};
  const toolErrors = diagnostics?.tool_errors ?? run?.tool_errors ?? [];
  const failureKind = diagnostics?.failure_kind ?? run?.failure_kind;
  const failureDetail = diagnostics?.failure_detail ?? run?.failure_detail;
  const partialOutput = diagnostics?.partial_output ?? run?.partial_output ?? {};
  const timedOut = Boolean(diagnostics?.timed_out ?? run?.timed_out);
  const agentRuns = diagnostics?.agent_runs ?? run?.agent_runs ?? {};
  const totalCount = run?.total_count ?? run?.agents?.length ?? Object.keys(agentRuns).length;
  const successCount =
    run?.success_count ??
    Object.values(agentRuns).filter((agentRun) => agentRun?.success).length;
  const errorCount =
    run?.error_count ??
    Math.max(0, totalCount - successCount);
  const outcome = run?.outcome;
  const outcomeLabel =
    outcome === "success"
      ? "Run succeeded"
      : outcome === "partial"
        ? "Run partially succeeded"
        : outcome === "failed"
          ? "Run failed"
          : outcome === "empty"
            ? "Run finished with no agents"
          : null;
  const elapsed = run
    ? formatDuration(run.started_at, run.finished_at || run.last_update_at)
    : "";
  const timeline = run ? buildTimeline(run, skillStatus) : [];

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
            {elapsed && <span>elapsed: {elapsed}</span>}
            {timedOut && <span>timed_out: true</span>}
          </div>
          {outcomeLabel && run.status === "finished" && (
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-[12px] leading-5 ${
                outcome === "success"
                  ? "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-50"
                  : outcome === "partial"
                    ? "border-amber-300/24 bg-amber-300/[0.08] text-amber-50"
                    : "border-rose-300/24 bg-rose-300/[0.08] text-rose-50"
              }`}
            >
              <span className="font-semibold">{outcomeLabel}</span>
              {totalCount > 0 && (
                <span className="text-white/72">
                  {" "}
                  ({successCount}/{totalCount} agents succeeded
                  {errorCount > 0 ? `; ${errorCount} failed` : ""}).
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid place-items-center rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.03] to-white/[0.01] px-6 py-14 text-center">
          <div className="mb-3 text-3xl opacity-50">🦞</div>
          <div className="text-[14px] font-semibold text-white/85">
            No active run in this sandbox
          </div>
          <div className="mt-1.5 max-w-xs text-[12px] leading-5 text-white/55">
            Drop lobsters in and click{" "}
            <span className="rounded bg-white/[0.10] px-1.5 py-0.5 font-semibold text-white/85">
              Run
            </span>{" "}
            in the Task Monitor to start one.
          </div>
        </div>
      )}

      {run && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-white/40">
              Run timeline
            </div>
            {run.running && (
              <div className="rounded-full bg-cyan-300/12 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                active agent: {run.current_agent ?? "starting"}
              </div>
            )}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {timeline.map((step) => (
              <TimelineRow key={step.id} step={step} />
            ))}
          </div>
          {run.running && (
            <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-[11px] leading-4 text-white/55">
              Timeout hint: OpenClaw turn timeout is controlled by the backend; the sandbox config disables LLM idle timeout so slow first tokens do not falsely fail.
            </div>
          )}
        </section>
      )}

      {(failureKind || failureDetail || toolErrors.length > 0) && (
        <section>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-amber-100/85">
            Failure diagnostics{errorCount > 0 ? ` (${errorCount} agent${errorCount === 1 ? "" : "s"} failed)` : ""}
          </div>
          <div className="rounded-xl border border-amber-300/24 bg-amber-300/[0.07] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {failureKind && (
                <span className="rounded-full bg-amber-300/18 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-50">
                  {failureKind.replace(/_/g, " ")}
                </span>
              )}
              {timedOut && (
                <span className="rounded-full bg-rose-300/16 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-50">
                  timeout
                </span>
              )}
            </div>
            {failureDetail && (
              <div className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-white/78">
                {failureDetail}
              </div>
            )}
            {toolErrors.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {toolErrors.map((err, idx) => (
                  <div
                    key={`tool-${idx}`}
                    className="rounded-md bg-slate-950/35 px-2.5 py-1.5 text-[11px] leading-4 text-white/72"
                  >
                    <span className="font-semibold text-amber-100">
                      {err.agent ? `${err.agent}: ` : ""}
                      {err.tool ?? "tool"}
                    </span>
                    {" "}
                    {err.error}
                    {err.message ? ` — ${err.message}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {Object.keys(partialOutput).length > 0 && (
        <section>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/40">
            Partial output preserved
          </div>
          <div className="space-y-2">
            {Object.entries(partialOutput).map(([agent, text]) => (
              <pre
                key={`partial-${agent}`}
                className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 font-sans text-[12px] leading-5 text-white/72"
              >
                <span className="font-semibold text-white/88">{agent}</span>
                {"\n"}
                {text}
              </pre>
            ))}
          </div>
        </section>
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

      {/* Team capabilities — actual run-time skill readiness first, then
          requested OpenClaw skills and soft trait chips. */}
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
                {Object.keys(skillStatus).length > 0 && (
                  <div className="space-y-1.5">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-white/40">
                      Live OpenClaw skill readiness
                    </div>
                    {Object.entries(skillStatus).map(([agentName, status]) => (
                      <SkillStatusRow
                        key={agentName}
                        agentName={agentName}
                        status={status}
                      />
                    ))}
                  </div>
                )}
                {skills.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-100/72">
                      Requested OpenClaw skills
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

    </div>
  );
}

function SkillStatusRow({
  agentName,
  status,
}: {
  agentName: string;
  status: OpenClawSkillStatus;
}) {
  const groups = [
    { label: "ready", values: status.ready ?? [], cls: "bg-emerald-300/16 text-emerald-50" },
    { label: "needs setup", values: status.needs_setup ?? [], cls: "bg-amber-300/16 text-amber-50" },
    { label: "installed", values: status.installed ?? [], cls: "bg-cyan-300/14 text-cyan-50" },
    { label: "missing", values: status.missing ?? [], cls: "bg-rose-300/16 text-rose-50" },
    { label: "install failed", values: status.install_failed ?? [], cls: "bg-rose-300/22 text-rose-50" },
  ].filter((group) => group.values.length > 0);

  if (groups.length === 0 && (status.requested ?? []).length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-white/82">
          {agentName}
        </span>
        {status.success === false && (
          <span className="rounded-full bg-rose-300/16 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-50">
            profile issue
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {groups.length > 0 ? (
          groups.flatMap((group) =>
            group.values.map((value) => (
              <span
                key={`${group.label}-${value}`}
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${group.cls}`}
                title={group.label}
              >
                {group.label}: {value}
              </span>
            )),
          )
        ) : (
          (status.requested ?? []).map((value) => (
            <span
              key={`requested-${value}`}
              className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/65"
            >
              requested: {value}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
