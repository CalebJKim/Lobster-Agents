import React, { useEffect, useMemo, useRef } from "react";
import type { ChatMessage } from "../types";
import { AGENT_COLORS, AGENT_ROLES, ROLE_LABELS } from "../utils/sprites";
import ThinkingIndicator from "./ThinkingIndicator";

interface ChatPanelProps {
  messages: ChatMessage[];
  agentFilter: string | null;
  onFilterChange: (agent: string | null) => void;
  thinkingAgents?: string[];
}

function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function isSearchMessage(msg: ChatMessage): boolean {
  return msg.message.startsWith("Searching: ") || msg.message.startsWith("Searched: ");
}

function formatSearchContent(text: string): string {
  const searchingMatch = text.match(/^Searching: "(.+)"$/);
  if (searchingMatch) return searchingMatch[1];

  const searchedMatch = text.match(/^Searched: '([^']+)' — (\d+) results:/);
  if (searchedMatch) {
    return `${searchedMatch[1]} (${searchedMatch[2]} results)`;
  }

  return text;
}

function messageKind(msg: ChatMessage): string {
  if (msg.agent === "You" || msg.agent === "User") return "request";
  if (msg.type === "ask_user") return "question";
  if (isSearchMessage(msg)) return "search";
  if (msg.type === "announce") return "notice";
  return "message";
}

function MessageLine({ msg }: { msg: ChatMessage }) {
  const color = msg.agent === "You" ? "#e2e8f0" : AGENT_COLORS[msg.agent] ?? "#7dd3fc";
  const role = AGENT_ROLES[msg.agent];
  const roleLabel = role ? ROLE_LABELS[role] : messageKind(msg);
  const hasTarget =
    msg.target !== "all" && msg.target !== "self" && msg.target !== "user";
  const kind = messageKind(msg);
  const content = isSearchMessage(msg) ? formatSearchContent(msg.message) : msg.message;

  return (
    <article className="group grid grid-cols-[3.4rem_minmax(6rem,8rem)_1fr] gap-3 border-b border-white/[0.07] px-3 py-3 transition-colors last:border-b-0 hover:bg-white/[0.045] max-md:grid-cols-[2.7rem_1fr] max-md:gap-x-2">
      <time className="pt-0.5 text-[10px] font-medium leading-4 tabular-nums text-white/35">
        {formatTime(msg.timestamp)}
      </time>

      <div className="min-w-0 max-md:col-start-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="truncate text-[12px] font-semibold leading-4" style={{ color }}>
            {msg.agent}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9px] font-bold uppercase leading-4 tracking-normal text-white/32">
          <span className="truncate">{roleLabel}</span>
          <span className="text-white/18">/</span>
          <span className="truncate">{kind}</span>
        </div>
      </div>

      <div className="min-w-0 max-md:col-span-2 max-md:pl-[3.4rem]">
        {hasTarget && (
          <span className="mb-1 inline-flex rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-white/40">
            to {msg.target}
          </span>
        )}
        <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-white/78">
          {content}
        </p>
      </div>
    </article>
  );
}

export default function ChatPanel({
  messages,
  agentFilter,
  onFilterChange,
  thinkingAgents = [],
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const visibleAgents = useMemo(
    () => Array.from(new Set(messages.map((m) => m.agent))).filter((name) => name !== "You"),
    [messages]
  );

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

  useEffect(() => {
    if (!scrollRef.current || !pinnedToBottomRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, thinkingAgents.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-white/10 bg-slate-950/38 backdrop-blur">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.08] px-3 py-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase leading-4 tracking-normal text-white/36">
            Comms Stream
          </div>
          <div className="mt-0.5 text-[12px] font-medium leading-4 text-white/72">
            {messages.length ? `${messages.length} entries` : "Standing by"}
          </div>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          {agentFilter && (
            <button
              onClick={() => onFilterChange(null)}
              className="rounded bg-white/[0.08] px-2 py-1 text-[11px] font-semibold leading-4 text-white/62 transition hover:bg-white/[0.14] hover:text-white"
            >
              Clear
            </button>
          )}
          {visibleAgents.slice(0, 5).map((name) => (
            <button
              key={name}
              onClick={() => onFilterChange(agentFilter === name ? null : name)}
              className={`h-2.5 w-2.5 rounded-full ring-2 transition ${
                agentFilter === name ? "ring-white/75" : "ring-transparent hover:ring-white/35"
              }`}
              style={{ backgroundColor: AGENT_COLORS[name] ?? "#94a3b8" }}
              title={name}
            />
          ))}
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && thinkingAgents.length === 0 ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <div>
              <div className="text-[11px] font-bold uppercase leading-4 tracking-normal text-white/28">
                No signal yet
              </div>
              <p className="mt-2 max-w-[260px] text-sm leading-6 text-white/54">
                Ask the reef a question and agent coordination will stream here.
              </p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageLine key={msg.id} msg={msg} />
            ))}
            <ThinkingIndicator agents={thinkingAgents} />
          </>
        )}
      </div>
    </div>
  );
}
