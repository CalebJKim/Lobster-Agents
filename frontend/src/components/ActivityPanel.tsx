import React, { useEffect, useRef } from "react";
import type { ActivityEntry } from "../types";
import { AGENT_COLORS } from "../utils/sprites";

interface ActivityPanelProps {
  activity: ActivityEntry[];
  agentFilter: string | null;
  onFilterChange: (agent: string | null) => void;
}

const agentNames = ["Maya", "Raj", "Sophie", "Alex", "Jordan", "Dev", "Sam"];

const ACTION_BADGES: Record<string, { label: string; icon: string; className: string }> = {
  research: { label: "search", icon: "?", className: "bg-teal-100 text-teal-700" },
  think: { label: "think", icon: "...", className: "bg-blue-100 text-blue-700" },
  code: { label: "code", icon: "<>", className: "bg-emerald-100 text-emerald-700" },
  move_to: { label: "move", icon: ">", className: "bg-orange-100 text-orange-700" },
  read_file: { label: "read", icon: "#", className: "bg-purple-100 text-purple-700" },
  idle: { label: "idle", icon: "-", className: "bg-gray-100 text-gray-500" },
};

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function formatContent(action: string, content: string): string {
  if (action === "move_to") {
    // content might be the room name, or target field has it
    const raw = content || "";
    if (!raw || raw === "null" || raw === "None") return "";
    const room = raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return `\u2192 ${room}`;
  }
  if (action === "research") {
    if (content.length > 120) return content.slice(0, 117) + "...";
    return content;
  }
  if (action === "idle") {
    return content || "Standing by";
  }
  if (content.length > 150) return content.slice(0, 147) + "...";
  return content;
}

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const color = AGENT_COLORS[entry.agent] ?? "#999";
  const badge = ACTION_BADGES[entry.action] ?? {
    label: entry.action,
    icon: "*",
    className: "bg-gray-100 text-gray-500",
  };
  const isThink = entry.action === "think";
  const isResearch = entry.action === "research";

  return (
    <div className={`px-3 py-1.5 border-b border-gray-100 animate-fade-in ${isResearch ? "bg-teal-50/50" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="text-gray-400 text-[10px] tabular-nums shrink-0">
          {formatTime(entry.timestamp)}
        </span>
        <span className="text-xs font-bold shrink-0" style={{ color }}>
          {entry.agent}
        </span>
        <span
          className={`px-1.5 py-0 rounded text-[9px] font-medium leading-relaxed shrink-0 ${badge.className}`}
        >
          <span className="mr-0.5">{badge.icon}</span>
          {badge.label}
        </span>
      </div>
      <div
        className={`ml-16 mt-0.5 text-xs text-gray-600 ${isThink ? "italic text-gray-500" : ""} ${isResearch ? "text-teal-700" : ""}`}
      >
        {formatContent(entry.action, entry.content)}
      </div>
    </div>
  );
}

export default function ActivityPanel({
  activity,
  agentFilter,
  onFilterChange,
}: ActivityPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activity.length]);

  return (
    <div className="flex flex-col h-full">
      {/* Agent filter chips */}
      <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-gray-200 bg-gray-50">
        <button
          onClick={() => onFilterChange(null)}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
            !agentFilter
              ? "bg-gray-200 text-gray-800"
              : "bg-gray-100 text-gray-500 hover:text-gray-700"
          }`}
        >
          All
        </button>
        {agentNames.map((name) => (
          <button
            key={name}
            onClick={() =>
              onFilterChange(agentFilter === name ? null : name)
            }
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              agentFilter === name
                ? "text-gray-800"
                : "text-gray-500 hover:text-gray-700"
            }`}
            style={{
              backgroundColor:
                agentFilter === name
                  ? AGENT_COLORS[name] + "33"
                  : "#f3f4f6",
              borderColor:
                agentFilter === name ? AGENT_COLORS[name] : "transparent",
              borderWidth: 1,
              borderStyle: "solid",
            }}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Activity entries */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {activity.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-xs">
            <div className="text-center">
              <p className="text-lg mb-2 opacity-30">No activity yet</p>
              <p>Agent research, thoughts, and movements appear here</p>
            </div>
          </div>
        ) : (
          activity.map((entry) => (
            <ActivityItem key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}
