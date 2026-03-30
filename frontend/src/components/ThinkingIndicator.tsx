import React from "react";
import { AGENT_COLORS } from "../utils/sprites";

interface ThinkingIndicatorProps {
  agents: string[];
}

export default function ThinkingIndicator({ agents }: ThinkingIndicatorProps) {
  if (agents.length === 0) return null;

  return (
    <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/50 animate-fade-in">
      <div className="flex items-center gap-2">
        <span className="inline-flex gap-0.5">
          <span className="typing-dot w-1 h-1 rounded-full bg-[#e94560] inline-block" />
          <span className="typing-dot w-1 h-1 rounded-full bg-[#e94560] inline-block" />
          <span className="typing-dot w-1 h-1 rounded-full bg-[#e94560] inline-block" />
        </span>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
          {agents.map((name) => (
            <span key={name} className="flex items-center gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: AGENT_COLORS[name] ?? "#999" }}
              />
              <span className="font-medium" style={{ color: AGENT_COLORS[name] ?? "#999" }}>
                {name}
              </span>
            </span>
          ))}
          <span className="text-gray-400">thinking...</span>
        </div>
      </div>
    </div>
  );
}
