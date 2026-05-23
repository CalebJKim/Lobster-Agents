import React, { useState, useCallback } from "react";

interface WaterCoolerControlsProps {
  onSetWaterCooler: (opts: { enabled?: boolean; topic?: string | null }) => void;
}

const QUICK_TOPICS = [
  { label: "Random", topic: null },
  { label: "Sandbox Gossip", topic: "tiny fish gossip about the shared NemoClaw workspaces" },
  { label: "Shell Decor", topic: "which workspace has the best shells and shiny pebbles" },
  { label: "Kelp Gateways", topic: "the best policy-safe route through the kelp gateways" },
  { label: "Coral Policies", topic: "funny reef rules for sharing tools across sandboxes" },
];

export default function WaterCoolerControls({ onSetWaterCooler }: WaterCoolerControlsProps) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [customTopic, setCustomTopic] = useState("");

  const toggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    onSetWaterCooler({ enabled: next });
  }, [enabled, onSetWaterCooler]);

  const setTopic = useCallback(
    (topic: string | null) => {
      onSetWaterCooler({ topic });
      setCustomTopic("");
    },
    [onSetWaterCooler]
  );

  const submitCustom = useCallback(() => {
    const trimmed = customTopic.trim();
    if (trimmed) {
      onSetWaterCooler({ topic: trimmed });
      setCustomTopic("");
    }
  }, [customTopic, onSetWaterCooler]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="h-8 shrink-0 rounded-lg bg-slate-950/48 px-3 text-[11px] font-semibold leading-none text-white/75 ring-1 ring-white/12 backdrop-blur-xl transition hover:bg-slate-950/62 hover:text-white"
        title="Reef chat controls"
      >
        Reef Chat
      </button>
    );
  }

  return (
    <div className="animate-fade-in absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-white/45 bg-[#f8fbfb]/86 p-3 shadow-[0_20px_70px_rgba(4,22,31,0.22)] backdrop-blur-md">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-800">Reef Chat</span>
        <button
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-1 text-sm text-slate-400 hover:text-slate-700"
        >
          x
        </button>
      </div>

      {/* Toggle */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={toggle}
          className={`relative w-8 h-4 rounded-full transition-colors ${
            enabled ? "bg-cyan-500" : "bg-slate-300"
          }`}
        >
          <div
            className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
          <span className="text-xs text-slate-600">
          {enabled ? "Lobsters chat when idle" : "Lobsters stay quiet when idle"}
        </span>
      </div>

      {/* Quick topic buttons */}
      <div className="flex flex-wrap gap-1 mb-2">
        {QUICK_TOPICS.map((t) => (
          <button
            key={t.label}
            onClick={() => setTopic(t.topic)}
            className="rounded-md bg-white/65 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-white"
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Custom topic */}
      <div className="flex gap-1">
        <input
          type="text"
          value={customTopic}
          onChange={(e) => setCustomTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitCustom()}
          placeholder="Prompt an idle reef topic..."
          className="flex-1 rounded-lg border border-white/70 bg-white/70 px-3 py-2 text-xs focus:border-cyan-500/50 focus:outline-none"
        />
        <button
          onClick={submitCustom}
          disabled={!customTopic.trim()}
          className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-30"
        >
          Set
        </button>
      </div>
    </div>
  );
}
