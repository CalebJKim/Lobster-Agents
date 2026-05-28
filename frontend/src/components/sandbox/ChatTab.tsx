import type { ChatMessage } from "../../types";
import { AGENT_COLORS } from "../../utils/sprites";
import { formatTime } from "./format";

export default function ChatTab({ messages }: { messages: ChatMessage[] }) {
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
      {messages.map((msg) => (
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
