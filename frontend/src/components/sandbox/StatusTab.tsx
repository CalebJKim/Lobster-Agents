import type { NemoClawSandbox } from "../../types";
import { AGENT_COLORS } from "../../utils/sprites";
import { formatTime } from "./format";

interface StatusTabProps {
  run: NemoClawSandbox["run_status"] | null | undefined;
  outputs: [string, string][];
  errors: [string, string][];
  team: NonNullable<NemoClawSandbox["assigned_agent_details"]>;
}

export default function StatusTab({
  run,
  outputs,
  errors,
  team,
}: StatusTabProps) {
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
        <div className="grid place-items-center rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.03] to-white/[0.01] px-6 py-14 text-center">
          <div className="mb-3 text-3xl opacity-50">🦞</div>
          <div className="text-[14px] font-semibold text-white/85">
            No active run in this sandbox
          </div>
          <div className="mt-1.5 max-w-xs text-[12px] leading-5 text-white/55">
            Drop lobsters in and click{" "}
            <span className="rounded bg-white/[0.10] px-1.5 py-0.5 font-semibold text-white/85">
              Run Team
            </span>{" "}
            in the dock to start one.
          </div>
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

    </div>
  );
}
