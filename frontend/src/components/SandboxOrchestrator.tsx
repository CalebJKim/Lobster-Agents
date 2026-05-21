import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentInfo,
  ChatMessage,
  NemoClawPolicyStatus,
  NemoClawRunStatus,
  NemoClawSandbox,
  NemoClawStatus,
  OpenClawApprovalsStatus,
} from "../types";
import { SANDBOX_WORKSPACES } from "../utils/claws";
import { AGENT_COLORS, ROLE_LABELS } from "../utils/sprites";

interface SandboxOrchestratorProps {
  agents: AgentInfo[];
  messages: ChatMessage[];
  onCollapse?: () => void;
  onStateRefresh?: () => void | Promise<void>;
  onSandboxAssignments?: (assignments: Record<string, string[]>) => void;
  /** Open the floating Task Monitor for the given sandbox. */
  onOpenMonitor?: (sandboxName: string) => void;
  /** Lift the joined sandboxes list up so the floating monitor can read it. */
  onSandboxesChange?: (sandboxes: NemoClawSandbox[]) => void;
}

const DEFAULT_TASK =
  "Work as a tiny NemoClaw sandbox team. Inspect your sandbox, propose one useful improvement for the reef demo, and return a concise implementation plan.";

const API_TIMEOUT_MS = 8000;
const SPARK_BACKEND_HOST = "10.110.23.141";
type RunUiStatus = "running" | "stopping" | "cancelled" | "finished" | "error";

type SandboxRunStatus = {
  runId: string;
  message: string;
  status: RunUiStatus;
  agents?: string[];
  task?: string;
  currentAgent?: string;
  outputs?: Record<string, string>;
  errors?: Record<string, string>;
};

function shortName(name: string): string {
  return name.replace(/^nemoclaw-/, "").replace(/-/g, " ");
}

function sandboxLabel(sandbox: Pick<NemoClawSandbox, "name" | "display_name">): string {
  return sandbox.display_name || shortName(sandbox.name);
}

const SANDBOX_LABELS = Object.fromEntries(
  SANDBOX_WORKSPACES.map((workspace) => [workspace.name, workspace.displayName])
) as Record<string, string>;

function sandboxNameLabel(sandboxName: string): string {
  return SANDBOX_LABELS[sandboxName] ?? shortName(sandboxName);
}

function policySummary(policies?: string[]): string {
  if (!policies || policies.length === 0) return "No policy presets";
  if (policies.length <= 3) return policies.join(", ");
  return `${policies.slice(0, 3).join(", ")} +${policies.length - 3}`;
}

function assignmentsFromSandboxes(sandboxes: NemoClawSandbox[]): Record<string, string[]> {
  const assignments: Record<string, string[]> = {};
  for (const sandbox of sandboxes) {
    assignments[sandbox.name] = [...(sandbox.assigned_agents ?? [])];
  }
  return assignments;
}

function uniqueAgentNames(agentNames: string[]): string[] {
  return Array.from(new Set(agentNames.filter(Boolean)));
}

function mergeAssignments(
  current: Record<string, string[]>,
  incoming: Record<string, string[]>
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [sandboxName, agentNames] of Object.entries(current)) {
    next[sandboxName] = uniqueAgentNames(agentNames);
  }

  for (const [sandboxName, agentNames] of Object.entries(incoming)) {
    const incomingTeam = uniqueAgentNames(agentNames);
    const incomingSet = new Set(incomingTeam);
    for (const [otherSandbox, otherTeam] of Object.entries(next)) {
      if (otherSandbox === sandboxName) continue;
      next[otherSandbox] = otherTeam.filter((name) => !incomingSet.has(name));
    }
    next[sandboxName] = incomingTeam;
  }

  return next;
}

function addAgentToSandbox(
  current: Record<string, string[]>,
  sandboxName: string,
  agentName: string
): Record<string, string[]> {
  const next = mergeAssignments(current, {
    [sandboxName]: uniqueAgentNames([...(current[sandboxName] ?? []), agentName]),
  });
  return next;
}

function runUiStatus(status?: string, running?: boolean): RunUiStatus {
  if (status === "cancelling") return "stopping";
  if (status === "cancelled") return "cancelled";
  if (status === "finished") return "finished";
  if (status === "error") return "error";
  if (running) return "running";
  return "running";
}

