import React, { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { WhiteboardEntry } from "../types";
import { AGENT_COLORS } from "../utils/sprites";

interface WhiteboardProps {
  entries: WhiteboardEntry[];
}

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

/**
 * Typewriter hook — reveals content character by character.
 * Only animates the latest entry; older entries show instantly.
 */
function useTypewriter(text: string, isLatest: boolean, speed = 12): string {
  const [displayed, setDisplayed] = useState(isLatest ? "" : text);
  const indexRef = useRef(0);

  useEffect(() => {
    if (!isLatest) {
      setDisplayed(text);
      return;
    }

    // Reset for new text
    indexRef.current = 0;
    setDisplayed("");

    const iv = setInterval(() => {
      indexRef.current += speed;
      if (indexRef.current >= text.length) {
        setDisplayed(text);
        clearInterval(iv);
      } else {
        setDisplayed(text.slice(0, indexRef.current));
      }
    }, 30);

    return () => clearInterval(iv);
  }, [text, isLatest, speed]);

  return displayed;
}

function WhiteboardCard({
  entry,
  isLatest,
}: {
  entry: WhiteboardEntry;
  isLatest: boolean;
}) {
  const color = AGENT_COLORS[entry.agent] ?? "#999";
  const displayedContent = useTypewriter(entry.content, isLatest);
  const isDone = displayedContent.length === entry.content.length;

  return (
    <div className="animate-fade-in overflow-hidden rounded-2xl border border-white/55 bg-white/65 shadow-sm backdrop-blur">
      {/* Attribution header */}
      <div
        className="flex items-center gap-2 border-b border-white/50 px-3 py-2"
        style={{ backgroundColor: color + "08" }}
      >
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
          style={{ backgroundColor: color }}
        >
          {entry.agent[0]}
        </div>
        <span className="text-xs font-bold" style={{ color }}>
          {entry.agent}
        </span>
        <span className="text-[11px] text-slate-400">wrote the deliverable</span>
        <span className="ml-auto text-[11px] text-slate-400">
          {formatTime(entry.timestamp)}
        </span>
        {isLatest && !isDone && (
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-[#e94560] inline-block" />
        )}
      </div>

      {/* Content — typewriter markdown */}
      <div
        className="prose prose-sm max-w-none px-4 py-3
          [&_h1]:text-base [&_h1]:font-bold [&_h1]:mb-2 [&_h1]:text-gray-800
          [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mb-1.5 [&_h2]:text-gray-700
          [&_h3]:text-xs [&_h3]:font-bold [&_h3]:mb-1 [&_h3]:text-gray-700
          [&_p]:text-xs [&_p]:text-gray-700 [&_p]:leading-relaxed [&_p]:mb-2
          [&_ul]:text-xs [&_ul]:text-gray-700 [&_ul]:pl-4 [&_ul]:mb-2 [&_ul]:list-disc
          [&_ol]:text-xs [&_ol]:text-gray-700 [&_ol]:pl-4 [&_ol]:mb-2 [&_ol]:list-decimal
          [&_li]:mb-1 [&_li]:leading-relaxed
          [&_strong]:text-gray-800 [&_strong]:font-semibold
          [&_em]:italic
          [&_code]:text-[11px] [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
          [&_a]:text-blue-600 [&_a]:underline
          [&_blockquote]:border-l-2 [&_blockquote]:border-gray-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-gray-500
        "
      >
        <Markdown>{displayedContent}</Markdown>
      </div>

      {/* Completion indicator */}
      {isDone && isLatest && (
        <div className="border-t border-white/50 bg-emerald-50/70 px-4 py-2">
          <span className="text-[11px] font-medium text-emerald-700">
            Deliverable complete
          </span>
        </div>
      )}
    </div>
  );
}

export default function Whiteboard({ entries }: WhiteboardProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Track whether the user is "pinned to the bottom". If they scroll up to
  // read something, we stop fighting them — the timer below + new-entry
  // effect both bail out until they scroll back near the bottom.
  const pinnedToBottomRef = useRef(true);

  // Listen for user scroll and update the pin state. Within 40px of the
  // bottom counts as "still pinned" so a touch of bounce/inertia doesn't
  // unstick the autoscroll.
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

  // Snap to bottom only when a brand-new entry arrives AND the user was
  // already at the bottom. If they scrolled up to read, leave them alone.
  useEffect(() => {
    if (!scrollRef.current || !pinnedToBottomRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries.length]);

  // During the typewriter animation, keep the latest line visible — but
  // only while the user is pinned. Scrolling up cancels the chase.
  useEffect(() => {
    if (!scrollRef.current || entries.length === 0) return;
    const iv = setInterval(() => {
      const el = scrollRef.current;
      if (!el || !pinnedToBottomRef.current) return;
      el.scrollTop = el.scrollHeight;
    }, 100);
    return () => clearInterval(iv);
  }, [entries.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/24 bg-white/16 backdrop-blur">
      <div className="border-b border-white/45 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">
            Answer Board
          </span>
          <span className="rounded-full bg-white/60 px-2 py-0.5 text-[11px] text-slate-500">
            {entries.length} {entries.length === 1 ? "deliverable" : "deliverables"}
          </span>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-sm text-slate-400">
            <div className="max-w-[220px] text-center">
              <p className="mb-1 text-sm font-semibold text-slate-600">Nothing written yet</p>
              <p className="text-xs leading-5">The final answer will appear here when the team is done.</p>
            </div>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            {entries.map((entry, i) => (
              <WhiteboardCard
                key={i}
                entry={entry}
                isLatest={i === entries.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
