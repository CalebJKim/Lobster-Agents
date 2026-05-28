import type { SandboxConsoleLine } from "../../types";
import { formatTime } from "./format";

export default function ConsoleTab({ lines }: { lines: SandboxConsoleLine[] }) {
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
    <div className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-3 font-mono text-[11px] leading-5 text-white/82">
      {lines.map((entry, idx) => (
        <div
          key={idx}
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
      ))}
    </div>
  );
}
