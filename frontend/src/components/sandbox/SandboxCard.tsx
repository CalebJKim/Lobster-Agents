import type { NemoClawSandbox } from "../../types";
import { AGENT_COLORS } from "../../utils/sprites";
import { policySummary, sandboxLabel } from "./labels";

interface SandboxCardProps {
  sandbox: NemoClawSandbox;
  active: boolean;
  carriedAgent: string | null;
  onSelect: () => void;
  onDropAgent: (sandboxName: string, agentName?: string) => void;
  onRemoveAgent: (sandboxName: string, agentName: string) => void;
  onCarryAgent: (agentName: string | null) => void;
  onOpenMonitor?: (sandboxName: string) => void;
  hermesConfigured?: boolean | null;
}

export default function SandboxCard({
  sandbox,
  active,
  carriedAgent,
  onSelect,
  onDropAgent,
  onRemoveAgent,
  onCarryAgent,
  onOpenMonitor,
  hermesConfigured,
}: SandboxCardProps) {
  const team = sandbox.assigned_agent_details ?? [];
  const canDrop = Boolean(carriedAgent);
  const run = sandbox.run_status;
  const stateLabel = !sandbox.live
    ? "Not live"
    : run?.running
    ? "Running"
    : team.length > 0
    ? `${team.length} claw${team.length === 1 ? "" : "s"}`
    : "Empty";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (canDrop) onDropAgent(sandbox.name);
        else onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (canDrop) onDropAgent(sandbox.name);
          else onSelect();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const transferredAgent = event.dataTransfer.getData("text/plain") || undefined;
        onDropAgent(sandbox.name, transferredAgent);
      }}
      className={`w-full rounded-md border p-3 text-left transition ${
        canDrop
          ? "cursor-copy border-cyan-100/55 bg-cyan-100/[0.12] hover:bg-cyan-100/[0.18]"
          : active
          ? "cursor-pointer border-cyan-200/45 bg-cyan-200/[0.10]"
          : "cursor-pointer border-white/10 bg-white/[0.055] hover:border-white/18 hover:bg-white/[0.085]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold leading-4 text-white/88">
            {sandboxLabel(sandbox)}
          </div>
          <div className="mt-0.5 truncate text-[10px] font-medium leading-4 text-white/40">
            {sandbox.model ?? "model unknown"} {sandbox.isDefault ? "/ default" : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded bg-emerald-300/12 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-4 text-emerald-100/80">
            {stateLabel}
          </span>
          {onOpenMonitor && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenMonitor(sandbox.name);
              }}
              className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-bold uppercase leading-4 text-white/72 hover:bg-white/[0.16] hover:text-white"
              title="Open the floating Task Monitor for this sandbox"
            >
              Monitor
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 text-[10px] font-medium leading-4 text-white/42">
        {canDrop
          ? `Release or click to put ${carriedAgent} here`
          : run?.last_message ?? policySummary(sandbox.policies)}
      </div>

      {run?.running && run.mode === "sequential" && (
        <div className="mt-1 text-[10px] font-semibold leading-4 text-amber-200/85">
          Running sequentially — each lobster takes its own turn in this sandbox; they do not converse inside it.
        </div>
      )}

      {run?.running && run.policies && run.policies.length > 0 && (
        <div className="mt-1 truncate text-[10px] font-semibold leading-4 text-cyan-200/85">
          Policies in effect: {run.policies.join(", ")}
        </div>
      )}

      <div className="mt-2 flex min-h-8 flex-wrap gap-1">
        {team.length > 0 ? (
          team.map((agent) => (
            <span
              key={agent.name}
              draggable
              onClick={(event) => event.stopPropagation()}
              onDragStart={(event) => {
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", agent.name);
                onCarryAgent(agent.name);
              }}
              onDragEnd={() => onCarryAgent(null)}
              className="inline-flex max-w-full cursor-grab items-center gap-1 rounded bg-white/[0.09] px-1.5 py-1 text-[10px] font-semibold leading-3 text-white/76 active:cursor-grabbing"
              title={`Drag ${agent.name} to another sandbox`}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: AGENT_COLORS[agent.name] ?? "#94a3b8" }}
              />
              <span className="truncate">{agent.name}</span>
              {(agent.species === "crab" || agent.runtime === "hermes") && (
                <span
                  className={`shrink-0 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide ${
                    hermesConfigured === true
                      ? "bg-emerald-300/16 text-emerald-100"
                      : hermesConfigured === false
                        ? "bg-amber-300/16 text-amber-100"
                        : "bg-white/[0.08] text-white/45"
                  }`}
                  title={
                    hermesConfigured === true
                      ? "Hermes configured"
                      : hermesConfigured === false
                        ? "Hermes not configured"
                        : "Checking Hermes runtime"
                  }
                >
                  Hermes {hermesConfigured === true ? "ready" : hermesConfigured === false ? "off" : "..."}
                </span>
              )}
              <button
                type="button"
                draggable={false}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveAgent(sandbox.name, agent.name);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onRemoveAgent(sandbox.name, agent.name);
                  }
                }}
                className="ml-0.5 rounded px-1 text-[9px] font-bold uppercase tracking-normal text-white/42 hover:bg-white/10 hover:text-white"
                title={`Remove ${agent.name}`}
                aria-label={`Remove ${agent.name} from ${sandboxLabel(sandbox)}`}
              >
                Remove
              </button>
            </span>
          ))
        ) : (
          <span className="text-[10px] font-medium leading-8 text-white/28">
            Drop profiles here
          </span>
        )}
      </div>
    </div>
  );
}
