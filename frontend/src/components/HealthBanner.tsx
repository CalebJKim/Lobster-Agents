import { useEffect, useState } from "react";

type ComponentStatus = Record<string, unknown> & {
  ok?: boolean;
  reachable?: boolean;
  available?: boolean;
  error?: string | null;
  path?: string | null;
  model?: string;
  model_loaded?: boolean | null;
};

type Health = {
  ok: boolean;
  failing: string[];
  components: Record<string, ComponentStatus>;
};

const COMPONENT_LABELS: Record<string, string> = {
  llm: "LLM",
  openshell: "OpenShell CLI",
  nemoclaw: "NemoClaw CLI",
  sandboxes: "Sandboxes",
};

function describeFailure(name: string, comp: ComponentStatus): string {
  const label = COMPONENT_LABELS[name] ?? name;
  if (name === "llm") {
    if (!comp.reachable) {
      return `${label}: unreachable (${comp.error ?? "no response"})`;
    }
    if (comp.model_loaded === false) {
      return `${label}: model "${comp.model ?? "?"}" not loaded — load it with \`ollama run ${comp.model ?? ""}\` on the LLM host`;
    }
  }
  const reason = comp.error || "unreachable";
  return `${label}: ${reason}`;
}

export default function HealthBanner() {
  const [health, setHealth] = useState<Health | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/health", { cache: "no-store" });
        if (!res.ok) throw new Error(`/health → ${res.status}`);
        const data = (await res.json()) as Health;
        if (!cancelled) {
          setHealth(data);
          setFetchError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : "health probe failed");
          setHealth(null);
        }
      }
    };
    poll();
    const id = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (fetchError) {
    return (
      <div
        role="status"
        className="pointer-events-auto absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-md border border-rose-300/40 bg-rose-600/40 px-4 py-2 text-[12px] font-semibold text-white shadow-[0_18px_60px_rgba(4,22,31,0.32)] backdrop-blur-md"
      >
        Backend unreachable — {fetchError}
      </div>
    );
  }

  if (!health || health.ok) return null;

  const messages = health.failing.map((name) =>
    describeFailure(name, health.components[name] ?? {})
  );

  return (
    <div
      role="status"
      className="pointer-events-auto absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-md border border-amber-300/45 bg-amber-500/30 px-4 py-2 text-[12px] font-semibold text-white shadow-[0_18px_60px_rgba(4,22,31,0.32)] backdrop-blur-md"
    >
      <div className="text-[11px] font-bold uppercase tracking-wide text-amber-100/85">
        Reef is partially down
      </div>
      <ul className="mt-1 list-disc pl-4 text-amber-50">
        {messages.map((msg) => (
          <li key={msg}>{msg}</li>
        ))}
      </ul>
    </div>
  );
}
