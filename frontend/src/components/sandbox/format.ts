// Small formatting helpers shared by the sandbox tabs.

export function formatTime(ts: string | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

export function statusDot(status?: string | null): string {
  switch (status) {
    case "running":
      return "bg-cyan-300";
    case "cancelling":
    case "stopping":
    case "cancelled":
      return "bg-amber-300";
    case "finished":
      return "bg-emerald-300";
    case "error":
      return "bg-rose-300";
    default:
      return "bg-white/40";
  }
}
