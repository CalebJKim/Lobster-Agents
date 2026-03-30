import React from "react";
import type { WorkflowPhase } from "../hooks/useOfficeState";

interface WorkflowPipelineProps {
  phase: WorkflowPhase;
}

const PHASES: { key: WorkflowPhase; label: string; icon: string }[] = [
  { key: "gathering", label: "Gathering", icon: ">" },
  { key: "researching", label: "Researching", icon: "?" },
  { key: "analyzing", label: "Analyzing", icon: "#" },
  { key: "writing", label: "Writing", icon: "!" },
  { key: "done", label: "Done", icon: "*" },
];

const PHASE_ORDER: Record<WorkflowPhase, number> = {
  idle: -1,
  gathering: 0,
  researching: 1,
  analyzing: 2,
  writing: 3,
  done: 4,
};

export default function WorkflowPipeline({ phase }: WorkflowPipelineProps) {
  if (phase === "idle") return null;

  const currentIdx = PHASE_ORDER[phase];

  return (
    <div className="flex items-center justify-center gap-0 px-4 py-1.5 bg-gray-50 border-b border-gray-200">
      {PHASES.map((p, i) => {
        const idx = PHASE_ORDER[p.key];
        const isActive = idx === currentIdx;
        const isPast = idx < currentIdx;
        const isFuture = idx > currentIdx;

        return (
          <React.Fragment key={p.key}>
            {i > 0 && (
              <div
                className={`w-8 h-0.5 mx-0.5 transition-all duration-500 ${
                  isPast
                    ? "bg-[#e94560]"
                    : isActive
                    ? "bg-[#e94560]/40"
                    : "bg-gray-200"
                }`}
              />
            )}
            <div className="flex items-center gap-1.5 relative">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold transition-all duration-500 ${
                  isActive
                    ? "bg-[#e94560] text-white shadow-[0_0_8px_rgba(233,69,96,0.4)] scale-110"
                    : isPast
                    ? "bg-[#e94560]/80 text-white"
                    : "bg-gray-200 text-gray-400"
                }`}
              >
                {isPast ? "\u2713" : p.icon}
              </div>
              <span
                className={`text-[10px] font-medium transition-colors duration-300 ${
                  isActive
                    ? "text-[#e94560]"
                    : isPast
                    ? "text-gray-500"
                    : "text-gray-300"
                } ${isFuture ? "hidden sm:inline" : ""}`}
              >
                {p.label}
                {isActive && (
                  <span className="inline-flex ml-0.5">
                    <span className="typing-dot w-0.5 h-0.5 rounded-full bg-[#e94560] inline-block" />
                    <span className="typing-dot w-0.5 h-0.5 rounded-full bg-[#e94560] inline-block" />
                    <span className="typing-dot w-0.5 h-0.5 rounded-full bg-[#e94560] inline-block" />
                  </span>
                )}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