function formatRunStatus(run: NemoClawRunStatus): SandboxRunStatus {
  const status = runUiStatus(run.status, run.running);
  const agentLabel = run.agents?.length === 1 ? run.agents[0] : `${run.agents?.length ?? 0} claws`;
  const messageByStatus: Record<RunUiStatus, string> = {
    running: `Running ${agentLabel} in this NemoClaw sandbox.`,
    stopping: "Stop requested. Waiting for the active OpenClaw turn to unwind.",
    cancelled: "Run cancelled.",
    finished: "Run finished. Agent results are below when available.",
    error: "Run hit an error.",
  };
  return {
    runId: run.run_id,
    message: run.last_message || messageByStatus[status],
    status,
    agents: run.agents ?? [],
    task: run.task,
    currentAgent: run.current_agent,
    outputs: run.outputs ?? {},
    errors: run.errors ?? {},
  };
}

function formatChatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function apiUrls(path: string): string[] {
  const urls = [path];
  const host = window.location.hostname;
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (host && !loopback) urls.push(`http://${host}:8001${path}`);
  urls.push(`http://${SPARK_BACKEND_HOST}:8001${path}`);
  return Array.from(new Set(urls));
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const errors: string[] = [];

  for (const url of apiUrls(path)) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...init,
        cache: "no-store",
        headers: requestHeaders(init),
        signal: controller.signal,
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        let detail = "";
        if (contentType.includes("application/json")) {
          const body = await res.json().catch(() => null);
          detail = typeof body?.detail === "string" ? `: ${body.detail}` : "";
        }
        throw new Error(`${url} failed: ${res.status}${detail}`);
      }
      if (!contentType.includes("application/json")) {
        const preview = (await res.text()).slice(0, 60).replace(/\s+/g, " ");
        throw new Error(`${url} returned ${contentType || "non-JSON"}: ${preview}`);
      }
      return res.json();
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    } finally {
      window.clearTimeout(timeout);
    }
  }

  throw new Error(errors.join(" | ") || `Could not fetch ${path}`);
}

function requestHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return headers;
}

async function fetchSandboxes(): Promise<NemoClawStatus> {
  return fetchJson<NemoClawStatus>("/sandboxes");
}

async function assignTeam(sandboxName: string, agentNames: string[]) {
  return fetchJson<{ status: string; assignments: Record<string, string[]> }>(`/sandboxes/${encodeURIComponent(sandboxName)}/team`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_names: agentNames }),
  });
}

async function runSandboxTask(sandboxName: string, task: string, agentNames: string[]) {
  return fetchJson<{ status: string; run_id?: string }>(`/sandboxes/${encodeURIComponent(sandboxName)}/task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, agent_names: agentNames }),
  });
}

async function cancelSandboxTask(sandboxName: string, runId: string) {
  return fetchJson<{ status: string; cancelled: boolean; run_id: string }>(
    `/sandboxes/${encodeURIComponent(sandboxName)}/task/${encodeURIComponent(runId)}/cancel`,
    { method: "POST" }
  );
}

async function fetchPolicies(sandboxName: string): Promise<NemoClawPolicyStatus> {
  return fetchJson<NemoClawPolicyStatus>(`/sandboxes/${encodeURIComponent(sandboxName)}/policies`);
}

async function setPolicy(sandboxName: string, preset: string, enabled: boolean, dryRun: boolean) {
  return fetchJson<{ output?: string; ok?: boolean }>(`/sandboxes/${encodeURIComponent(sandboxName)}/policies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset, enabled, dry_run: dryRun }),
  });
}

async function fetchApprovals(sandboxName: string | null): Promise<OpenClawApprovalsStatus> {
  const suffix = sandboxName ? `?sandbox_name=${encodeURIComponent(sandboxName)}` : "";
  return fetchJson<OpenClawApprovalsStatus>(`/approvals${suffix}`);
}

