import React, { useEffect, useRef } from "react";
import type { ActivityEntry } from "../types";
import { CLAW_ORDER } from "../utils/claws";
import { AGENT_COLORS } from "../utils/sprites";

interface ActivityPanelProps {
  activity: ActivityEntry[];
  agentFilter: string | null;
  onFilterChange: (agent: string | null) => void;
}

const agentNames = CLAW_ORDER;

const ACTION_BADGES: Record<string, { label: string; icon: string; className: string }> = {
  research: { label: "search", icon: "", className: "bg-cyan-100 text-cyan-800" },
  think: { label: "think", icon: "", className: "bg-blue-100 text-blue-800" },
  code: { label: "claw", icon: "", className: "bg-emerald-100 text-emerald-800" },
  move_to: { label: "move", icon: "", className: "bg-orange-100 text-orange-800" },
  read_file: { label: "read", icon: "", className: "bg-violet-100 text-violet-800" },
  idle: { label: "idle", icon: "", className: "bg-slate-100 text-slate-500" },
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
    <div className={`animate-fade-in rounded-2xl border border-white/55 bg-white/58 px-3 py-2 shadow-sm backdrop-blur ${isResearch ? "bg-cyan-50/70" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
          {formatTime(entry.timestamp)}
        </span>
        <span className="shrink-0 text-sm font-semibold" style={{ color }}>
          {entry.agent}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-relaxed ${badge.className}`}
        >
          {badge.icon && <span className="mr-0.5">{badge.icon}</span>}
          {badge.label}
        </span>
      </div>
      <div
        className={`ml-0 mt-2 text-sm leading-relaxed text-slate-600 ${isThink ? "italic text-slate-500" : ""} ${isResearch ? "text-cyan-800" : ""}`}
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
  const pinnedToBottomRef = useRef(true);
  const showFilters = activity.length > 0 || !!agentFilter;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      pinnedToBottomRef.current = distanceFromBottom < 40;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Only snap to bottom when a new entry arrives AND the user is still pinned
  // there. If they scrolled up to read, stop fighting them.
  useEffect(() => {
    if (!scrollRef.current || !pinnedToBottomRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activity.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/24 bg-white/16 backdrop-blur">
      {/* Agent filter chips */}
      {showFilters && (
        <div className="scrollbar-hide flex flex-nowrap gap-1.5 overflow-x-auto border-b border-white/45 px-3 py-2">
          <button
            onClick={() => onFilterChange(null)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              !agentFilter
                ? "bg-slate-950 text-white"
                : "bg-white/55 text-slate-500 hover:text-slate-800"
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
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                agentFilter === name
                  ? "text-slate-900"
                  : "text-slate-500 hover:text-slate-800"
              }`}
              style={{
                backgroundColor:
                  agentFilter === name
                    ? AGENT_COLORS[name] + "35"
                    : "rgba(255,255,255,0.5)",
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
      )}

      {/* Activity entries */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {activity.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-sm text-slate-400">
            <div className="max-w-[230px] text-center">
              <p className="mb-1 text-sm font-semibold text-slate-600">No activity yet</p>
              <p className="text-xs leading-5">Research steps, thoughts, and movement will appear here.</p>
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
