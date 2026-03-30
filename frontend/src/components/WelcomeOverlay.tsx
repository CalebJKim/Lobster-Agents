import React from "react";
import { AGENT_COLORS } from "../utils/sprites";

const AGENTS_INFO = [
  { name: "Sam", role: "Lead", desc: "Coordinates" },
  { name: "Maya", role: "Researcher", desc: "Web search" },
  { name: "Sophie", role: "Critic", desc: "Fact-check" },
  { name: "Raj", role: "Analyst", desc: "Analysis" },
  { name: "Jordan", role: "Writer", desc: "Deliverable" },
  { name: "Dev", role: "Coder", desc: "Code gen" },
  { name: "Alex", role: "Planner", desc: "Strategy" },
];

interface WelcomeOverlayProps {
  visible: boolean;
}

export default function WelcomeOverlay({ visible }: WelcomeOverlayProps) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl px-10 py-8 max-w-lg text-center pointer-events-auto border border-gray-200/50">
        {/* Title */}
        <div className="mb-1">
          <h2 className="text-xl font-bold text-gray-800 tracking-tight">
            Your Personal <span className="text-[#e94560]">AI Office</span>
          </h2>
        </div>
        <p className="text-xs text-gray-400 mb-6">
          7 agents. 1 box. 100% private. Nothing leaves this machine.
        </p>

        {/* Agent grid */}
        <div className="flex justify-center gap-3 mb-6">
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
              <span className="text-[10px] font-bold text-gray-700">{a.name}</span>
              <span className="text-[8px] text-gray-400 uppercase tracking-wider font-medium">{a.desc}</span>
            </div>
          ))}
        </div>

        {/* Capabilities */}
        <div className="flex items-center justify-center gap-5 text-[10px] text-gray-500 border-t border-gray-100 pt-4 mb-3">
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
        <p className="text-[10px] text-gray-400">
          Ask a question or drop a file to get started
        </p>
      </div>
    </div>
  );
}