function AgentChip({
  agent,
  assignedTo,
  picked,
  onPick,
  onRemove,
}: {
  agent: AgentInfo;
  assignedTo?: string;
  picked: boolean;
  onPick: (agentName: string) => void;
  onRemove?: (agentName: string) => void;
}) {
  const color = AGENT_COLORS[agent.name] ?? "#94a3b8";

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
          {assignedTo ? `In ${sandboxNameLabel(assignedTo)}` : ROLE_LABELS[agent.role]}
        </span>
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

function SandboxCard({
  sandbox,
  active,
  carriedAgent,
  onSelect,
  onDropAgent,
  onRemoveAgent,
  onCarryAgent,
  onOpenMonitor,
}: {
  sandbox: NemoClawSandbox;
  active: boolean;
  carriedAgent: string | null;
  onSelect: () => void;
  onDropAgent: (sandboxName: string, agentName?: string) => void;
  onRemoveAgent: (sandboxName: string, agentName: string) => void;
  onCarryAgent: (agentName: string | null) => void;
  onOpenMonitor?: (sandboxName: string) => void;
}) {
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
            Drop lobsters here
          </span>
        )}
      </div>
    </div>
  );
}


export default function SandboxOrchestrator({
  agents,
  messages,
  onCollapse,
  onStateRefresh,
  onSandboxAssignments,
  onOpenMonitor,
  onSandboxesChange,
}: SandboxOrchestratorProps) {
  const [status, setStatus] = useState<NemoClawStatus | null>(null);
  const [policies, setPolicies] = useState<NemoClawPolicyStatus | null>(null);
  const [approvals, setApprovals] = useState<OpenClawApprovalsStatus | null>(null);
  const [selectedSandbox, setSelectedSandbox] = useState<string | null>(null);
  const [draggedAgent, setDraggedAgent] = useState<string | null>(null);
  const [task, setTask] = useState(DEFAULT_TASK);
  const [policyPreview, setPolicyPreview] = useState<{ preset: string; enabled: boolean; output: string } | null>(null);
  const [runStatus, setRunStatus] = useState<Record<string, SandboxRunStatus>>({});
  const [assignmentSnapshot, setAssignmentSnapshot] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Population editor state — add/remove lobsters at runtime.
  const [archetypes, setArchetypes] = useState<
    { role: string; label: string; default_name: string; tools: string[]; openclaw_skills: string[] }[]
  >([]);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newArchetype, setNewArchetype] = useState<string>("");
  const [popBusy, setPopBusy] = useState(false);
  const [popError, setPopError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/archetypes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        const list = (d.archetypes ?? []) as typeof archetypes;
        setArchetypes(list);
        if (list.length && !newArchetype) setNewArchetype(list[0].role);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spawnLobster = useCallback(async () => {
    if (!newName.trim() || !newArchetype) return;
    setPopBusy(true);
    setPopError(null);
    try {
      const res = await fetch("/lobsters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archetype: newArchetype, name: newName.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.detail || `spawn failed (${res.status})`);
      setNewName("");
      setAddOpen(false);
      await onStateRefresh?.();
    } catch (err) {
      setPopError(err instanceof Error ? err.message : "Could not spawn lobster");
    } finally {
      setPopBusy(false);
    }
  }, [newName, newArchetype, onStateRefresh]);

  const removeLobster = useCallback(
    async (name: string) => {
      setPopError(null);
      try {
        const res = await fetch(`/lobsters/${encodeURIComponent(name)}`, {
          method: "DELETE",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.detail || `remove failed (${res.status})`);
        await onStateRefresh?.();
      } catch (err) {
        setPopError(err instanceof Error ? err.message : "Could not remove lobster");
      }
    },
    [onStateRefresh]
  );

  const load = useCallback(async () => {
    try {
      const next = await fetchSandboxes();
      setStatus(next);
      setAssignmentSnapshot(assignmentsFromSandboxes(next.sandboxes));
      setRunStatus((current) => {
        let changed = false;
        const updated = { ...current };
        for (const sandbox of next.sandboxes) {
          if (!sandbox.run_status?.run_id) continue;
          const formatted = formatRunStatus(sandbox.run_status);
          const existing = updated[sandbox.name];
          if (
            !existing ||
              existing.runId !== formatted.runId ||
              existing.status !== formatted.status ||
              existing.message !== formatted.message ||
              JSON.stringify(existing.outputs ?? {}) !== JSON.stringify(formatted.outputs ?? {}) ||
              JSON.stringify(existing.errors ?? {}) !== JSON.stringify(formatted.errors ?? {})
            ) {
              updated[sandbox.name] = formatted;
              changed = true;
            }
        }
        return changed ? updated : current;
      });
      setSelectedSandbox((current) => current ?? next.defaultSandbox ?? next.sandboxes[0]?.name ?? null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not load sandboxes");
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 12000);
    return () => window.clearInterval(id);
  }, [load]);

  const loadSelectedDetails = useCallback(async (sandboxName: string | null) => {
    if (!sandboxName) return;
    try {
      const [policyResult, approvalsResult] = await Promise.all([
        fetchPolicies(sandboxName),
        fetchApprovals(sandboxName),
      ]);
      setPolicies(policyResult);
      setApprovals(approvalsResult);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not load sandbox controls");
    }
  }, []);

  useEffect(() => {
    loadSelectedDetails(selectedSandbox);
  }, [loadSelectedDetails, selectedSandbox]);

  const agentsByName = useMemo(
    () => new Map(agents.map((agent) => [agent.name, agent])),
    [agents]
  );

  const sandboxes = useMemo(() => {
    return (status?.sandboxes ?? []).map((sandbox) => {
      const assigned = assignmentSnapshot[sandbox.name] ?? sandbox.assigned_agents ?? [];
      return {
        ...sandbox,
        assigned_agents: assigned,
        assigned_agent_details: assigned
          .map((name) => agentsByName.get(name))
          .filter((agent): agent is AgentInfo => Boolean(agent)),
      };
    });
  }, [agentsByName, assignmentSnapshot, status]);

  // Mirror the joined list up so the floating Task Monitor reads the same data.
  useEffect(() => {
    onSandboxesChange?.(sandboxes);
  }, [sandboxes, onSandboxesChange]);

  const agentAssignments = useMemo(() => {
    const map: Record<string, string> = {};
    for (const sandbox of sandboxes) {
      for (const agentName of sandbox.assigned_agents ?? []) {
        map[agentName] = sandbox.name;
      }
    }
    return map;
  }, [sandboxes]);

  const selected = useMemo(
    () => sandboxes.find((sandbox) => sandbox.name === selectedSandbox) ?? null,
    [selectedSandbox, sandboxes]
  );

  const updateTeam = useCallback(
    async (sandboxName: string, agentNames: string[]) => {
      setBusy(true);
      setNotice(null);
      try {
        const result = await assignTeam(sandboxName, agentNames);
        const nextAssignments = result.assignments ?? { [sandboxName]: agentNames };
        setAssignmentSnapshot((current) => mergeAssignments(current, nextAssignments));
        onSandboxAssignments?.(nextAssignments);
        setStatus((current) => {
          if (!current) return current;
          return {
            ...current,
            sandboxes: current.sandboxes.map((sandbox) => {
              const assigned = nextAssignments[sandbox.name] ?? sandbox.assigned_agents ?? [];
              return {
                ...sandbox,
                assigned_agents: assigned,
                assigned_agent_details: assigned
                  .map((name) => agentsByName.get(name))
                  .filter((agent): agent is AgentInfo => Boolean(agent)),
              };
            }),
          };
        });
        await Promise.all([load(), onStateRefresh?.()]);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Could not assign team");
        await load();
      } finally {
        setBusy(false);
      }
    },
    [agentsByName, load, onSandboxAssignments, onStateRefresh]
  );

  const handleDropAgent = useCallback(
    (sandboxName: string, transferredAgent?: string) => {
      const agentName = transferredAgent || draggedAgent;
      if (!agentName) {
        setSelectedSandbox(sandboxName);
        return;
      }
      const sandbox = sandboxes.find((item) => item.name === sandboxName);
      const existing = sandbox?.assigned_agents ?? [];
      const nextTeam = Array.from(new Set([...existing, agentName]));
      setSelectedSandbox(sandboxName);
      setDraggedAgent(null);
      setAssignmentSnapshot((current) => addAgentToSandbox(current, sandboxName, agentName));
      updateTeam(sandboxName, nextTeam);
    },
    [draggedAgent, sandboxes, updateTeam]
  );

  const handleRemoveAgent = useCallback(
    (sandboxName: string, agentName: string) => {
      const sandbox = sandboxes.find((item) => item.name === sandboxName);
      if (!sandbox) return;
      setAssignmentSnapshot((current) =>
        mergeAssignments(current, {
          [sandboxName]: (current[sandboxName] ?? sandbox.assigned_agents).filter((name) => name !== agentName),
        })
      );
      updateTeam(
        sandboxName,
        sandbox.assigned_agents.filter((name) => name !== agentName)
      );
    },
    [sandboxes, updateTeam]
  );

  const handleRunTask = useCallback(async () => {
    if (!selected || !task.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await runSandboxTask(selected.name, task.trim(), selected.assigned_agents);
      if (!result.run_id) {
        throw new Error("Backend accepted the run but did not return a run id.");
      }
      const runId = result.run_id;
      const message = `Run started with ${selected.assigned_agents.length} claw${selected.assigned_agents.length === 1 ? "" : "s"}. Progress appears in Task Monitor.`;
      setRunStatus((current) => ({
        ...current,
        [selected.name]: {
          runId,
          message,
            status: "running",
            agents: selected.assigned_agents,
            task: task.trim(),
        },
      }));
      await onStateRefresh?.();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not start sandbox task");
    } finally {
      setBusy(false);
    }
  }, [onStateRefresh, selected, task]);

  const handleStopTask = useCallback(async () => {
    if (!selected) return;
    const activeRun = runStatus[selected.name];
    if (!activeRun || activeRun.status === "finished" || activeRun.status === "cancelled") return;

    const stoppingMessage = "Stop requested. Letting the active OpenClaw turn unwind.";
    setRunStatus((current) => ({
      ...current,
      [selected.name]: {
        ...activeRun,
        message: stoppingMessage,
        status: "stopping",
      },
    }));

    try {
      const result = await cancelSandboxTask(selected.name, activeRun.runId);
      if (!result.cancelled) {
        const message =
          result.status === "not_running"
            ? "No active run was found for this sandbox."
            : `Stop request returned: ${result.status}`;
        setRunStatus((current) => ({
          ...current,
          [selected.name]: {
            ...activeRun,
            message,
            status: result.status === "not_running" ? "finished" : "error",
          },
        }));
        setNotice(message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not stop sandbox task";
      setRunStatus((current) => ({
        ...current,
        [selected.name]: {
          ...activeRun,
          message,
          status: "error",
        },
      }));
      setNotice(message);
    }
  }, [runStatus, selected]);

  const handlePreviewPolicy = useCallback(
    async (preset: string, enabled: boolean) => {
      if (!selected) return;
      setBusy(true);
      setNotice(null);
      try {
        const result = await setPolicy(selected.name, preset, enabled, true);
        setPolicyPreview({
          preset,
          enabled,
          output: result.output || "No changes needed.",
        });
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Could not preview policy");
      } finally {
        setBusy(false);
      }
    },
    [selected]
  );

  const handleApplyPolicy = useCallback(async () => {
    if (!selected || !policyPreview) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await setPolicy(selected.name, policyPreview.preset, policyPreview.enabled, false);
      setNotice(result.output || `${policyPreview.preset} updated.`);
      setPolicyPreview(null);
      await Promise.all([load(), loadSelectedDetails(selected.name)]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not apply policy");
    } finally {
      setBusy(false);
    }
  }, [load, loadSelectedDetails, policyPreview, selected]);

  const approvalSummary = useMemo(() => {
    const text = approvals?.effective_policy ?? "";
    const ask = text.match(/ask=([a-z-]+)/i)?.[1];
    const security = text.match(/security=([a-z-]+)/i)?.[1];
    return {
      ask: ask ?? "unknown",
      security: security ?? "unknown",
    };
  }, [approvals]);

  const selectedSandboxMessages = useMemo(() => {
    if (!selected) return [];
    const team = new Set(selected.assigned_agents ?? []);
    return messages
      .filter((msg) => {
        if (msg.sandbox_name === selected.name) return true;
        if (!team.has(msg.agent)) return false;
        return team.has(msg.target) || msg.target === selected.name;
      })
      .slice(-8);
  }, [messages, selected]);

  const selectedRunStatus = selected ? runStatus[selected.name] : null;
  const selectedRunActive =
    selectedRunStatus?.status === "running" || selectedRunStatus?.status === "stopping";
  const selectedSandboxLive = selected?.live === true;

  useEffect(() => {
    const latestByRun = new Map<string, ChatMessage>();
    for (const msg of messages) {
      if (!msg.run_id) continue;
      latestByRun.set(msg.run_id, msg);
    }
    if (latestByRun.size === 0) return;

    setRunStatus((current) => {
      let changed = false;
      const next = { ...current };
      for (const [sandboxName, activeRun] of Object.entries(current)) {
        const msg = latestByRun.get(activeRun.runId);
        if (!msg) continue;

        let status: RunUiStatus | null = null;
        if (msg.message.includes("Stop requested")) status = "stopping";
        if (msg.message.includes("Run cancelled")) status = "cancelled";
        if (msg.message.includes("Run finished")) status = "finished";
        if (!status && msg.agent === "NemoClaw") status = "running";
        if (!status) continue;
        if (activeRun.status === status && activeRun.message === msg.message) continue;

        next[sandboxName] = {
          ...activeRun,
          status,
          message: msg.message,
        };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [messages]);

  return (
    <aside className="pointer-events-auto flex h-full w-full flex-col overflow-hidden rounded-lg border border-white/18 bg-slate-950/48 p-4 text-white shadow-[0_24px_80px_rgba(4,22,31,0.24)] backdrop-blur-2xl">
      <header className="mb-3 flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase leading-4 tracking-normal text-white/36">
            NemoClaw Sandboxes
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold leading-5 text-white/88">
            Build teams in sandbox containers
          </div>
          <div className="mt-1 text-[10px] font-medium leading-4 text-white/46">
            {draggedAgent
              ? `${draggedAgent} selected. Click a sandbox to drop.`
              : "Click a claw, then click a sandbox. Drag also works."}
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="h-8 shrink-0 rounded-md bg-white/[0.08] px-2.5 text-[11px] font-semibold text-white/62 transition hover:bg-white/[0.13] hover:text-white disabled:opacity-40"
        >
          Refresh
        </button>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/[0.08] text-lg font-semibold leading-none text-white/62 transition hover:bg-white/[0.13] hover:text-white"
            title="Collapse sandboxes"
            aria-label="Collapse sandboxes"
          >
            -
          </button>
        )}
      </header>

      <div className="mb-3 grid shrink-0 grid-cols-2 gap-2">
        <div className="rounded-md bg-white/[0.06] px-3 py-2">
          <div className="text-[10px] font-bold uppercase leading-4 text-white/32">
            Gateway
          </div>
          <div className="truncate text-[12px] font-semibold leading-5 text-white/78">
            {status?.gatewayHealth?.healthy ? "Healthy" : status ? "Needs attention" : "Loading"}
          </div>
        </div>
        <div className="rounded-md bg-white/[0.06] px-3 py-2">
          <div className="text-[10px] font-bold uppercase leading-4 text-white/32">
            Inference
          </div>
          <div className="truncate text-[12px] font-semibold leading-5 text-white/78">
            {status?.liveInference?.model ?? "Checking"}
          </div>
        </div>
      </div>

      {status?.error && (
        <div className="mb-2 rounded-md border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-[11px] leading-4 text-rose-100">
          {status.error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)] gap-4">
        <div className="min-h-0 min-w-0 overflow-y-auto pr-1">
          <div className="mb-1.5 flex items-center justify-between gap-1">
            <span className="text-[11px] font-bold uppercase leading-4 text-white/40">
              OpenClaw Profiles
            </span>
            <button
              type="button"
              onClick={() => setAddOpen((open) => !open)}
              title="Spawn a new lobster"
              className="grid h-5 w-5 place-items-center rounded bg-white/[0.08] text-[11px] font-bold leading-3 text-white/70 hover:bg-cyan-300/30 hover:text-cyan-50"
              aria-label="Add lobster"
            >
              +
            </button>
          </div>
          {addOpen && (
            <div className="mb-2 rounded-md border border-white/12 bg-white/[0.05] p-2">
              <select
                value={newArchetype}
                onChange={(event) => setNewArchetype(event.target.value)}
                className="mb-1.5 w-full rounded border border-white/10 bg-slate-950/40 px-2 py-1 text-[11px] font-semibold text-white/86 outline-none focus:border-cyan-200/40"
              >
                {archetypes.map((a) => (
                  <option key={a.role} value={a.role}>
                    {a.label} ({a.openclaw_skills.join("+") || "no skills"})
                  </option>
                ))}
              </select>
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") spawnLobster();
                  if (event.key === "Escape") setAddOpen(false);
                }}
                placeholder="Name (e.g. Pip)"
                maxLength={40}
                className="mb-1.5 w-full rounded border border-white/10 bg-slate-950/40 px-2 py-1 text-[11px] text-white/86 outline-none placeholder:text-white/30 focus:border-cyan-200/40"
              />
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={spawnLobster}
                  disabled={popBusy || !newName.trim()}
                  className="flex-1 rounded bg-cyan-300/30 px-2 py-1 text-[10px] font-bold uppercase text-cyan-50 hover:bg-cyan-300/45 disabled:opacity-40"
                >
                  {popBusy ? "Spawning…" : "Spawn"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    setPopError(null);
                  }}
                  className="rounded bg-white/[0.08] px-2 py-1 text-[10px] font-bold uppercase text-white/65 hover:bg-white/[0.16]"
                >
                  Cancel
                </button>
              </div>
              {popError && (
                <div className="mt-1 text-[10px] font-medium leading-4 text-rose-200">
                  {popError}
                </div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            {agents.map((agent) => (
              <AgentChip
                key={agent.name}
                agent={agent}
                assignedTo={agentAssignments[agent.name]}
                picked={draggedAgent === agent.name}
                onPick={setDraggedAgent}
                onRemove={removeLobster}
              />
            ))}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
            <div className="mb-1.5 text-[11px] font-bold uppercase leading-4 text-white/40">
              Workspaces
            </div>
            <div className="space-y-1.5">
              {status ? (
                sandboxes.map((sandbox) => (
                  <SandboxCard
                    key={sandbox.name}
                    sandbox={sandbox}
                    active={selectedSandbox === sandbox.name}
                    carriedAgent={draggedAgent}
                    onSelect={() => setSelectedSandbox(sandbox.name)}
                    onDropAgent={handleDropAgent}
                    onRemoveAgent={handleRemoveAgent}
                    onCarryAgent={setDraggedAgent}
                    onOpenMonitor={onOpenMonitor}
                  />
                ))
              ) : (
                <div className="rounded-md border border-white/10 bg-white/[0.045] p-3 text-[11px] font-medium leading-4 text-white/45">
                  <div>
                    {notice ? `Could not load live workspaces: ${notice}` : "Loading live workspaces..."}
                  </div>
                  {notice && (
                    <button
                      type="button"
                      onClick={load}
                      disabled={busy}
                      className="mt-2 h-7 rounded bg-white/[0.08] px-2 text-[10px] font-semibold text-white/62 hover:bg-white/[0.13] hover:text-white disabled:opacity-40"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 min-w-0 shrink-0 rounded-lg border border-white/12 bg-white/[0.05] px-3 py-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="min-w-0 truncate text-[13px] font-semibold leading-5 text-white/88">
                {selected ? sandboxLabel(selected) : "Select a sandbox"}
              </div>
              {selected && onOpenMonitor && (
                <button
                  type="button"
                  onClick={() => onOpenMonitor(selected.name)}
                  className="shrink-0 rounded-md bg-cyan-300/16 px-2.5 py-1 text-[10px] font-bold uppercase leading-3 text-cyan-100 hover:bg-cyan-300/26"
                  title="Open the full Task Monitor overlay"
                >
                  Open Monitor
                </button>
              )}
            </div>
            <textarea
              value={task}
              onChange={(event) => setTask(event.target.value)}
              rows={5}
              className="min-h-[110px] w-full min-w-0 resize-none rounded-md border border-white/12 bg-slate-950/40 px-3 py-2.5 text-[13px] leading-5 text-white/86 outline-none transition placeholder:text-white/30 focus:border-cyan-200/40"
              placeholder="Assign a task to this sandbox team..."
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={
                  !selected ||
                  !task.trim() ||
                  busy ||
                  !selectedSandboxLive ||
                  selectedRunActive ||
                  (selected.assigned_agents?.length ?? 0) === 0
                }
                onClick={handleRunTask}
                className="h-8 shrink-0 rounded-md bg-cyan-200 px-3 text-[11px] font-bold text-slate-950 transition hover:bg-cyan-100 disabled:bg-white/12 disabled:text-white/30"
              >
                {busy ? "Starting..." : selectedRunActive ? "Running" : "Run Team"}
              </button>
              {selectedRunActive && (
                <button
                  type="button"
                  disabled={selectedRunStatus?.status === "stopping"}
                  onClick={handleStopTask}
                  className="h-8 shrink-0 rounded-md border border-white/14 bg-white/[0.07] px-3 text-[11px] font-bold text-white/70 transition hover:bg-white/[0.12] hover:text-white disabled:opacity-45"
                  title="Request a graceful stop for this sandbox run"
                >
                  {selectedRunStatus?.status === "stopping" ? "Stopping" : "Stop"}
                </button>
              )}
              <span className="min-w-0 truncate text-[10px] font-medium leading-4 text-white/38">
                {selected
                  ? selectedSandboxLive
                    ? `${selected.assigned_agents.length} assigned`
                    : "Sandbox not live"
                  : "No sandbox selected"}
              </span>
            </div>
            {selectedRunStatus && (
              <div className="mt-2 min-w-0 rounded border border-cyan-200/18 bg-cyan-200/[0.08] px-2 py-1.5">
                <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold leading-4 text-cyan-50">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      selectedRunStatus.status === "cancelled"
                        ? "bg-amber-200"
                        : selectedRunStatus.status === "finished"
                        ? "bg-emerald-200"
                        : selectedRunStatus.status === "error"
                        ? "bg-rose-200"
                        : "bg-cyan-200"
                    }`}
                  />
                  <span className="truncate">{selectedRunStatus.message}</span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[9px] leading-3 text-white/34">
                  {selectedRunStatus.runId}
                </div>
              </div>
            )}
            {notice && (
              <div className="mt-2 max-h-16 overflow-y-auto whitespace-pre-wrap text-[10px] font-medium leading-4 text-white/48">
                {notice}
              </div>
            )}
          </div>
        </div>
      </div>

      {selected && (
        <div className="mt-3 shrink-0 space-y-3">
          {/* Status — full-width, readable */}
          <div className="rounded-lg border border-white/12 bg-white/[0.04] px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-bold uppercase leading-4 tracking-wide text-white/45">
                Status
              </div>
              <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase text-white/72">
                {selectedRunStatus ? selectedRunStatus.status : selected.live ? "idle" : "not live"}
              </span>
            </div>
            <div className="mt-1.5 text-[13px] leading-5 text-white/80">
              {selectedRunStatus?.message
                || (selectedRunStatus
                  ? `Run ${selectedRunStatus.status}`
                  : selected.assigned_agents.length === 0
                    ? "Drop lobsters in to build a sandbox team."
                    : "Idle — click Run Team, or open the Task Monitor for live details.")}
            </div>
            <div className="mt-2 flex gap-2">
              <div className="flex-1 rounded-md bg-white/[0.05] px-3 py-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-white/38">
                  Ask
                </div>
                <div className="mt-0.5 truncate text-[12px] font-semibold text-white/82">
                  {approvalSummary.ask}
                </div>
              </div>
              <div className="flex-1 rounded-md bg-white/[0.05] px-3 py-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-white/38">
                  Security
                </div>
                <div className="mt-0.5 truncate text-[12px] font-semibold text-white/82">
                  {approvalSummary.security}
                </div>
              </div>
            </div>
          </div>

          {/* Live Policies — read-only summary chips. Toggling moved to the
              Task Monitor overlay where there's room to preview safely. */}
          <div className="rounded-lg border border-white/12 bg-white/[0.04] px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-bold uppercase leading-4 tracking-wide text-white/45">
                Live Policies
              </div>
              {onOpenMonitor && (
                <button
                  type="button"
                  onClick={() => onOpenMonitor(selected.name)}
                  className="rounded-md bg-cyan-300/16 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-cyan-100 hover:bg-cyan-300/28"
                  title="Manage policies + watch the run in the floating Task Monitor"
                >
                  Open Task Monitor
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(policies?.policies ?? []).filter((p) => p.enabled).length === 0 ? (
                <span className="text-[12px] text-white/55">
                  No policies enabled.
                </span>
              ) : (
                (policies?.policies ?? [])
                  .filter((p) => p.enabled)
                  .map((p) => (
                    <span
                      key={p.name}
                      title={p.description}
                      className="rounded-full bg-emerald-300/14 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-100"
                    >
                      {p.name}
                    </span>
                  ))
              )}
            </div>
            {(policies?.policies ?? []).some((p) => !p.enabled) && (
              <div className="mt-1.5 text-[11px] leading-4 text-white/45">
                {(policies?.policies ?? []).filter((p) => !p.enabled).length} more available — toggle in the Task Monitor.
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
