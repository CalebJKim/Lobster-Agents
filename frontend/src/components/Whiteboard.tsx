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
    <div className="animate-fade-in bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {/* Attribution header */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-gray-100"
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
        <span className="text-[10px] text-gray-400">wrote the deliverable</span>
        <span className="text-[10px] text-gray-400 ml-auto">
          {formatTime(entry.timestamp)}
        </span>
        {isLatest && !isDone && (
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-[#e94560] inline-block" />
        )}
      </div>

      {/* Content — typewriter markdown */}
      <div
        className="px-4 py-3 prose prose-sm prose-gray max-w-none
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
        <div className="px-4 py-2 border-t border-gray-100 bg-green-50">
          <span className="text-[10px] text-green-700 font-medium">
            Deliverable complete
          </span>
        </div>
      )}
    </div>
  );
}

export default function Whiteboard({ entries }: WhiteboardProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  // Auto-scroll during typewriter animation
  useEffect(() => {
    if (!scrollRef.current || entries.length === 0) return;
    const iv = setInterval(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 100);
    return () => clearInterval(iv);
  }, [entries.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600 font-medium">
            War Room Whiteboard
          </span>
          <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
            {entries.length} {entries.length === 1 ? "deliverable" : "deliverables"}
          </span>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-xs">
            <div className="text-center">
              <p className="text-lg mb-2 opacity-30">Whiteboard is empty</p>
              <p>The final deliverable will appear here</p>
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
