import React from "react";
import { AGENT_COLORS } from "../utils/sprites";

interface ThinkingIndicatorProps {
  agents: string[];
}

export default function ThinkingIndicator({ agents }: ThinkingIndicatorProps) {
  if (agents.length === 0) return null;

  return (
    <div className="animate-fade-in px-3 py-2.5">
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 py-2 text-xs text-white/54 backdrop-blur">
        <span className="inline-flex gap-0.5" aria-hidden="true">
          <span className="typing-dot inline-block h-1 w-1 rounded-full bg-white/50" />
          <span className="typing-dot inline-block h-1 w-1 rounded-full bg-white/50" />
          <span className="typing-dot inline-block h-1 w-1 rounded-full bg-white/50" />
        </span>
        <span className="min-w-0 truncate">
          {agents.map((name, index) => (
            <React.Fragment key={name}>
              {index > 0 && <span className="text-white/25">, </span>}
              <span className="font-semibold" style={{ color: AGENT_COLORS[name] ?? "#64748b" }}>
                {name}
              </span>
            </React.Fragment>
          ))}{" "}
          thinking
        </span>
      </div>
    </div>
  );
}
