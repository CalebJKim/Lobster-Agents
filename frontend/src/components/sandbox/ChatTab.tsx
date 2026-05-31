import { useMemo, useState } from "react";
import type { ChatMessage } from "../../types";
import { AGENT_COLORS } from "../../utils/sprites";
import { formatTime } from "./format";

export default function ChatTab({ messages }: { messages: ChatMessage[] }) {
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const agents = useMemo(
    () => Array.from(new Set(messages.map((message) => message.agent).filter(Boolean))).sort(),
    [messages],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return messages.filter((message) => {
      if (agentFilter !== "all" && message.agent !== agentFilter) return false;
      if (q && !`${message.agent} ${message.target} ${message.message}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [agentFilter, messages, query]);

  const copyTranscript = async () => {
    const text = filtered.map((message) => {
      const target = message.target && message.target !== "all" ? ` -> ${message.target}` : "";
      return `[${message.timestamp}] ${message.agent}${target}: ${message.message}`;
    }).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice("Transcript copied.");
    } catch {
      setCopyNotice("Could not copy automatically.");
    }
    window.setTimeout(() => setCopyNotice(null), 2200);
  };

  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-10 text-center text-[13px] font-medium text-white/55">
        No chatter in this sandbox yet. Reef chat between 2+ assigned lobsters
        will appear here; nothing from the reef commons leaks in.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chat..."
            className="h-8 min-w-40 flex-1 rounded-md border border-white/10 bg-slate-950/45 px-2.5 text-[12px] text-white outline-none placeholder:text-white/30 focus:border-cyan-200/40"
          />
          <select
            value={agentFilter}
            onChange={(event) => setAgentFilter(event.target.value)}
            className="h-8 rounded-md border border-white/10 bg-slate-950/70 px-2 text-[11px] font-semibold text-white/72 outline-none"
          >
            <option value="all">all agents</option>
            {agents.map((agent) => (
              <option key={agent} value={agent}>
                {agent}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={copyTranscript}
            disabled={filtered.length === 0}
            className="h-8 rounded-md bg-cyan-300/12 px-2.5 text-[10px] font-bold uppercase tracking-wide text-cyan-50 hover:bg-cyan-300/20 disabled:opacity-40"
          >
            Copy
          </button>
          <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/45">
            {filtered.length}/{messages.length}
          </span>
        </div>
        {copyNotice && (
          <div className="mt-1.5 text-[11px] font-medium text-cyan-100/75">
            {copyNotice}
          </div>
        )}
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-8 text-center text-[12px] text-white/45">
          No chat messages match the current filters.
        </div>
      ) : filtered.map((msg) => (
        <div
          key={msg.id}
          className="rounded-lg bg-white/[0.05] px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: AGENT_COLORS[msg.agent] ?? "#94a3b8" }}
            />
            <span className="text-[12px] font-semibold text-white/86">
              {msg.agent}
            </span>
            <span className="text-[11px] font-medium text-white/35">
              {formatTime(msg.timestamp)}
            </span>
            {msg.target && msg.target !== "all" && (
              <span className="text-[10px] font-medium uppercase text-white/35">
                → {msg.target}
              </span>
            )}
          </div>
          <div className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-white/82">
            {msg.message}
          </div>
        </div>
      ))}
    </div>
  );
}
