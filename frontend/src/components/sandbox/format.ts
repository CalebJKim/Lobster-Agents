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

export function formatDuration(startTs: string | undefined, endTs?: string | undefined): string {
  if (!startTs) return "";
  const start = new Date(startTs).getTime();
  const end = endTs ? new Date(endTs).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours <= 0) return `${minutes}m ${seconds}s`;
  return `${hours}h ${remainingMinutes}m`;
}

export function statusDot(status?: string | null, outcome?: string | null): string {
  if (status === "finished") {
    if (outcome === "partial") return "bg-amber-300";
    if (outcome === "failed") return "bg-rose-300";
    if (outcome === "success") return "bg-emerald-300";
  }
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
