import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OfficeState, ChatMessage, ActivityEntry } from "../types";

export type SidebarTab = "chat" | "activity" | "board" | "whiteboard" | "history";

export type WorkflowPhase = "idle" | "gathering" | "researching" | "analyzing" | "writing" | "done";

function deriveWorkflowPhase(officeState: OfficeState): WorkflowPhase {
  if (!officeState.current_query) {
    // Check if whiteboard was recently written (within the last few seconds)
    if (officeState.whiteboard.length > 0) {
      const lastEntry = officeState.whiteboard[officeState.whiteboard.length - 1];
      const age = Date.now() - new Date(lastEntry.timestamp).getTime();
      if (age < 15000) return "done";
    }
    return "idle";
  }

  const agentStates = officeState.agents.map((a) => a.state);
  const agentLocations = officeState.agents.map((a) => a.location);

  // If agents are moving to war room
  const inWarRoom = agentLocations.filter((l) => l === "war_room").length;
  if (inWarRoom < 3) return "gathering";

  // Check activity for recent research
  const recentActivity = officeState.activity.slice(-10);
  const hasResearch = recentActivity.some((a) => a.action === "research");
  const hasThinking = agentStates.some((s) => s === "thinking");

  // If any agent is presenting or writing
  if (agentStates.some((s) => s === "presenting")) return "writing";

  // If there's research activity happening
  if (agentStates.some((s) => s === "researching") || hasResearch) return "researching";

  // If agents are collaborating/thinking — analyzing phase
  if (agentStates.some((s) => s === "collaborating") || hasThinking) return "analyzing";

  return "researching";
}

export function useOfficeState(officeState: OfficeState) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>("chat");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const prevWhiteboardLen = useRef(officeState.whiteboard.length);

  // Auto-switch to whiteboard tab when new content arrives
  useEffect(() => {
    if (officeState.whiteboard.length > prevWhiteboardLen.current) {
      setActiveTab("whiteboard");
    }
    prevWhiteboardLen.current = officeState.whiteboard.length;
  }, [officeState.whiteboard.length]);

  // Chat messages: only speak, announce, ask_user (actual conversations)
  const chatMessages = useMemo(() => {
    return officeState.messages.filter(
      (m) => m.type === "speak" || m.type === "announce" || m.type === "ask_user"
    );
  }, [officeState.messages]);

  // Filtered chat messages for a specific agent or all
  const filteredMessages = useMemo(() => {
    if (!agentFilter) return chatMessages;
    return chatMessages.filter(
      (m) => m.agent === agentFilter || m.target === agentFilter
    );
  }, [chatMessages, agentFilter]);

  // Activity entries — filter out idle and empty-content moves for cleaner display
  const filteredActivity = useMemo(() => {
    const meaningful = officeState.activity.filter((a) => {
      if (a.action === "idle") return false;
      if (a.action === "move_to" && (!a.content || a.content === "null" || a.content === "None")) return false;
      return true;
    });
    if (!agentFilter) return meaningful;
    return meaningful.filter((a) => a.agent === agentFilter);
  }, [officeState.activity, agentFilter]);

  // Get messages for a specific agent (for AgentDetail)
  const getAgentMessages = useCallback(
    (agentName: string): ChatMessage[] => {
      return officeState.messages.filter(
        (m) => m.agent === agentName || m.target === agentName
      );
    },
    [officeState.messages]
  );

  // Get agent's thoughts from activity
  const getAgentThoughts = useCallback(
    (agentName: string): ActivityEntry[] => {
      return officeState.activity.filter(
        (a) => a.agent === agentName && a.action === "think"
      );
    },
    [officeState.activity]
  );

  // Get agent info by name
  const getAgent = useCallback(
    (name: string) => {
      return officeState.agents.find((a) => a.name === name) ?? null;
    },
    [officeState.agents]
  );

  // Bulletin sorted newest first
  const sortedBulletin = useMemo(() => {
    return [...officeState.bulletin].reverse();
  }, [officeState.bulletin]);

  const selectAgent = useCallback((name: string | null) => {
    setSelectedAgent(name);
  }, []);

  const workflowPhase = useMemo(
    () => deriveWorkflowPhase(officeState),
    [officeState]
  );

  return {
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
  };
}
