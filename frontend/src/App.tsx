import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useOfficeState, type SidebarTab } from "./hooks/useOfficeState";
import ThreeUnderwaterMap from "./components/ThreeUnderwaterMap";
import HealthBanner from "./components/HealthBanner";
import ChatPanel from "./components/ChatPanel";
import ActivityPanel from "./components/ActivityPanel";
import BulletinBoard from "./components/BulletinBoard";
import Whiteboard from "./components/Whiteboard";
import QueryInput from "./components/QueryInput";
import LobsterDetailModal from "./components/LobsterDetailModal";
import LobsterBuilder from "./components/LobsterBuilder";
import ModelSelector from "./components/ModelSelector";
import DemoReadinessPanel from "./components/DemoReadinessPanel";
import WaterCoolerControls from "./components/WaterCoolerControls";
import HistoryPanel from "./components/HistoryPanel";
import SandboxOrchestrator from "./components/SandboxOrchestrator";
import SandboxRunPanel from "./components/SandboxRunPanel";
import ErrorBoundary from "./components/ErrorBoundary";
import type { ChatMessage, NemoClawSandbox } from "./types";
import { withoutLandOfficeIdleMessages } from "./utils/messageFilters";
import { fetchSandboxes } from "./utils/sandboxApi";

const TABS: { id: SidebarTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "whiteboard", label: "Answer" },
  { id: "activity", label: "Activity" },
  { id: "history", label: "History" },
];

function TeamSummary({ agents }: { agents: { name: string; state: string }[] }) {
  const activeAgents = agents.filter((a) => a.state !== "idle");
  const label = activeAgents.length === 0
    ? `${agents.length} ready`
    : `${activeAgents.length} active`;

  const dots = activeAgents.length === 0 ? agents.slice(0, 7) : activeAgents.slice(0, 7);

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 rounded-2xl border border-white/24 bg-[#1c5f72]/72 px-4 text-[12px] font-semibold text-white/92 shadow-[0_14px_34px_rgba(3,26,36,0.24)] ring-1 ring-cyan-50/14 backdrop-blur-xl">
      <span className="shrink-0 leading-none">{label}</span>
      <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
        {dots.map((a) => (
          <span
            key={a.name}
            className={`h-1.5 w-1.5 rounded-full ${activeAgents.length === 0 ? "bg-white/28" : "bg-emerald-200/80"}`}
          />
        ))}
      </span>
      {activeAgents.length > 7 && (
        <span className="shrink-0 text-white/42">+{activeAgents.length - 7}</span>
      )}
    </div>
  );
}

function ActiveStatus({ agents }: { agents: { state: string }[] }) {
  const activeCount = agents.filter((a) => a.state !== "idle").length;

  if (activeCount === 0) {
    return (
      <div className="hidden h-10 shrink-0 items-center rounded-2xl border border-white/24 bg-[#1c5f72]/72 px-4 text-[12px] font-semibold leading-none text-white/88 shadow-[0_14px_34px_rgba(3,26,36,0.24)] ring-1 ring-cyan-50/14 backdrop-blur-xl sm:flex">
        Idle chat
      </div>
    );
  }

  return (
    <div className="hidden h-10 shrink-0 items-center rounded-2xl border border-white/24 bg-[#1c5f72]/78 px-4 text-[12px] font-semibold leading-none text-white shadow-[0_14px_34px_rgba(3,26,36,0.24)] ring-1 ring-cyan-50/14 backdrop-blur-xl sm:flex">
      {activeCount} moving
    </div>
  );
}

