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
    id: "build-web-app",
    label: "Build Web App",
    badge: "Code",
    description: "Create a small static app and preview the generated HTML from Run artifacts.",
    task:
      "Build a tiny static web app for a NemoClaw Reef booth visitor. Do not use web search and do not start a long-running server. In your current working directory, create index.html, styles.css, and app.js. The page should look polished, explain NemoClaw sandboxes, OpenShell policies, and OpenClaw lobster teams, and include one small interactive button or toggle. Do not paste the source code in your final answer. After creating the files, give a short product summary, list the exact filenames, and tell the user to open the generated product from the Run artifacts Preview link in this UI.",
  },
  {
    id: "policy-denial",
    label: "Policy Denial",
    badge: "Safety",
    description: "Ask for blocked outbound access so OpenShell recommendations are easy to explain.",
    task:
      "Use a shell command such as curl from inside the sandbox to fetch {{POLICY_DEMO_URL}}. Do not use Brave or a search provider. Prefer `curl -I -L --max-time 12 {{POLICY_DEMO_URL}}` so the result is a short real-site status check. Run the curl once, then stop even if curl reports HTTP 403, TLS failure, or a proxy/network error. Tell the operator to wait up to 30 seconds, open Policies, and approve or reject the new OpenShell rule. This target is a real NVIDIA site; after approval, wait 5-15 seconds for policy hot-reload, then rerun. The retry should reach the site even if the site returns a non-200 HTTP status.",
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
      "As a tiny NemoClaw product team, propose three high-impact demo moments for NemoClaw Reef. Keep the final answer tight and specific.",
  },
];

const REAL_POLICY_DEMO_URLS = [
  "https://developer.nvidia.com/",
  "https://docs.nvidia.com/",
  "https://blogs.nvidia.com/",
  "https://nvidianews.nvidia.com/",
  "https://build.nvidia.com/",
  "https://catalog.ngc.nvidia.com/",
  "https://forums.developer.nvidia.com/",
  "https://developer.download.nvidia.com/",
];

function freshPolicyDemoUrl(avoidHosts?: Iterable<string>): string {
  const avoided = new Set(Array.from(avoidHosts ?? [], (host) => host.toLowerCase()));
  const available = REAL_POLICY_DEMO_URLS.filter((raw) => {
    try {
      return !avoided.has(new URL(raw).hostname.toLowerCase());
    } catch {
      return true;
    }
  });
  const candidates = available.length > 0 ? available : REAL_POLICY_DEMO_URLS;
  const index = Math.floor(Math.random() * candidates.length);
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const url = new URL(candidates[index]);
  url.searchParams.set("lobster_policy_demo", nonce);
  return url.toString();
}

export function materializeDemoTask(
  scenario: DemoScenario,
  options?: { avoidPolicyHosts?: Iterable<string> },
): string {
  if (scenario.id !== "policy-denial") return scenario.task;
  return scenario.task.replace(
    /\{\{POLICY_DEMO_URL\}\}/g,
    freshPolicyDemoUrl(options?.avoidPolicyHosts),
  );
}
