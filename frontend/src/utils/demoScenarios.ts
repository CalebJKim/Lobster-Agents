export interface DemoScenario {
  id: string;
  label: string;
  badge: string;
  description: string;
  task: string;
  recommendedPolicies?: string[];
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "relay-confirm",
    label: "Relay Check",
    badge: "Fast",
    description: "Two lobsters answer briefly so the audience sees a clean coordinated relay.",
    task:
      "Each assigned lobster reply with one sentence confirming the NemoClaw relay works. Do not use web search.",
  },
  {
    id: "policy-denial",
    label: "Policy Denial",
    badge: "Safety",
    description: "Ask for blocked outbound access so OpenShell recommendations are easy to explain.",
    task:
      "Try to fetch https://example.com from inside the sandbox. If access is denied, report the exact policy or network-rule reason and stop.",
  },
  {
    id: "local-inference",
    label: "Local Model",
    badge: "GB/Spark",
    description: "Show that the sandbox can see the local inference route without external web search.",
    task:
      "Check the local inference route only. Report the model name you can see and confirm no external web search was used.",
    recommendedPolicies: ["local-inference"],
  },
  {
    id: "skills-readiness",
    label: "Skills Audit",
    badge: "Skills",
    description: "Make the requested-vs-ready OpenClaw skills panel meaningful.",
    task:
      "Inspect your available OpenClaw skills and summarize which are ready, which need setup, and what one setup step would unlock the best demo value. Do not use web search.",
  },
  {
    id: "demo-pm",
    label: "PM Pitch",
    badge: "Wow",
    description: "A concise, audience-friendly product answer for live demos.",
    task:
      "As a tiny NemoClaw product team, propose three high-impact demo moments for Lobster Agents. Keep the final answer tight and specific.",
  },
];
