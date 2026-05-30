import type { AgentInfo } from "../../types";
import { AGENT_COLORS, ROLE_LABELS } from "../../utils/sprites";
import { sandboxNameLabel } from "./labels";

interface AgentChipProps {
  agent: AgentInfo;
  assignedTo?: string;
  picked: boolean;
  onPick: (agentName: string) => void;
  onRemove?: (agentName: string) => void;
  hermesConfigured?: boolean | null;
}

export default function AgentChip({
  agent,
  assignedTo,
  picked,
  onPick,
  onRemove,
  hermesConfigured,
}: AgentChipProps) {
  const color = AGENT_COLORS[agent.name] ?? "#94a3b8";
  const speciesLabel = agent.species === "crab" ? "Crab" : "Lobster";
  const runtimeLabel = agent.runtime === "hermes" ? "Hermes" : "OpenClaw";
  const isCrab = agent.species === "crab" || agent.runtime === "hermes";

  return (
    <div
      className={`group relative flex min-w-0 items-center gap-2 rounded-md border px-2 py-2 text-left transition ${
        picked
          ? "border-cyan-200/55 bg-cyan-200/[0.16] shadow-[0_0_0_1px_rgba(165,243,252,0.12)]"
          : "border-white/10 bg-white/[0.075] hover:bg-white/[0.12]"
      }`}
    >
      <button
        type="button"
        draggable
        onClick={() => onPick(agent.name)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", agent.name);
          onPick(agent.name);
        }}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title={`Click or drag ${agent.name} into a sandbox`}
      >
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[11px] font-bold text-slate-950"
          style={{ backgroundColor: color }}
        >
          {agent.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold leading-4 text-white/86">
            {agent.name}
          </span>
          <span className="block truncate text-[10px] font-medium leading-4 text-white/38">
            {assignedTo
              ? `In ${sandboxNameLabel(assignedTo)}`
              : `${speciesLabel} · ${ROLE_LABELS[agent.role]} · ${runtimeLabel}`}
          </span>
          {isCrab && (
            <span
              className={`mt-0.5 inline-flex rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ${
                hermesConfigured === true
                  ? "bg-emerald-300/16 text-emerald-100"
                  : hermesConfigured === false
                    ? "bg-amber-300/16 text-amber-100"
                    : "bg-white/[0.08] text-white/45"
              }`}
            >
              Hermes {hermesConfigured === true ? "configured" : hermesConfigured === false ? "not configured" : "checking"}
            </span>
          )}
          {(agent.openclaw_skills && agent.openclaw_skills.length > 0) && (
            <span className="mt-0.5 flex flex-wrap gap-0.5">
              {agent.openclaw_skills.slice(0, 3).map((slug) => (
                <span
                  key={`s-${slug}`}
                  title={`OpenClaw skill: ${slug}`}
                  className="rounded bg-emerald-300/16 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-emerald-100"
                >
                  {slug}
                </span>
              ))}
            </span>
          )}
          {agent.tools && agent.tools.length > 0 && (
            <span className="mt-0.5 flex flex-wrap gap-0.5">
              {agent.tools.slice(0, 3).map((tool) => (
                <span
                  key={`t-${tool}`}
                  title={`Trait: ${tool}`}
                  className="rounded bg-white/[0.08] px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white/55"
                >
                  {tool.replace(/_/g, " ")}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (confirm(`Remove ${agent.name}? They'll be unassigned from any sandbox.`)) {
              onRemove(agent.name);
            }
          }}
          title={`Remove ${agent.name}`}
          className="grid h-6 w-6 shrink-0 place-items-center rounded bg-white/[0.04] text-[12px] font-bold text-white/30 opacity-0 transition hover:bg-rose-500/30 hover:text-rose-100 group-hover:opacity-100"
          aria-label={`Remove ${agent.name}`}
        >
          ✕
        </button>
      )}
    </div>
  );
}
