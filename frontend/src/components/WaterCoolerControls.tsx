import React, { useState, useCallback } from "react";

interface WaterCoolerControlsProps {
  onSetWaterCooler: (opts: { enabled?: boolean; topic?: string | null }) => void;
}

const QUICK_TOPICS = [
  { label: "Random", topic: null },
  { label: "Weekend plans", topic: "what everyone's doing this weekend" },
  { label: "Best lunch spots", topic: "the best lunch spots near the office — hidden gems only" },
  { label: "Hot takes", topic: "their most controversial tech hot take that would get them ratio'd on Twitter" },
  { label: "Side projects", topic: "the side projects they're secretly working on at home" },
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
        className="px-2 py-1 text-[10px] font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
        title="Water cooler chat controls"
      >
        Idle Chat
      </button>
    );
  }

  return (
    <div className="absolute bottom-full right-0 mb-1 w-72 bg-white rounded-lg shadow-lg border border-gray-200 p-3 z-50 animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-700">Idle Chat</span>
        <button
          onClick={() => setOpen(false)}
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          x
        </button>
      </div>

      {/* Toggle */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={toggle}
          className={`relative w-8 h-4 rounded-full transition-colors ${
            enabled ? "bg-[#e94560]" : "bg-gray-300"
          }`}
        >
          <div
            className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
        <span className="text-[11px] text-gray-600">
          {enabled ? "Agents chatting when idle" : "Agents silent when idle"}
        </span>
      </div>

      {/* Quick topic buttons */}
      <div className="flex flex-wrap gap-1 mb-2">
        {QUICK_TOPICS.map((t) => (
          <button
            key={t.label}
            onClick={() => setTopic(t.topic)}
            className="px-2 py-0.5 text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition-colors"
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
          placeholder="Set a topic..."
          className="flex-1 text-[11px] px-2 py-1 border border-gray-200 rounded bg-gray-50 focus:outline-none focus:border-[#e94560]/50"
        />
        <button
          onClick={submitCustom}
          disabled={!customTopic.trim()}
          className="px-2 py-1 text-[10px] bg-[#e94560] text-white rounded disabled:opacity-30"
        >
          Set
        </button>
      </div>
    </div>
  );
}
