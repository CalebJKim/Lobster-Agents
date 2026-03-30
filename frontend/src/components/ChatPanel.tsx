import React, { useEffect, useRef } from "react";
import type { ChatMessage } from "../types";
import { AGENT_COLORS, AGENT_ROLES, ROLE_LABELS } from "../utils/sprites";
import ThinkingIndicator from "./ThinkingIndicator";

interface ChatPanelProps {
  messages: ChatMessage[];
  agentFilter: string | null;
  onFilterChange: (agent: string | null) => void;
  thinkingAgents?: string[];
}

const agentNames = ["Maya", "Raj", "Sophie", "Alex", "Jordan", "Dev", "Sam"];

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Detect if message content is a search result dump */
function isSearchMessage(msg: ChatMessage): boolean {
  return msg.message.startsWith("Searching: ") || msg.message.startsWith("Searched: ");
}

/** Extract a short search summary from verbose search result text */
function formatSearchContent(text: string): { query: string; results: string[] } {
  // "Searching: "query here""
  const searchingMatch = text.match(/^Searching: "(.+)"$/);
  if (searchingMatch) {
    return { query: searchingMatch[1], results: [] };
  }

  // "Searched: 'query' — N results:\n  - Title: body\n  - Title: body"
  const searchedMatch = text.match(/^Searched: '([^']+)' — (\d+) results:([\s\S]*)$/);
  if (searchedMatch) {
    const query = searchedMatch[1];
    const body = searchedMatch[3] || "";
    const results = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2))
      .slice(0, 4); // max 4 results shown
    return { query, results };
  }

  return { query: text.slice(0, 80), results: [] };
}

function SearchBubble({ msg }: { msg: ChatMessage }) {
  const color = AGENT_COLORS[msg.agent] ?? "#999";
  const { query, results } = formatSearchContent(msg.message);

  return (
    <div className="px-3 py-2 animate-fade-in">
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
          style={{ backgroundColor: color }}
        >
          {msg.agent[0]}
        </div>
        <span className="text-xs font-semibold" style={{ color }}>
          {msg.agent}
        </span>
        <span className="text-[10px] text-gray-400">searched</span>
        <span className="text-gray-300 text-[10px] ml-auto shrink-0">
          {formatTime(msg.timestamp)}
        </span>
      </div>
      <div className="ml-7 rounded-lg bg-teal-50 border border-teal-200/60 overflow-hidden">
        <div className="px-3 py-1.5 bg-teal-100/50 border-b border-teal-200/40 flex items-center gap-1.5">
          <span className="text-teal-600 text-[10px]">?</span>
          <span className="text-xs text-teal-800 font-medium truncate">{query}</span>
        </div>
        {results.length > 0 && (
          <div className="px-3 py-1.5 space-y-0.5">
            {results.map((r, i) => (
              <p key={i} className="text-[11px] text-teal-700 leading-snug truncate">
                {r}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UserBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div className="px-3 py-2 animate-fade-in flex justify-end">
      <div className="max-w-[85%]">
        <div className="flex items-center justify-end gap-2 mb-1">
          <span className="text-gray-300 text-[10px]">{formatTime(msg.timestamp)}</span>
          <span className="text-xs font-semibold text-gray-500">You</span>
        </div>
        <div className="rounded-xl rounded-tr-sm bg-[#e94560] text-white px-3.5 py-2">
          <p className="text-xs leading-relaxed">{msg.message}</p>
        </div>
      </div>
    </div>
  );
}

function AgentBubble({ msg }: { msg: ChatMessage }) {
  const color = AGENT_COLORS[msg.agent] ?? "#999";
  const isAskUser = msg.type === "ask_user";
  const role = AGENT_ROLES[msg.agent];
  const roleLabel = role ? ROLE_LABELS[role] : "";

  return (
    <div className="px-3 py-2 animate-fade-in">
      <div className="flex items-center gap-2 mb-1">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
          style={{ backgroundColor: color }}
        >
          {msg.agent[0]}
        </div>
        <span className="text-xs font-semibold" style={{ color }}>
          {msg.agent}
        </span>
        {roleLabel && (
          <span className="text-[9px] text-gray-400 font-medium">{roleLabel}</span>
        )}
        {msg.target !== "all" &&
          msg.target !== "self" &&
          msg.target !== "user" && (
            <>
              <span className="text-gray-300 text-[10px]">&rarr;</span>
              <span
                className="text-[10px] font-medium"
                style={{ color: AGENT_COLORS[msg.target] ?? "#888" }}
              >
                {msg.target}
              </span>
            </>
          )}
        {isAskUser && (
          <span className="text-[10px] text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded font-medium">
            needs your input
          </span>
        )}
        <span className="text-gray-300 text-[10px] ml-auto shrink-0">
          {formatTime(msg.timestamp)}
        </span>
      </div>
      <div
        className={`ml-7 rounded-xl rounded-tl-sm px-3.5 py-2 max-w-[92%] ${
          isAskUser
            ? "bg-amber-50 border border-amber-200"
            : "bg-gray-100 border border-gray-200/60"
        }`}
      >
        <p
          className={`text-xs leading-relaxed break-words whitespace-pre-wrap ${
            isAskUser ? "text-amber-900" : "text-gray-700"
          }`}
        >
          {msg.message}
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.agent === "You" || msg.agent === "User";

  if (isUser) return <UserBubble msg={msg} />;
  if (isSearchMessage(msg)) return <SearchBubble msg={msg} />;
  return <AgentBubble msg={msg} />;
}

export default function ChatPanel({
  messages,
  agentFilter,
  onFilterChange,
  thinkingAgents = [],
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, thinkingAgents.length]);

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

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-1">
        {messages.length === 0 && thinkingAgents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-xs">
            <div className="text-center">
              <p className="text-lg mb-2 opacity-30">No messages yet</p>
              <p>Submit a query to get started</p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            <ThinkingIndicator agents={thinkingAgents} />
          </>
        )}
      </div>
    </div>
  );
}
