import React, { useState, useCallback, useRef } from "react";
import { unlockAudio, playQuerySubmit } from "../utils/sounds";

interface QueryInputProps {
  onSubmit: (query: string) => void;
  currentQuery: string | null;
  connected: boolean;
}

async function uploadFile(file: File): Promise<{ path: string; name: string } | null> {
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/upload", { method: "POST", body: form });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const DEMO_PROMPTS = [
  {
    icon: "💰",
    label: "My Finances",
    prompt: "Read my expenses file at /home/nvidia/documents/demo-files/expenses-q1-2025.csv and analyze my Q1 spending. Where am I wasting money? What subscriptions can I cut? How much am I spending on food delivery vs groceries?",
  },
  {
    icon: "🤝",
    label: "Job Offers",
    prompt: "I have two job offers I need to compare. Read /home/nvidia/documents/demo-files/offer-aurora-tech.md and /home/nvidia/documents/demo-files/offer-meridian-ai.md — compare total comp, equity risk, career growth, and tell me which one to take.",
  },
  {
    icon: "📋",
    label: "Perf Review",
    prompt: "Read my performance review notes at /home/nvidia/documents/demo-files/perf-review-notes.md and help me prepare for my review. Am I ready for Staff promotion? Write a strong self-assessment summary and talking points for my manager.",
  },
  {
    icon: "🗺️",
    label: "Trip Plan",
    prompt: "I have 5 days in Tokyo next month. Build me a day-by-day itinerary covering must-see spots, hidden gems, and the best food neighborhoods.",
  },
  {
    icon: "💻",
    label: "Build App",
    prompt: "Write a Python CLI tool that monitors my Downloads folder and auto-organizes files into subfolders by type (images, documents, videos, archives).",
  },
  {
    icon: "🔍",
    label: "Research",
    prompt: "What are the top 3 local LLMs for running on consumer GPUs in 2025? Compare performance, memory usage, and best use cases.",
  },
];

export default function QueryInput({
  onSubmit,
  currentQuery,
  connected,
}: QueryInputProps) {
  const [input, setInput] = useState("");
  const [droppedFiles, setDroppedFiles] = useState<{ name: string; path: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      setUploading(true);
      const uploaded: { name: string; path: string }[] = [];
      for (const file of files.slice(0, 3)) {
        const result = await uploadFile(file);
        if (result) uploaded.push({ name: result.name, path: result.path });
      }
      setUploading(false);

      if (uploaded.length > 0) {
        setDroppedFiles((prev) => [...prev, ...uploaded]);
        const paths = uploaded.map((f) => f.path).join(" and ");
        setInput((prev) =>
          prev
            ? `${prev} (also read ${paths})`
            : `Read ${paths} and analyze the contents. Give me key insights and recommendations.`
        );
      }
    },
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const removeFile = useCallback((idx: number) => {
    setDroppedFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      unlockAudio();
      const trimmed = input.trim();
      if (!trimmed) return;
      playQuerySubmit();
      onSubmit(trimmed);
      setInput("");
      setDroppedFiles([]);
    },
    [input, onSubmit]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const trimmed = input.trim();
        if (!trimmed) return;
        onSubmit(trimmed);
        setInput("");
        setDroppedFiles([]);
      }
    },
    [input, onSubmit]
  );

  const handlePromptClick = useCallback(
    (prompt: string) => {
      unlockAudio();
      playQuerySubmit();
      onSubmit(prompt);
    },
    [onSubmit]
  );

  const showSuggestions = !currentQuery && connected;

  return (
    <div
      ref={dropRef}
      className={`border-t border-gray-200 bg-white transition-colors ${
        isDragging ? "bg-[#e94560]/5 border-t-[#e94560]" : ""
      }`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Drop overlay */}
      {isDragging && (
        <div className="px-4 py-3 text-center">
          <p className="text-sm text-[#e94560] font-medium">Drop files here — your agents will read them</p>
          <p className="text-[10px] text-gray-400">CSV, TXT, MD, JSON, and more</p>
        </div>
      )}

      {/* Uploaded file chips */}
      {droppedFiles.length > 0 && !isDragging && (
        <div className="px-4 pt-2 flex flex-wrap gap-1.5">
          {droppedFiles.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#e94560]/10 text-[#e94560] text-[11px] rounded-full border border-[#e94560]/20"
            >
              <span className="text-[9px]">#</span>
              {f.name}
              <button
                onClick={() => removeFile(i)}
                className="text-[#e94560]/50 hover:text-[#e94560] ml-0.5"
              >
                x
              </button>
            </span>
          ))}
          {uploading && (
            <span className="text-[10px] text-gray-400 animate-pulse">Uploading...</span>
          )}
        </div>
      )}

      {/* Status line */}
      <div className="px-4 py-1 flex items-center gap-2 text-[10px]">
        {currentQuery ? (
          <>
            <span className="inline-flex gap-0.5">
              <span className="typing-dot w-1 h-1 rounded-full bg-yellow-400 inline-block" />
              <span className="typing-dot w-1 h-1 rounded-full bg-yellow-400 inline-block" />
              <span className="typing-dot w-1 h-1 rounded-full bg-yellow-400 inline-block" />
            </span>
            <span className="text-amber-600">
              Working on:{" "}
              <span className="text-amber-700">
                {currentQuery.length > 80
                  ? currentQuery.slice(0, 77) + "..."
                  : currentQuery}
              </span>
            </span>
          </>
        ) : (
          <span className="text-gray-400">
            Your team is idle — ask them something, or try a suggestion below
          </span>
        )}
      </div>

      {/* Demo prompt suggestions */}
      {showSuggestions && (
        <div className="px-4 py-2.5 flex gap-2.5 overflow-x-auto scrollbar-hide">
          {DEMO_PROMPTS.map((p, i) => (
            <button
              key={i}
              onClick={() => handlePromptClick(p.prompt)}
              className="group flex-shrink-0 flex items-start gap-2.5 px-3.5 py-2.5 bg-white hover:bg-[#e94560]/5 border border-gray-200/80 hover:border-[#e94560]/40 rounded-xl shadow-sm hover:shadow-md transition-all text-left max-w-[210px]"
              title={p.prompt}
            >
              <span className="text-base mt-0.5 shrink-0 group-hover:scale-110 transition-transform">{p.icon}</span>
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-gray-500 group-hover:text-[#e94560] uppercase tracking-wider">
                  {p.label}
                </div>
                <div className="text-[11px] text-gray-500 leading-tight mt-0.5 line-clamp-2">
                  {p.prompt.length > 55
                    ? p.prompt.slice(0, 53) + "..."
                    : p.prompt}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={handleSubmit} className="px-4 pb-3 pt-1 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={currentQuery ? "Reply to the team..." : "Ask your team anything — or drop a file..."}
          disabled={!connected}
          className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#e94560]/50 focus:ring-2 focus:ring-[#e94560]/10 shadow-sm transition-all disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={!connected || !input.trim()}
          className="px-5 py-2.5 bg-[#e94560] hover:bg-[#d63851] disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-semibold rounded-xl shadow-sm hover:shadow transition-all focus:outline-none focus:ring-2 focus:ring-[#e94560]/40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