function HeaderButton({
  children,
  onClick,
  title,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-10 shrink-0 rounded-2xl border border-white/24 bg-[#1c5f72]/72 px-4 text-[12px] font-semibold leading-none text-white/92 shadow-[0_14px_34px_rgba(3,26,36,0.24)] ring-1 ring-cyan-50/14 backdrop-blur-xl transition hover:bg-[#287486]/82 hover:text-white ${className}`}
      title={title}
    >
      {children}
    </button>
  );
}

function HeaderStatus({ connected }: { connected: boolean }) {
  return (
    <div
      className={`flex h-10 shrink-0 items-center rounded-2xl border px-4 text-[12px] font-semibold leading-none shadow-[0_14px_34px_rgba(3,26,36,0.24)] ring-1 backdrop-blur-xl ${
        connected
          ? "border-white/26 bg-[#1c5f72]/76 text-white ring-cyan-50/16"
          : "border-rose-100/24 bg-rose-300/18 text-rose-50 ring-rose-200/20"
      }`}
    >
      {connected ? "Live" : "Offline"}
    </div>
  );
}

function HeaderPhase({ phase }: { phase: string }) {
  const label = phase === "idle" ? "Idle" : phase[0].toUpperCase() + phase.slice(1);

  return (
    <div className="hidden h-10 shrink-0 items-center rounded-2xl border border-white/24 bg-[#1c5f72]/72 px-4 text-[12px] font-semibold leading-none text-white/88 shadow-[0_14px_34px_rgba(3,26,36,0.24)] ring-1 ring-cyan-50/14 backdrop-blur-xl sm:flex">
      {label}
    </div>
  );
}

function HeaderCluster({
  connected,
  workflowPhase,
  agents,
  onSetWaterCooler,
  onTogglePresentation,
  presentationMode,
  onReset,
  onOpenLobsterBuilder,
  onOpenModelMenu,
  onOpenReadiness,
  activeModel,
}: {
  connected: boolean;
  workflowPhase: string;
  agents: { name: string; state: string }[];
  onSetWaterCooler: (opts: { enabled?: boolean; topic?: string | null }) => void;
  onTogglePresentation: () => void;
  presentationMode: boolean;
  onReset: () => void;
  onOpenLobsterBuilder: () => void;
  onOpenModelMenu: () => void;
  onOpenReadiness: () => void;
  activeModel: { label: string; kind: string } | null;
}) {
  return (
    <div className="pointer-events-auto flex max-w-[min(960px,calc(100vw-220px))] shrink flex-wrap items-start justify-end gap-2.5 max-md:max-w-[calc(100vw-1.5rem)]">
      {workflowPhase !== "idle" && <HeaderPhase phase={workflowPhase} />}
      <TeamSummary agents={agents} />
      <ActiveStatus agents={agents} />
      <div className="relative hidden shrink-0 sm:block">
        <WaterCoolerControls onSetWaterCooler={onSetWaterCooler} />
      </div>
      <button
        type="button"
        onClick={onOpenModelMenu}
        className="hidden h-10 shrink-0 items-center gap-2 rounded-2xl border border-white/24 bg-[#1c5f72]/72 px-4 text-[12px] font-semibold text-white/92 shadow-[0_14px_34px_rgba(3,26,36,0.24)] ring-1 ring-cyan-50/14 backdrop-blur-xl hover:bg-[#287486]/82 hover:text-white sm:flex"
        title="Switch the LLM backend that drives the agents"
      >
        <span className="text-[10px] uppercase tracking-wider text-white/45">Model</span>
        <span className="max-w-[180px] truncate">Model Endpoints</span>
      </button>
      <HeaderButton
        onClick={onOpenReadiness}
        title="Check demo readiness across backend, sandboxes, policies, and runtime"
        className="hidden md:block"
      >
        Demo Ready
      </HeaderButton>
      <HeaderButton
        onClick={onOpenLobsterBuilder}
        title="Build a Claw — spawn a new OpenClaw lobster profile"
        className=""
      >
        🦞 Build a Claw
      </HeaderButton>
      <HeaderButton
        onClick={onTogglePresentation}
        title={presentationMode ? "Exit presentation mode" : "Enter presentation mode"}
        className="hidden lg:block"
      >
        {presentationMode ? "Exit" : "Present"}
      </HeaderButton>
      <HeaderButton
        onClick={onReset}
        title="Clear sandbox teams, send everyone to the reef commons, and clear chat"
        className="hidden sm:block"
      >
        Reset
      </HeaderButton>
      <HeaderStatus connected={connected} />
    </div>
  );
}

export default function App() {
  const {
    connected,
    officeState,
    sendQuery,
    resetOffice,
    setWaterCooler,
    refreshOfficeState,
    applySandboxAssignments,
  } = useWebSocket();
  const {
    selectedAgent,
    selectAgent,
    activeTab,
    setActiveTab,
    agentFilter,
    setAgentFilter,
    filteredMessages,
    filteredActivity,
    getAgentMessages,
    getAgentThoughts,
    getAgent,
    sortedBulletin,
    workflowPhase,
  } = useOfficeState(officeState);

  const [presentationMode, setPresentationMode] = useState(false);
  const [commsDockOpen, setCommsDockOpen] = useState(false);
  const [sandboxDockOpen, setSandboxDockOpen] = useState(false);
  // "Build a Claw" modal — state lifted to App level so it can be opened from
  // both the sandbox dock's "+ New" button and the top-level header button.
  const [builderOpen, setBuilderOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  // Active model name surfaced in the header pill so the user knows what's
  // driving the agents without opening the modal.
  const [activeModel, setActiveModel] = useState<{ label: string; kind: string } | null>(null);
  const refreshActiveModel = useCallback(async () => {
    try {
      const r = await fetch("/models", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as {
        active_id: string;
        profiles: { id: string; label: string; kind: string }[];
      };
      const p = j.profiles.find((x) => x.id === j.active_id);
      if (p) setActiveModel({ label: p.label, kind: p.kind });
    } catch {
      // best-effort — leave previous label up if /models fails momentarily
    }
  }, []);
  useEffect(() => {
    refreshActiveModel();
  }, [refreshActiveModel]);
  const [sandboxNotice, setSandboxNotice] = useState<string | null>(null);
  // Which sandbox is open in the floating Task Monitor (null = closed).
  const [openSandboxName, setOpenSandboxName] = useState<string | null>(null);
  // Latest /sandboxes payload, lifted up so both the Orchestrator dock and the
  // floating monitor can read the same source of truth.
  const [sandboxesIndex, setSandboxesIndex] = useState<NemoClawSandbox[]>([]);
  const refreshSandboxesIndex = useCallback(async () => {
    try {
      const next = await fetchSandboxes();
      setSandboxesIndex(next.sandboxes ?? []);
      return next;
    } catch (err) {
      setSandboxNotice(err instanceof Error ? err.message : "Could not load sandboxes");
      return null;
    }
  }, []);
  const refreshSandboxSurfaces = useCallback(async () => {
    await Promise.all([refreshOfficeState(), refreshSandboxesIndex()]);
  }, [refreshOfficeState, refreshSandboxesIndex]);

  useEffect(() => {
    refreshSandboxesIndex();
  }, [refreshSandboxesIndex]);

  useEffect(() => {
    if (!openSandboxName) return;
    refreshSandboxesIndex();
    const id = window.setInterval(refreshSandboxesIndex, 5000);
    return () => window.clearInterval(id);
  }, [openSandboxName, refreshSandboxesIndex]);

  useEffect(() => {
    if (!sandboxesIndex.some((sandbox) => sandbox.configured && !sandbox.live)) return;
    const id = window.setInterval(refreshSandboxesIndex, 5000);
    return () => window.clearInterval(id);
  }, [refreshSandboxesIndex, sandboxesIndex]);

  useEffect(() => {
    if (!sandboxNotice) return;
    const id = window.setTimeout(() => setSandboxNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [sandboxNotice]);

  const togglePresentation = useCallback(() => {
    setPresentationMode((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
      return next;
    });
  }, []);

  const selectedAgentInfo = selectedAgent ? getAgent(selectedAgent) : null;
  const selectedAgentThoughts = selectedAgent
    ? getAgentThoughts(selectedAgent)
    : [];
  const selectedAgentMessages = selectedAgent
    ? getAgentMessages(selectedAgent)
    : [];

  // For the canvas speech bubbles - pass all recent "speak" messages
  const recentSpeakMessages = useMemo(
    () =>
      withoutLandOfficeIdleMessages(officeState.messages).map((m) => ({
          id: m.id,
          agent: m.agent,
          target: m.target,
          message: m.message,
          type: m.type,
          timestamp: m.timestamp,
        })),
    [officeState.messages]
  );
  const sandboxBusyCount = officeState.agents.filter(
    (agent) => agent.state === "coding" && Boolean(agent.sandbox_name)
  ).length;
  const sandboxSceneKey = useMemo(
    () => sandboxesIndex.map((sandbox) => `${sandbox.name}:${sandbox.home_room}:${sandbox.display_name ?? ""}`).join("|"),
    [sandboxesIndex],
  );
  const readinessSandboxName = useMemo(
    () =>
      openSandboxName
      ?? sandboxesIndex.find((sandbox) => sandbox.isDefault)?.name
      ?? sandboxesIndex[0]?.name
      ?? null,
    [openSandboxName, sandboxesIndex],
  );

  const assignAgentToSandbox = useCallback(
    async (agentName: string, sandboxName: string) => {
      try {
        const statusRes = await fetch("/sandboxes", { cache: "no-store" });
        if (!statusRes.ok) throw new Error(`Could not load sandboxes (${statusRes.status})`);
        const status = await statusRes.json();
        const sandbox = status.sandboxes?.find((item: { name?: string }) => item.name === sandboxName);
        const existing = Array.isArray(sandbox?.assigned_agents) ? sandbox.assigned_agents : [];
        const nextTeam = Array.from(new Set([...existing, agentName]));

        const assignRes = await fetch(`/sandboxes/${encodeURIComponent(sandboxName)}/team`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_names: nextTeam }),
        });
        if (!assignRes.ok) throw new Error(`Could not assign ${agentName} (${assignRes.status})`);
        const result = await assignRes.json();
        applySandboxAssignments(result.assignments ?? { [sandboxName]: nextTeam });
        await refreshOfficeState();
        setSandboxDockOpen(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not assign lobster to sandbox";
        console.warn("[sandbox] map assignment failed", err);
        setSandboxNotice(message);
      }
    },
    [applySandboxAssignments, refreshOfficeState]
  );

  return (
    <div className={`h-screen overflow-hidden bg-[#07333c] text-slate-900 ${presentationMode ? "presentation-mode" : ""}`}>
      <div className="absolute inset-0">
        <ErrorBoundary label="Scene">
          <ThreeUnderwaterMap
            key={sandboxSceneKey}
            agents={officeState.agents}
            sandboxes={sandboxesIndex}
            selectedAgent={selectedAgent}
            onSelectAgent={selectAgent}
            onAssignAgentToSandbox={assignAgentToSandbox}
            onOpenSandbox={setOpenSandboxName}
            messages={recentSpeakMessages}
            hasActiveQuery={!!officeState.current_query}
          />
        </ErrorBoundary>
      </div>

      <header className="pointer-events-none absolute left-5 right-5 top-5 z-20 flex items-start justify-between gap-3 max-md:left-3 max-md:right-3 max-md:top-3">
        <div className="pointer-events-auto w-[390px] rounded-2xl border border-white/24 bg-[#1c5f72]/72 p-0 text-white shadow-[0_18px_60px_rgba(4,22,31,0.24)] ring-1 ring-cyan-50/14 backdrop-blur-md max-sm:hidden">
          <div className="min-w-0 px-7 py-4">
            <h1 className="whitespace-nowrap text-[18px] font-semibold leading-6 [text-shadow:_0_1px_14px_rgba(255,255,255,0.14)]">
              NemoClaw Reef
            </h1>
            <p className="mt-1 whitespace-nowrap text-[12px] font-medium leading-5 text-white/78 max-sm:hidden">OpenClaw profiles in shared sandboxes</p>
          </div>
        </div>
        <HeaderCluster
          connected={connected}
          workflowPhase={workflowPhase}
          agents={officeState.agents}
          onSetWaterCooler={setWaterCooler}
          onTogglePresentation={togglePresentation}
          presentationMode={presentationMode}
          onReset={resetOffice}
          onOpenLobsterBuilder={() => setBuilderOpen(true)}
          onOpenModelMenu={() => setModelMenuOpen(true)}
          onOpenReadiness={() => setReadinessOpen(true)}
          activeModel={activeModel}
        />
      </header>

      <HealthBanner />

      {sandboxNotice && (
        <div
          role="status"
          className="pointer-events-auto absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-md border border-rose-300/30 bg-rose-500/20 px-4 py-2 text-[12px] font-semibold text-rose-50 shadow-[0_18px_60px_rgba(4,22,31,0.32)] backdrop-blur-md"
        >
          {sandboxNotice}
        </div>
      )}

      <section
        className={`pointer-events-auto absolute z-20 flex overflow-hidden rounded-2xl border border-white/24 bg-[#1c5f72]/72 shadow-[0_24px_80px_rgba(4,22,31,0.24)] ring-1 ring-cyan-50/14 backdrop-blur-md transition-[width,height,max-height,opacity,transform] duration-300 ease-out max-md:top-auto ${
          commsDockOpen
            ? `p-2 opacity-100 ${presentationMode ? "right-10 bottom-32 h-[56vh] max-h-[620px] w-[620px]" : "right-10 bottom-32 h-[390px] w-[620px]"} max-md:left-3 max-md:right-3 max-md:bottom-28 max-md:h-[40vh] max-md:!w-auto`
            : "right-10 bottom-32 h-14 w-[218px] p-0 opacity-95 hover:opacity-100 max-md:right-3 max-md:bottom-28"
        }`}
      >
        {!commsDockOpen ? (
          <button
            type="button"
            onClick={() => setCommsDockOpen(true)}
            className="flex h-full w-full items-center justify-between gap-3.5 px-4 text-left text-white"
            title="Open comms"
            aria-label="Open comms"
          >
            <span className="min-w-0">
              <span className="block truncate text-[10.5px] font-bold uppercase leading-4 text-white/58">
                Dock
              </span>
              <span className="block truncate text-[13px] font-semibold leading-5 text-white/95">
                Comms Stream
              </span>
            </span>
            <span className="grid h-8 shrink-0 place-items-center rounded-lg bg-white/16 px-2.5 text-[10.5px] font-bold leading-none text-white ring-1 ring-white/14">
              Open
            </span>
          </button>
        ) : (
          <>
            <div className="flex min-h-0 flex-1">
              <nav className="flex w-[108px] shrink-0 flex-col border-r border-white/10 bg-slate-950/18 pr-2">
                <div className="mb-1 flex items-center justify-between gap-2 px-2 pt-1.5 text-[10px] font-bold uppercase leading-5 text-white/35">
                  <span>Dock</span>
                  <button
                    type="button"
                    onClick={() => setCommsDockOpen(false)}
                    className="grid h-6 w-6 place-items-center rounded-md bg-white/[0.08] text-sm font-semibold leading-none text-white/50 transition hover:bg-white/[0.13] hover:text-white"
                    title="Collapse comms"
                    aria-label="Collapse comms"
                  >
                    -
                  </button>
                </div>
                {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                const count =
                  tab.id === "chat" ? filteredMessages.length :
                  tab.id === "activity" ? filteredActivity.length :
                  tab.id === "whiteboard" ? officeState.whiteboard.length :
                  0;
                const isWhiteboard = tab.id === "whiteboard" && count > 0;

                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex h-9 items-center justify-between gap-2 border-l-2 px-2 py-0 text-left text-[12px] font-semibold leading-4 transition-all ${
                      isActive
                        ? "border-cyan-300 bg-white/[0.09] text-white"
                        : "border-transparent text-white/54 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <span className="truncate">{tab.label}</span>
                    {count > 0 && (
                      <span className={`inline-grid h-5 min-w-5 shrink-0 place-items-center rounded px-1 text-[10px] font-bold leading-none ${
                        isWhiteboard
                          ? "bg-rose-500 text-white"
                          : isActive
                            ? "bg-cyan-300/18 text-cyan-100"
                            : "bg-white/12 text-white/62"
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
              </nav>

              <div className="min-h-0 flex-1 overflow-hidden pl-2">
                {activeTab === "chat" && (
                  <ChatPanel
                    messages={filteredMessages}
                    agentFilter={agentFilter}
                    onFilterChange={setAgentFilter}
                    thinkingAgents={officeState.thinking_agents}
                  />
                )}
                {activeTab === "activity" && (
                  <ActivityPanel
                    activity={filteredActivity}
                    agentFilter={agentFilter}
                    onFilterChange={setAgentFilter}
                  />
                )}
                {activeTab === "board" && (
                  <BulletinBoard posts={sortedBulletin} />
                )}
                {activeTab === "history" && (
                  <HistoryPanel />
                )}
                {activeTab === "whiteboard" && (
                  <Whiteboard entries={officeState.whiteboard} />
                )}
              </div>
            </div>
          </>
        )}
      </section>

      <div
        className={`absolute left-10 z-20 max-lg:hidden overflow-hidden rounded-lg transition-all duration-300 ease-out ${
          sandboxDockOpen
            ? "top-24 bottom-32 w-[min(46vw,820px)] opacity-100"
            : "bottom-32 h-14 w-[220px] opacity-95 hover:opacity-100"
        }`}
      >
        {sandboxDockOpen ? (
          <ErrorBoundary label="Sandbox Dock">
            <SandboxOrchestrator
              agents={officeState.agents}
              messages={officeState.messages}
              onCollapse={() => setSandboxDockOpen(false)}
              onStateRefresh={refreshOfficeState}
              onSandboxAssignments={applySandboxAssignments}
              onOpenMonitor={setOpenSandboxName}
              onSandboxesChange={setSandboxesIndex}
              onOpenLobsterBuilder={() => setBuilderOpen(true)}
            />
          </ErrorBoundary>
        ) : (
          <button
            type="button"
            onClick={() => setSandboxDockOpen(true)}
            className="pointer-events-auto flex h-full w-full items-center justify-between gap-3.5 rounded-2xl border border-white/24 bg-[#1c5f72]/72 px-4 text-left text-white shadow-[0_24px_80px_rgba(4,22,31,0.24)] ring-1 ring-cyan-50/14 backdrop-blur-md"
            title="Open sandboxes"
            aria-label="Open sandboxes"
          >
            <span className="min-w-0">
              <span className="block truncate text-[10.5px] font-bold uppercase leading-4 text-white/58">
                NemoClaw
              </span>
              <span className="block truncate text-[13px] font-semibold leading-5 text-white/95">
                Sandboxes
              </span>
            </span>
            <span className="grid h-8 shrink-0 place-items-center rounded-lg bg-white/16 px-2.5 text-[10.5px] font-bold leading-none text-white ring-1 ring-white/14">
              Open
            </span>
          </button>
        )}
      </div>

      <div className="absolute bottom-5 left-1/2 z-20 w-[min(760px,calc(100vw-2.5rem))] -translate-x-1/2 max-md:bottom-3 max-md:w-[calc(100vw-1.5rem)]">
        <QueryInput
          onSubmit={sendQuery}
          currentQuery={officeState.current_query}
          connected={connected}
          sandboxBusyCount={sandboxBusyCount}
        />
      </div>

      {openSandboxName && (() => {
        const sandbox = sandboxesIndex.find((s) => s.name === openSandboxName);
        if (!sandbox) return null;
        const messages: ChatMessage[] = officeState.messages.filter(
          (m) => m.sandbox_name === openSandboxName
        );
        const consoleLines = officeState.sandbox_consoles[openSandboxName] ?? [];
        return (
          <ErrorBoundary label="Task Monitor">
            <SandboxRunPanel
              sandbox={sandbox}
              messages={messages}
              consoleLines={consoleLines}
              onClose={() => setOpenSandboxName(null)}
              onAfterChange={refreshSandboxSurfaces}
              onLocalRename={(name, displayName) =>
                setSandboxesIndex((prev) =>
                  prev.map((s) =>
                    s.name === name ? { ...s, display_name: displayName } : s
                  )
                )
              }
            />
          </ErrorBoundary>
        );
      })()}

      {selectedAgentInfo && (
        <ErrorBoundary label="Lobster Detail">
          <LobsterDetailModal
            agent={selectedAgentInfo}
            thoughts={selectedAgentThoughts}
            recentMessages={selectedAgentMessages}
            onClose={() => selectAgent(null)}
          />
        </ErrorBoundary>
      )}

      <ErrorBoundary label="Lobster Builder">
        <LobsterBuilder
          open={builderOpen}
          onClose={() => setBuilderOpen(false)}
          onSpawned={refreshOfficeState}
        />
      </ErrorBoundary>

      <ErrorBoundary label="Model Selector">
        <ModelSelector
          open={modelMenuOpen}
          onClose={() => setModelMenuOpen(false)}
          onActiveChanged={refreshActiveModel}
        />
      </ErrorBoundary>

      <ErrorBoundary label="Demo Readiness">
        <DemoReadinessPanel
          open={readinessOpen}
          sandboxName={readinessSandboxName}
          onClose={() => setReadinessOpen(false)}
        />
      </ErrorBoundary>
    </div>
  );
}
