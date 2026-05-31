import { useMemo, useState } from "react";
import type { SandboxConsoleLine } from "../../types";
import { formatTime } from "./format";

export default function ConsoleTab({ lines }: { lines: SandboxConsoleLine[] }) {
  const [streamFilter, setStreamFilter] = useState<"all" | "stdout" | "stderr">("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [query, setQuery] = useState("");
  const agents = useMemo(
    () => Array.from(new Set(lines.map((line) => line.agent).filter(Boolean))).sort(),
    [lines],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((line) => {
      if (streamFilter !== "all" && line.stream !== streamFilter) return false;
      if (agentFilter !== "all" && line.agent !== agentFilter) return false;
      if (q && !`${line.agent} ${line.stream} ${line.line}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [agentFilter, lines, query, streamFilter]);

  if (lines.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-10 text-center text-[13px] font-medium text-white/55">
        No console output yet. Once a Run Team task fires, this tab will stream
        the OpenClaw subprocess output as each agent runs — tool calls,
        progress logs, errors. Stays empty between runs.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter console..."
            className="h-8 min-w-40 flex-1 rounded-md border border-white/10 bg-slate-950/45 px-2.5 text-[12px] text-white outline-none placeholder:text-white/30 focus:border-cyan-200/40"
          />
          <select
            value={streamFilter}
            onChange={(event) => setStreamFilter(event.target.value as "all" | "stdout" | "stderr")}
            className="h-8 rounded-md border border-white/10 bg-slate-950/70 px-2 text-[11px] font-semibold text-white/72 outline-none"
          >
            <option value="all">all streams</option>
            <option value="stdout">stdout</option>
            <option value="stderr">stderr</option>
          </select>
          <select
            value={agentFilter}
            onChange={(event) => setAgentFilter(event.target.value)}
            className="h-8 rounded-md border border-white/10 bg-slate-950/70 px-2 text-[11px] font-semibold text-white/72 outline-none"
          >
            <option value="all">all agents</option>
            {agents.map((agent) => (
              <option key={agent} value={agent}>
                {agent}
              </option>
            ))}
          </select>
          <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/45">
            {filtered.length}/{lines.length}
          </span>
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-3 font-mono text-[11px] leading-5 text-white/82">
        {filtered.length === 0 ? (
          <div className="px-2 py-6 text-center font-sans text-[12px] text-white/45">
            No console lines match the current filters.
          </div>
        ) : (
          filtered.map((entry, idx) => (
            <div
              key={`${entry.timestamp}-${idx}`}
              className={`flex items-baseline gap-2 ${
                entry.stream === "stderr" ? "text-amber-100/85" : "text-white/82"
              }`}
            >
              <span className="shrink-0 text-[9px] text-white/35">
                {formatTime(entry.timestamp)}
              </span>
              <span
                className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase"
                style={{
                  backgroundColor:
                    entry.stream === "stderr" ? "rgba(252,211,77,0.18)" : "rgba(125,211,252,0.12)",
                }}
              >
                {entry.agent}
              </span>
              <span className="break-words whitespace-pre-wrap">{entry.line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
