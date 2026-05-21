import React from "react";
import { AGENT_COLORS } from "../utils/sprites";

const AGENTS_INFO = [
  { name: "Captain Claw", role: "Lead", desc: "Coordinates" },
  { name: "Clawdia", role: "Researcher", desc: "Web search" },
  { name: "Coraline", role: "Critic", desc: "Fact-check" },
  { name: "Shelldon", role: "Analyst", desc: "Analysis" },
  { name: "Pearl", role: "Writer", desc: "Deliverable" },
  { name: "Snips", role: "Coder", desc: "Code gen" },
  { name: "Reefus", role: "Planner", desc: "Strategy" },
];

interface WelcomeOverlayProps {
  visible: boolean;
}

export default function WelcomeOverlay({ visible }: WelcomeOverlayProps) {
  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-3">
      <div className="pointer-events-auto w-full max-w-lg rounded-3xl border border-white/45 bg-white/68 px-4 py-5 text-center shadow-[0_24px_90px_rgba(9,35,45,0.24)] backdrop-blur-2xl sm:px-10 sm:py-8">
        {/* Title */}
        <div className="mb-1">
          <h2 className="text-2xl font-semibold text-slate-900">
            Underwater <span className="text-[#e94560]">Agent Studio</span>
          </h2>
        </div>
        <p className="mb-6 text-sm text-slate-500">
          Seven local agents, one private workspace.
        </p>

        {/* Agent grid */}
        <div className="flex flex-wrap justify-center gap-3 mb-6">
          {AGENTS_INFO.map((a) => (
            <div key={a.name} className="flex flex-col items-center gap-1.5 w-14">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md"
                style={{
                  backgroundColor: AGENT_COLORS[a.name],
                  boxShadow: `0 2px 8px ${AGENT_COLORS[a.name]}40`,
                }}
              >
                {a.name[0]}
              </div>
              <span className="text-[11px] font-bold text-slate-700">{a.name}</span>
              <span className="text-[9px] font-medium uppercase text-slate-400">{a.desc}</span>
            </div>
          ))}
        </div>

        {/* Capabilities */}
        <div className="mb-3 flex flex-wrap items-center justify-center gap-3 border-t border-white/55 pt-4 text-[11px] text-slate-500 sm:gap-5">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Private & local
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400" /> Web search
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" /> File analysis
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> Code generation
          </span>
        </div>
        <p className="text-xs text-slate-400">
          Ask a question or drop a file to start.
        </p>
      </div>
    </div>
  );
}
