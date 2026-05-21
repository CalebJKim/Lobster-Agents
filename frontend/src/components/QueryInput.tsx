import React, { useState, useCallback, useRef } from "react";
import { unlockAudio, playQuerySubmit } from "../utils/sounds";

interface QueryInputProps {
  onSubmit: (query: string) => void;
  currentQuery: string | null;
  connected: boolean;
  sandboxBusyCount?: number;
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
    label: "My Finances",
    prompt: "Read my expenses file at /home/nvidia/documents/demo-files/expenses-q1-2025.csv and analyze my Q1 spending. Where am I wasting money? What subscriptions can I cut? How much am I spending on food delivery vs groceries?",
  },
  {
    label: "Job Offers",
    prompt: "I have two job offers I need to compare. Read /home/nvidia/documents/demo-files/offer-aurora-tech.md and /home/nvidia/documents/demo-files/offer-meridian-ai.md — compare total comp, equity risk, career growth, and tell me which one to take.",
  },
  {
    label: "Perf Review",
    prompt: "Read my performance review notes at /home/nvidia/documents/demo-files/perf-review-notes.md and help me prepare for my review. Am I ready for Staff promotion? Write a strong self-assessment summary and talking points for my manager.",
  },
  {
    label: "Trip Plan",
    prompt: "I have 5 days in Tokyo next month. Build me a day-by-day itinerary covering must-see spots, hidden gems, and the best food neighborhoods.",
  },
  {
    label: "Build App",
    prompt: "Write a Python CLI tool that monitors my Downloads folder and auto-organizes files into subfolders by type (images, documents, videos, archives).",
  },
  {
    label: "Research",
    prompt: "What are the top 3 local LLMs for running on consumer GPUs in 2025? Compare performance, memory usage, and best use cases.",
  },
];

export default function QueryInput({
  onSubmit,
  currentQuery,
  connected,
  sandboxBusyCount = 0,
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

  const showSuggestions =
    !currentQuery && connected && input.trim().length === 0 && droppedFiles.length === 0;

  return (
    <div
      ref={dropRef}
      className={`rounded-lg border border-white/30 bg-[#f8fbfb]/72 shadow-[0_18px_55px_rgba(4,22,31,0.18)] backdrop-blur-2xl transition-colors ${
        isDragging ? "border-rose-400/50 bg-white/84" : ""
      }`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Drop overlay */}
      {isDragging && (
        <div className="px-4 py-3 text-center">
          <p className="text-sm font-semibold text-rose-600">Drop files here</p>
          <p className="text-xs text-slate-500">CSV, TXT, MD, JSON, and more</p>
        </div>
      )}

      {/* Uploaded file chips */}
      {droppedFiles.length > 0 && !isDragging && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {droppedFiles.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-600"
            >
              {f.name}
              <button
                onClick={() => removeFile(i)}
                className="ml-0.5 text-rose-500/50 hover:text-rose-600"
              >
                x
              </button>
            </span>
          ))}
          {uploading && (
            <span className="animate-pulse text-xs text-slate-500">Uploading...</span>
          )}
        </div>
      )}

      {/* Status line */}
      {currentQuery && (
        <div className="flex items-center gap-2 px-4 pt-3 text-xs">
          <span className="inline-flex gap-0.5">
            <span className="typing-dot w-1 h-1 rounded-full bg-yellow-400 inline-block" />
            <span className="typing-dot w-1 h-1 rounded-full bg-yellow-400 inline-block" />
            <span className="typing-dot w-1 h-1 rounded-full bg-yellow-400 inline-block" />
          </span>
          <span className="min-w-0 truncate font-medium text-amber-700">
            Working on:{" "}
            <span className="font-normal text-amber-800">
              {currentQuery.length > 80
                ? currentQuery.slice(0, 77) + "..."
                : currentQuery}
            </span>
          </span>
        </div>
      )}
      {!currentQuery && sandboxBusyCount > 0 && (
        <div className="flex items-center gap-2 px-4 pt-3 text-xs">
          <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-500" />
          <span className="min-w-0 truncate font-medium text-slate-600">
            {sandboxBusyCount} lobster{sandboxBusyCount === 1 ? "" : "s"} working in sandboxes. General prompts use the available team.
          </span>
        </div>
      )}

      {/* Demo prompt suggestions */}
      {showSuggestions && (
        <div className="scrollbar-hide flex gap-1 overflow-x-auto border-b border-slate-950/[0.06] px-3 py-2 max-md:hidden">
          {DEMO_PROMPTS.slice(0, 4).map((p, i) => (
            <button
              key={i}
              onClick={() => handlePromptClick(p.prompt)}
              className="shrink-0 rounded px-2.5 py-1.5 text-[11px] font-semibold leading-4 text-slate-500 transition hover:bg-white/54 hover:text-slate-900"
              title={p.prompt}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={handleSubmit} className="flex items-end gap-2 px-3 py-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={currentQuery ? "Reply to the team..." : "Ask the team..."}
          disabled={!connected}
          rows={1}
          className="max-h-28 min-h-[52px] min-w-0 flex-1 resize-none rounded-md border border-slate-950/[0.08] bg-white/72 px-3.5 py-3 text-sm leading-6 text-slate-800 shadow-inner shadow-slate-950/[0.025] transition-all placeholder:text-slate-400 focus:border-cyan-500/35 focus:outline-none focus:ring-4 focus:ring-cyan-500/10 disabled:opacity-70"
        />
        <button
          type="submit"
          disabled={!connected || !input.trim()}
          className="min-h-[52px] min-w-16 shrink-0 rounded-md bg-slate-950 px-4 py-3 text-sm font-semibold leading-6 text-white shadow-md shadow-slate-950/18 transition-all hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-950/15 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
