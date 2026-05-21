import React from "react";
import type { AgentInfo, ChatMessage, ActivityEntry } from "../types";
import { getClawMetadata } from "../utils/claws";
import { AGENT_COLORS, ROLE_LABELS } from "../utils/sprites";

interface AgentDetailProps {
  agent: AgentInfo;
  thoughts: ActivityEntry[];
  recentMessages: ChatMessage[];
  onClose: () => void;
}

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function StateBadge({ state }: { state: string }) {
  const stateColors: Record<string, string> = {
    idle: "bg-gray-100 text-gray-500",
    researching: "bg-teal-50 text-teal-700",
    collaborating: "bg-purple-50 text-purple-700",
    presenting: "bg-yellow-50 text-yellow-700",
    coding: "bg-green-50 text-green-700",
    thinking: "bg-blue-50 text-blue-700",
    walking: "bg-orange-50 text-orange-700",
  };

  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
        stateColors[state] ?? "bg-gray-100 text-gray-500"
      }`}
    >
      {state}
    </span>
  );
}

export default function AgentDetail({
  agent,
  thoughts,
  recentMessages,
  onClose,
}: AgentDetailProps) {
  const color = AGENT_COLORS[agent.name] ?? "#999";
  const claw = getClawMetadata(agent.name);
  const clawId = agent.claw_id ?? claw?.clawId;
  const sandboxName = agent.sandbox_name;
  const connectCommand = agent.connect_command;

  return (
    <div className="animate-fade-in flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="m-4 mb-3 rounded-2xl border border-white/55 bg-white/55 px-4 py-3 shadow-sm backdrop-blur">
        <div className="mb-2 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-base font-bold text-white shadow-sm"
              style={{ backgroundColor: color }}
            >
              {agent.name[0]}
            </div>
            <div className="flex flex-col gap-1 pt-1">
              <span className="text-base font-semibold" style={{ color }}>
                {agent.name}
              </span>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {ROLE_LABELS[agent.role]}
                </span>
                <StateBadge state={agent.state} />
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-white/65 px-2.5 py-1 text-sm leading-none text-slate-400 transition-colors hover:text-slate-700"
          >
            x
          </button>
        </div>
      </div>

      {/* Current task */}
      {agent.current_task && (
        <div className="mx-4 mb-2 rounded-2xl border border-white/55 bg-white/42 px-4 py-3 shadow-sm backdrop-blur">
          <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">
            Current Task
          </p>
          <p className="text-sm leading-relaxed text-slate-700">{agent.current_task}</p>
        </div>
      )}

      {/* Location */}
      <div className="mx-4 mb-2 rounded-2xl border border-white/55 bg-white/42 px-4 py-3 shadow-sm backdrop-blur">
        <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">
          Location
        </p>
        <p className="text-sm text-slate-700">
          {agent.location.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
        </p>
      </div>

      {(clawId || sandboxName || connectCommand) && (
        <div className="mx-4 mb-2 rounded-2xl border border-white/55 bg-white/42 px-4 py-3 shadow-sm backdrop-blur">
          <p className="mb-2 text-[10px] font-bold uppercase text-slate-400">
            Runtime
          </p>
          <div className="space-y-2 text-sm text-slate-700">
            {clawId && (
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-normal text-slate-400">
                  OpenClaw
                </span>
                <span className="font-mono text-[12px] text-slate-700">{clawId}</span>
              </div>
            )}
            {sandboxName && (
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-normal text-slate-400">
                  NemoClaw Sandbox
                </span>
                <span className="font-mono text-[12px] text-slate-700">{sandboxName}</span>
              </div>
            )}
            {connectCommand && (
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-normal text-slate-400">
                  Connect
                </span>
                <span className="font-mono text-[12px] text-slate-700">{connectCommand}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Thoughts */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {thoughts.length > 0 && (
          <div className="mb-2 rounded-2xl border border-white/55 bg-white/42 px-4 py-3 shadow-sm backdrop-blur">
            <p className="mb-2 text-[10px] font-bold uppercase text-slate-400">
              Recent Thoughts
            </p>
            <div className="space-y-1.5">
              {thoughts.slice(-5).map((t) => (
                <div key={t.id} className="text-sm italic text-slate-500">
                  <span className="mr-1 text-[11px] text-slate-400">
                    {formatTime(t.timestamp)}
                  </span>
                  {t.content}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent messages */}
        {recentMessages.length > 0 && (
          <div className="rounded-2xl border border-white/55 bg-white/42 px-4 py-3 shadow-sm backdrop-blur">
            <p className="mb-2 text-[10px] font-bold uppercase text-slate-400">
              Recent Activity
            </p>
            <div className="space-y-1.5">
              {recentMessages.slice(-8).map((m) => (
                <div key={m.id} className="text-sm text-slate-600">
                  <span className="mr-1 text-[11px] text-slate-400">
                    {formatTime(m.timestamp)}
                  </span>
                  {m.type === "think" ? (
                    <span className="italic text-gray-500">
                      {m.message}
                    </span>
                  ) : (
                    <>
                      {m.target !== "all" && m.target !== "self" && (
                        <span className="text-slate-500">
                          to {m.target}:{" "}
                        </span>
                      )}
                      {m.message}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {thoughts.length === 0 && recentMessages.length === 0 && (
          <div className="flex h-32 items-center justify-center rounded-2xl border border-white/45 bg-white/30 text-sm text-slate-400">
            No recent activity
          </div>
        )}
      </div>
    </div>
  );
}
