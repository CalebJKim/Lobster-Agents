import React, { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { AGENT_COLORS } from "../utils/sprites";

interface Deliverable {
  id: number;
  query: string;
  agent: string;
  content: string;
  timestamp: string;
}

function formatDate(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function HistoryCard({ item }: { item: Deliverable }) {
  const [expanded, setExpanded] = useState(false);
  const color = AGENT_COLORS[item.agent] ?? "#999";

  return (
    <div className="mx-3 my-2 rounded-xl bg-white border border-gray-200/80 shadow-sm overflow-hidden animate-fade-in">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3.5 py-2.5 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-start gap-2.5">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0 mt-0.5"
            style={{ backgroundColor: color }}
          >
            {item.agent[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-800 leading-snug">
              {item.query}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {formatDate(item.timestamp)} &middot; {item.agent}
            </p>
          </div>
          <span className="text-gray-300 text-xs shrink-0 mt-0.5">
            {expanded ? "\u25B2" : "\u25BC"}
          </span>
        </div>
      </button>

      {/* Expandable content */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 prose prose-sm prose-gray max-w-none
          [&_h1]:text-sm [&_h1]:font-bold [&_h1]:mb-1.5 [&_h1]:text-gray-800
          [&_h2]:text-xs [&_h2]:font-bold [&_h2]:mb-1 [&_h2]:text-gray-700
          [&_h3]:text-xs [&_h3]:font-bold [&_h3]:mb-1 [&_h3]:text-gray-600
          [&_p]:text-xs [&_p]:text-gray-600 [&_p]:leading-relaxed [&_p]:mb-1.5
          [&_ul]:text-xs [&_ul]:text-gray-600 [&_ul]:pl-4 [&_ul]:mb-1.5 [&_ul]:list-disc
          [&_ol]:text-xs [&_ol]:text-gray-600 [&_ol]:pl-4 [&_ol]:mb-1.5 [&_ol]:list-decimal
          [&_li]:mb-0.5
          [&_strong]:text-gray-700 [&_strong]:font-semibold
          [&_code]:text-[10px] [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded
          [&_a]:text-blue-600 [&_a]:underline
        ">
          <Markdown>{item.content}</Markdown>
        </div>
      )}
    </div>
  );
}

export default function HistoryPanel() {
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/history", { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        setDeliverables((data.deliverables ?? []).reverse());
        setLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });
    return () => controller.abort();
  }, []);

  // Refresh when tab is focused
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      fetch("/history", { signal: controller.signal })
        .then((r) => r.json())
        .then((data) => {
          if (controller.signal.aborted) return;
          setDeliverables((data.deliverables ?? []).reverse());
        })
        .catch(() => {});
    };
    const iv = setInterval(refresh, 10000);
    return () => {
      controller.abort();
      clearInterval(iv);
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600 font-medium">Past Deliverables</span>
          <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
            {deliverables.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-xs">
            Loading...
          </div>
        ) : deliverables.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-xs">
            <div className="text-center">
              <p className="text-lg mb-2 opacity-30">No history yet</p>
              <p>Completed deliverables will appear here</p>
            </div>
          </div>
        ) : (
          deliverables.map((d) => <HistoryCard key={d.id} item={d} />)
        )}
      </div>
    </div>
  );
}
