import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReefState, ChatMessage, ActivityEntry } from "../types";
import { withoutLandOfficeIdleMessages } from "../utils/messageFilters";

export type SidebarTab = "chat" | "activity" | "board" | "whiteboard" | "history";

export type WorkflowPhase = "idle" | "gathering" | "researching" | "analyzing" | "writing" | "done";

function deriveWorkflowPhase(reefState: ReefState): WorkflowPhase {
  if (!reefState.current_query) {
    // Check if whiteboard was recently written (within the last few seconds)
    if (reefState.whiteboard.length > 0) {
      const lastEntry = reefState.whiteboard[reefState.whiteboard.length - 1];
      const age = Date.now() - new Date(lastEntry.timestamp).getTime();
      if (age < 15000) return "done";
    }
    return "idle";
  }

  const agentStates = reefState.agents.map((a) => a.state);
  const agentLocations = reefState.agents.map((a) => a.location);

  // If agents are moving to war room
  const inWarRoom = agentLocations.filter((l) => l === "war_room").length;
  if (inWarRoom < 3) return "gathering";

  // Check activity for recent research
  const recentActivity = reefState.activity.slice(-10);
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

export function useReefState(reefState: ReefState) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>("chat");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const prevWhiteboardLen = useRef(reefState.whiteboard.length);

  // Auto-switch to whiteboard tab when new content arrives
  useEffect(() => {
    if (reefState.whiteboard.length > prevWhiteboardLen.current) {
      setActiveTab("whiteboard");
    }
    prevWhiteboardLen.current = reefState.whiteboard.length;
  }, [reefState.whiteboard.length]);

  // Chat messages: only speak, announce, ask_user (actual conversations)
  const chatMessages = useMemo(() => {
    return withoutLandOfficeIdleMessages(reefState.messages).filter(
      (m) => m.type === "speak" || m.type === "announce" || m.type === "ask_user"
    );
  }, [reefState.messages]);

  // Filtered chat messages for a specific agent or all
  const filteredMessages = useMemo(() => {
    if (!agentFilter) return chatMessages;
    return chatMessages.filter(
      (m) => m.agent === agentFilter || m.target === agentFilter
    );
  }, [chatMessages, agentFilter]);

  // Activity entries — filter out idle and empty-content moves for cleaner display
  const filteredActivity = useMemo(() => {
    const meaningful = reefState.activity.filter((a) => {
      if (a.action === "idle") return false;
      if (a.action === "move_to" && (!a.content || a.content === "null" || a.content === "None")) return false;
      return true;
    });
    if (!agentFilter) return meaningful;
    return meaningful.filter((a) => a.agent === agentFilter);
  }, [reefState.activity, agentFilter]);

  // Get messages for a specific agent (for AgentDetail)
  const getAgentMessages = useCallback(
    (agentName: string): ChatMessage[] => {
      return withoutLandOfficeIdleMessages(reefState.messages).filter(
        (m) => m.agent === agentName || m.target === agentName
      );
    },
    [reefState.messages]
  );

  // Get agent's thoughts from activity
  const getAgentThoughts = useCallback(
    (agentName: string): ActivityEntry[] => {
      return reefState.activity.filter(
        (a) => a.agent === agentName && a.action === "think"
      );
    },
    [reefState.activity]
  );

  // Get agent info by name
  const getAgent = useCallback(
    (name: string) => {
      return reefState.agents.find((a) => a.name === name) ?? null;
    },
    [reefState.agents]
  );

  // Bulletin sorted newest first
  const sortedBulletin = useMemo(() => {
    return [...reefState.bulletin].reverse();
  }, [reefState.bulletin]);

  const selectAgent = useCallback((name: string | null) => {
    setSelectedAgent(name);
  }, []);

  const workflowPhase = useMemo(
    () => deriveWorkflowPhase(reefState),
    [reefState]
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
