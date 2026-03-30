import React, { useEffect, useRef } from "react";
import type { AgentInfo, ChatMessage, ActivityEntry } from "../types";
import { AGENT_COLORS, ROLE_LABELS } from "../utils/sprites";
import { generateAgentPortrait } from "../utils/SpriteGenerator";

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

/**
 * Pixel art portrait of an agent, scaled up 4x from 16x24 to 64x96.
 * Uses nearest-neighbor rendering for crispy pixels.
 */
function AgentPortrait({ agentName }: { agentName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const portraitUrl = generateAgentPortrait(agentName);
    if (!portraitUrl) return;

    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Draw the 16x24 portrait scaled up to 64x96
      ctx.drawImage(img, 0, 0, 16, 24, 0, 0, 64, 96);
    };
    img.src = portraitUrl;
  }, [agentName]);

  return (
    <canvas
      ref={canvasRef}
      width={64}
      height={96}
      className="block"
      style={{
        imageRendering: "pixelated",
        width: 64,
        height: 96,
      }}
    />
  );
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

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header with pixel art portrait */}
      <div
        className="px-4 py-3 border-b border-gray-200"
        style={{ backgroundColor: color + "14" }}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-start gap-3">
            {/* Pixel art portrait */}
            <div
              className="border border-gray-200 bg-gray-100 p-1 flex-shrink-0"
              style={{ imageRendering: "pixelated" }}
            >
              <AgentPortrait agentName={agent.name} />
            </div>
            <div className="flex flex-col gap-1 pt-1">
              <span className="text-sm font-bold" style={{ color }}>
                {agent.name}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                  {ROLE_LABELS[agent.role]}
                </span>
                <StateBadge state={agent.state} />
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none transition-colors"
          >
            x
          </button>
        </div>
      </div>

      {/* Current task */}
      {agent.current_task && (
        <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
            Current Task
          </p>
          <p className="text-xs text-gray-700">{agent.current_task}</p>
        </div>
      )}

      {/* Location */}
      <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
          Location
        </p>
        <p className="text-xs text-gray-700">
          {agent.location.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
        </p>
      </div>

      {/* Thoughts */}
      <div className="flex-1 overflow-y-auto">
        {thoughts.length > 0 && (
          <div className="px-4 py-2 border-b border-gray-200">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
              Recent Thoughts
            </p>
            <div className="space-y-1.5">
              {thoughts.slice(-5).map((t) => (
                <div key={t.id} className="text-xs text-gray-500 italic">
                  <span className="text-gray-400 text-[10px] mr-1">
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
          <div className="px-4 py-2">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
              Recent Activity
            </p>
            <div className="space-y-1.5">
              {recentMessages.slice(-8).map((m) => (
                <div key={m.id} className="text-xs text-gray-600">
                  <span className="text-gray-400 text-[10px] mr-1">
                    {formatTime(m.timestamp)}
                  </span>
                  {m.type === "think" ? (
                    <span className="italic text-gray-500">
                      {m.message}
                    </span>
                  ) : (
                    <>
                      {m.target !== "all" && m.target !== "self" && (
                        <span className="text-gray-500">
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
          <div className="flex items-center justify-center h-32 text-gray-400 text-xs">
            No recent activity
          </div>
        )}
      </div>
    </div>
  );
}
