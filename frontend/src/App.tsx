import React, { useCallback, useMemo, useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useOfficeState, type SidebarTab } from "./hooks/useOfficeState";
import OfficeCanvas from "./components/OfficeCanvas";
import ChatPanel from "./components/ChatPanel";
import ActivityPanel from "./components/ActivityPanel";
import BulletinBoard from "./components/BulletinBoard";
import Whiteboard from "./components/Whiteboard";
import QueryInput from "./components/QueryInput";
import AgentDetail from "./components/AgentDetail";
import WorkflowPipeline from "./components/WorkflowPipeline";
import WelcomeOverlay from "./components/WelcomeOverlay";
import WaterCoolerControls from "./components/WaterCoolerControls";
import HistoryPanel from "./components/HistoryPanel";
import { AGENT_COLORS } from "./utils/sprites";

const TABS: { id: SidebarTab; label: string; icon: string }[] = [
  { id: "chat", label: "Chat", icon: ">" },
  { id: "whiteboard", label: "Answer", icon: "!" },
  { id: "activity", label: "Activity", icon: "~" },
  { id: "history", label: "History", icon: "#" },
];

function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`w-2 h-2 rounded-full ${
          connected ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]" : "bg-red-500"
        }`}
      />
      <span className="text-[10px] text-gray-600">
        {connected ? "Live" : "Reconnecting..."}
      </span>
    </div>
  );
}

function AgentTicker({ agents }: { agents: { name: string; state: string }[] }) {
  const activeAgents = agents.filter((a) => a.state !== "idle");

  const stateLabels: Record<string, string> = {
    researching: "searching",
    collaborating: "discussing",
    presenting: "writing",
    coding: "coding",
    thinking: "thinking",
    walking: "moving",
  };

  if (activeAgents.length === 0) {
    return (
      <div className="flex items-center gap-1">
        {agents.map((a) => (
          <div
            key={a.name}
            className="w-1.5 h-1.5 rounded-full opacity-30"
            title={`${a.name}: idle`}
            style={{ backgroundColor: AGENT_COLORS[a.name] ?? "#999" }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 overflow-hidden">
      {activeAgents.slice(0, 4).map((a) => (
        <div
          key={a.name}
          className="flex items-center gap-1 shrink-0"
        >
          <div
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: AGENT_COLORS[a.name] ?? "#999" }}
          />
          <span className="text-[10px] text-gray-600">
            <span className="font-medium" style={{ color: AGENT_COLORS[a.name] ?? "#999" }}>
              {a.name}
            </span>
            {" "}
            {stateLabels[a.state] ?? a.state}
          </span>
        </div>
      ))}
      {activeAgents.length > 4 && (
        <span className="text-[10px] text-gray-400">+{activeAgents.length - 4}</span>
      )}
    </div>
  );
}

export default function App() {
  const { connected, officeState, sendQuery, resetOffice, setWaterCooler } = useWebSocket();
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
      officeState.messages.map((m) => ({
        agent: m.agent,
        target: m.target,
        message: m.message,
        type: m.type,
      })),
    [officeState.messages]
  );

  return (
    <div className={`h-screen flex flex-col bg-[#f5f3ef] text-gray-800 overflow-hidden ${presentationMode ? "presentation-mode" : ""}`}>
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide text-gray-700">
            <span className="text-[#e94560]">Office</span> Agents
          </h1>
          <div className="flex items-center gap-1.5 bg-gray-900 text-gray-300 px-2.5 py-1 rounded text-[9px] font-mono">
            <span className="text-green-400">*</span>
            <span>NVIDIA DGX Spark</span>
            <span className="text-gray-600">|</span>
            <span>Qwen 3.5 35B</span>
            <span className="text-gray-600">|</span>
            <span className="text-green-400">0 bytes uploaded</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <AgentTicker agents={officeState.agents} />
          <div className="w-px h-4 bg-gray-200" />
          <div className="relative">
            <WaterCoolerControls onSetWaterCooler={setWaterCooler} />
          </div>
          <button
            onClick={togglePresentation}
            className="px-2 py-1 text-[10px] font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
            title={presentationMode ? "Exit presentation mode" : "Enter presentation mode"}
          >
            {presentationMode ? "Exit" : "Present"}
          </button>
          <button
            onClick={resetOffice}
            className="px-2.5 py-1 text-[10px] font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
            title="Send everyone back to their desks and clear chat"
          >
            Reset
          </button>
          <ConnectionDot connected={connected} />
        </div>
      </header>

      {/* Workflow Progress Pipeline */}
      <WorkflowPipeline phase={workflowPhase} />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Office Canvas - left side */}
        <div className="flex-1 min-w-0 relative">
          <OfficeCanvas
            agents={officeState.agents}
            selectedAgent={selectedAgent}
            onSelectAgent={selectAgent}
            messages={recentSpeakMessages}
            hasActiveQuery={!!officeState.current_query}
          />
          <WelcomeOverlay
            visible={
              !officeState.current_query &&
              officeState.messages.length === 0 &&
              officeState.whiteboard.length === 0
            }
          />
        </div>

        {/* Sidebar - right side */}
        <div className={`border-l border-gray-200 flex flex-col bg-white shrink-0 ${presentationMode ? "w-[480px]" : "w-96"}`}>
          {/* Tab switcher / Agent detail header */}
          {selectedAgentInfo ? (
            <AgentDetail
              agent={selectedAgentInfo}
              thoughts={selectedAgentThoughts}
              recentMessages={selectedAgentMessages}
              onClose={() => selectAgent(null)}
            />
          ) : (
            <>
              {/* Tabs */}
              <div className="flex border-b border-gray-200 shrink-0 bg-gray-50/50">
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
                      className={`flex-1 px-2 py-2.5 text-[11px] font-semibold tracking-wide transition-all ${
                        isActive
                          ? "text-[#e94560] border-b-2 border-[#e94560] bg-white"
                          : "text-gray-400 hover:text-gray-600 border-b-2 border-transparent"
                      }`}
                    >
                      <span className={`mr-1 text-[9px] ${isActive ? "opacity-100" : "opacity-40"}`}>{tab.icon}</span>
                      {tab.label}
                      {count > 0 && (
                        <span className={`ml-1.5 text-[9px] px-1 rounded-full ${
                          isWhiteboard
                            ? "text-white bg-[#e94560] animate-pulse"
                            : "text-gray-500 bg-gray-200/80"
                        }`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-hidden">
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
            </>
          )}
        </div>
      </div>

      {/* Query input - bottom */}
      <QueryInput
        onSubmit={sendQuery}
        currentQuery={officeState.current_query}
        connected={connected}
      />
    </div>
  );
}
