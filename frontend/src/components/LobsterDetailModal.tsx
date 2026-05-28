import { useEffect } from "react";
import type { AgentInfo, ChatMessage, ActivityEntry } from "../types";
import { getClawMetadata } from "../utils/claws";
import { AGENT_COLORS, ROLE_LABELS } from "../utils/sprites";
import LobsterStage from "./LobsterStage";

interface Props {
  agent: AgentInfo;
  thoughts: ActivityEntry[];
  recentMessages: ChatMessage[];
  onClose: () => void;
}

function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

const STATE_BADGE: Record<string, string> = {
  idle: "bg-slate-700/40 text-slate-200",
  researching: "bg-teal-500/20 text-teal-200",
  collaborating: "bg-purple-500/20 text-purple-200",
  presenting: "bg-amber-500/20 text-amber-100",
  coding: "bg-emerald-500/20 text-emerald-200",
  thinking: "bg-sky-500/20 text-sky-200",
  walking: "bg-orange-500/20 text-orange-100",
};

export default function LobsterDetailModal({
  agent,
  thoughts,
  recentMessages,
  onClose,
}: Props) {
  const color = AGENT_COLORS[agent.name] ?? "#9ad7ff";
  const claw = getClawMetadata(agent.name);
  const clawId = agent.claw_id ?? claw?.clawId;
  const sandboxName = agent.sandbox_name;
  const connectCommand = agent.connect_command;

  // Esc closes the modal.
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="grid w-[min(960px,92vw)] max-h-[88vh] grid-cols-1 overflow-hidden rounded-2xl border border-white/14 bg-slate-950/96 text-white shadow-[0_60px_120px_-40px_rgba(0,0,0,0.7)] md:grid-cols-[44%_56%]"
      >
        {/* Left — rotating 3D lobster */}
        <div className="relative h-72 md:h-[560px]">
          <LobsterStage agent={agent} className="h-full w-full bg-[#9cd6e0]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 to-transparent px-5 pb-4 pt-12">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
              {ROLE_LABELS[agent.role] ?? agent.role}
            </p>
            <p className="text-2xl font-bold leading-tight" style={{ color }}>
              {agent.name}
            </p>
          </div>
        </div>

        {/* Right — info pane */}
        <div className="flex max-h-[88vh] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                  STATE_BADGE[agent.state] ?? "bg-white/10 text-white/70"
                }`}
              >
                {agent.state}
              </span>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/70">
                {agent.location.replace(/_/g, " ")}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-md bg-white/10 text-base font-semibold leading-none text-white/70 transition hover:bg-white/16 hover:text-white"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {agent.current_task && (
              <section className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-white/45">
                  Current Task
                </p>
                <p className="text-[13px] leading-relaxed text-white/85">
                  {agent.current_task}
                </p>
              </section>
            )}

            {(clawId || sandboxName || connectCommand) && (
              <section className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/45">
                  Runtime
                </p>
                <div className="space-y-2 text-[12px]">
                  {clawId && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
                        OpenClaw
                      </p>
                      <p className="font-mono text-white/85">{clawId}</p>
                    </div>
                  )}
                  {sandboxName && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
                        NemoClaw Sandbox
                      </p>
                      <p className="font-mono text-white/85">{sandboxName}</p>
                    </div>
                  )}
                  {connectCommand && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
                        Connect
                      </p>
                      <p className="break-all font-mono text-white/85">{connectCommand}</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {agent.tools && agent.tools.length > 0 && (
              <section className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/45">
                  Soft Tools
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {agent.tools.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/80"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {agent.openclaw_skills && agent.openclaw_skills.length > 0 && (
              <section className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/45">
                  OpenClaw Skills
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {agent.openclaw_skills.map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] text-emerald-100"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {thoughts.length > 0 && (
              <section className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/45">
                  Recent Thoughts
                </p>
                <div className="space-y-1.5">
                  {thoughts.slice(-5).map((t) => (
                    <div key={t.id} className="text-[12px] italic text-white/70">
                      <span className="mr-1 text-[10px] text-white/40">
                        {formatTime(t.timestamp)}
                      </span>
                      {t.content}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {recentMessages.length > 0 && (
              <section className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/45">
                  Recent Activity
                </p>
                <div className="space-y-1.5">
                  {recentMessages.slice(-10).map((m) => (
                    <div key={m.id} className="text-[12px] text-white/80">
                      <span className="mr-1 text-[10px] text-white/40">
                        {formatTime(m.timestamp)}
                      </span>
                      {m.type === "think" ? (
                        <span className="italic text-white/55">{m.message}</span>
                      ) : (
                        <>
                          {m.target && m.target !== "all" && m.target !== "self" && (
                            <span className="text-white/55">to {m.target}: </span>
                          )}
                          {m.message}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {thoughts.length === 0 && recentMessages.length === 0 && (
              <div className="grid h-32 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-[12px] text-white/45">
                No recent activity
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
