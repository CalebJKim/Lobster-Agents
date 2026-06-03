import { useEffect, useMemo, useState } from "react";
import type {
  NemoClawCredentialCheck,
  NemoClawPolicyPreset,
  OpenClawApprovalsStatus,
  OpenClawWebSearchProvider,
  OpenClawWebSearchStatus,
  OpenShellNetworkRule,
  OpenShellNetworkRulesStatus,
} from "../../types";

interface PolicyPreview {
  preset: string;
  enabled: boolean;
  output: string;
}

interface PoliciesTabProps {
  policies: NemoClawPolicyPreset[];
  error: string | null;
  busy: string | null;
  notice: string | null;
  preview: PolicyPreview | null;
  onPreview: (preset: string, enabled: boolean) => void;
  onApply: () => void;
  onCancelPreview: () => void;
  onReload: () => void;
  credentialChecks?: NemoClawCredentialCheck[];
  approvals?: OpenClawApprovalsStatus | null;
  networkRules?: OpenShellNetworkRulesStatus | null;
  networkRulesError?: string | null;
  networkRulesBusy?: string | null;
  onNetworkRulesReload?: () => void;
  onNetworkRuleDecision?: (
    rule: OpenShellNetworkRule,
    decision: "approve" | "reject",
  ) => void;
  onNetworkRulesApproveAll?: () => void;
  onNetworkRulesClearPending?: () => void;
  webSearch?: OpenClawWebSearchStatus | null;
  webSearchBusy?: boolean;
  onWebSearchReload?: () => void;
  onWebSearchProviderChange?: (
    provider: OpenClawWebSearchProvider,
    ollamaBaseUrl?: string | null,
  ) => void;
}

const WEB_SEARCH_OPTIONS: Array<{
  provider: OpenClawWebSearchProvider;
  label: string;
  tag: string;
  description: string;
}> = [
  {
    provider: "duckduckgo",
    label: "DuckDuckGo",
    tag: "no key",
    description: "Good demo fallback for live web-search without storing a key.",
  },
  {
    provider: "ollama",
    label: "Ollama",
    tag: "local/cloud",
    description: "Uses Ollama Web Search through a signed-in local daemon or Ollama Cloud.",
  },
  {
    provider: "brave",
    label: "Brave",
    tag: "API key",
    description: "Best when BRAVE_API_KEY is configured inside the sandbox.",
  },
  {
    provider: "auto",
    label: "Auto",
    tag: "OpenClaw",
    description: "Let OpenClaw pick from configured web-search providers.",
  },
];

function providerLabel(provider: OpenClawWebSearchProvider | null | undefined): string {
  if (!provider) return "unknown";
  return WEB_SEARCH_OPTIONS.find((option) => option.provider === provider)?.label
    ?? provider.toString();
}

function statusClass(status: OpenShellNetworkRule["status"]) {
  if (status === "pending") return "border-amber-300/28 bg-amber-300/[0.07] text-amber-50";
  if (status === "approved") return "border-emerald-300/22 bg-emerald-300/[0.06] text-emerald-50";
  if (status === "rejected") return "border-rose-300/24 bg-rose-300/[0.07] text-rose-50";
  return "border-white/10 bg-white/[0.04] text-white/70";
}

function ruleBusyKey(rule: OpenShellNetworkRule, decision: "approve" | "reject") {
  return `${decision}:${rule.id}`;
}

function hasSecuritySignal(rule: OpenShellNetworkRule): boolean {
  return Boolean(rule.security || rule.security_flags?.length);
}

function endpointLabel(endpoint: string): string {
  return endpoint.replace(/\s+\[L4\]$/i, "");
}

function ruleSearchText(rule: OpenShellNetworkRule): string {
  return [
    rule.id,
    rule.status,
    rule.rule_name,
    rule.binary,
    rule.rationale,
    rule.security,
    rule.endpoints_raw,
    rule.binaries_raw,
    ...(rule.endpoints ?? []),
    ...(rule.binaries ?? []),
    ...(rule.security_flags ?? []),
  ].filter(Boolean).join(" ");
}

function networkRulesSummaryText(rules: OpenShellNetworkRule[]): string {
  const counts = rules.reduce<Record<string, number>>((acc, rule) => {
    acc[rule.status] = (acc[rule.status] ?? 0) + 1;
    return acc;
  }, {});
  const lines = [
    "OpenShell network rules",
    `pending: ${counts.pending ?? 0}`,
    `approved: ${counts.approved ?? 0}`,
    `rejected: ${counts.rejected ?? 0}`,
    "",
  ];
  for (const rule of rules) {
    const endpoint = (rule.endpoints?.[0] || rule.endpoints_raw || "unknown endpoint").replace(/\s+/g, " ");
    const binary = rule.binary || rule.binaries?.[0] || rule.binaries_raw || "unknown binary";
    lines.push(`- ${rule.status}: ${rule.rule_name || rule.id}`);
    lines.push(`  endpoint: ${endpointLabel(endpoint)}`);
    lines.push(`  binary: ${binary}`);
    if (rule.rationale) lines.push(`  rationale: ${rule.rationale}`);
  }
  return lines.join("\n");
}

function PolicyPreviewPanel({
  preview,
  busy,
  onApply,
  onCancelPreview,
}: {
  preview: PolicyPreview;
  busy: string | null;
  onApply: () => void;
  onCancelPreview: () => void;
}) {
  return (
    <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/[0.08] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-cyan-100/85">
            Preview ready
          </div>
          <div className="mt-0.5 text-[13px] font-semibold text-white">
            Will {preview.enabled ? "enable" : "disable"} {preview.preset}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onCancelPreview}
            className="rounded-md bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white/72 hover:bg-white/[0.16] hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={busy === preview.preset}
            className="rounded-md bg-cyan-300/30 px-3 py-1 text-[11px] font-bold uppercase text-cyan-50 hover:bg-cyan-300/45 disabled:opacity-40"
          >
            {busy === preview.preset ? "Applying..." : "Apply"}
          </button>
        </div>
      </div>
      {preview.output && (
        <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-slate-950/40 px-3 py-2 font-mono text-[11px] leading-4 text-white/75">
          {preview.output}
        </pre>
      )}
    </div>
  );
}

function RuleCard({
  rule,
  busy,
  onDecision,
}: {
  rule: OpenShellNetworkRule;
  busy?: string | null;
  onDecision?: (rule: OpenShellNetworkRule, decision: "approve" | "reject") => void;
}) {
  const endpoints = rule.endpoints?.length
    ? rule.endpoints
    : rule.endpoints_raw
      ? [rule.endpoints_raw]
      : [];
  const binaries = rule.binaries?.length
    ? rule.binaries
    : rule.binaries_raw
      ? [rule.binaries_raw]
      : rule.binary
        ? [rule.binary]
        : [];
  const approveBusy = busy === ruleBusyKey(rule, "approve");
  const rejectBusy = busy === ruleBusyKey(rule, "reject");

  return (
    <div className={`rounded-xl border px-3 py-3 ${statusClass(rule.status)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-white/[0.10] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
              {rule.status}
            </span>
            {typeof rule.confidence === "number" && (
              <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70">
                {rule.confidence}% confidence
              </span>
            )}
            {typeof rule.hit_count === "number" && (
              <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70">
                {rule.hit_count} hit{rule.hit_count === 1 ? "" : "s"}
              </span>
            )}
            {hasSecuritySignal(rule) && (
              <span
                className="rounded-full bg-amber-300/18 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-50"
                title={rule.security || rule.security_flags?.join(", ")}
              >
                {rule.security_flags?.includes("private-ip") ? "private IP" : "security note"}
              </span>
            )}
          </div>
          <div className="mt-1.5 break-words text-[12px] font-semibold leading-5 text-white/90">
            {rule.rule_name || rule.id}
          </div>
          {endpoints.length > 0 && (
            <div className="mt-2">
              <div className="text-[9px] font-bold uppercase tracking-wide text-white/35">
                Endpoint
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {endpoints.map((endpoint) => (
                  <span
                    key={endpoint}
                    className="rounded-md bg-slate-950/36 px-2 py-0.5 font-mono text-[10px] text-cyan-50/80"
                    title={endpoint}
                  >
                    {endpointLabel(endpoint)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {(rule.status === "pending" || rule.status === "rejected") && (
            <button
              type="button"
              disabled={!onDecision || approveBusy || Boolean(busy && !approveBusy)}
              onClick={() => onDecision?.(rule, "approve")}
              className="rounded-md bg-emerald-300/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-50 hover:bg-emerald-300/32 disabled:opacity-40"
            >
              {approveBusy ? "Approving" : "Approve"}
            </button>
          )}
          {(rule.status === "pending" || rule.status === "approved") && (
            <button
              type="button"
              disabled={!onDecision || rejectBusy || Boolean(busy && !rejectBusy)}
              onClick={() => onDecision?.(rule, "reject")}
              className="rounded-md bg-rose-300/18 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-rose-50 hover:bg-rose-300/30 disabled:opacity-40"
              title={rule.status === "approved" ? "Revoke this approved rule" : "Reject this pending rule"}
            >
              {rejectBusy ? "Working" : rule.status === "approved" ? "Revoke" : "Reject"}
            </button>
          )}
        </div>
      </div>

      {rule.rationale && (
        <div className="mt-2 break-words text-[12px] leading-5 text-white/72">
          {rule.rationale}
        </div>
      )}
      {rule.security && (
        <div className="mt-2 rounded-lg border border-amber-300/18 bg-amber-300/[0.08] px-2.5 py-1.5 text-[11px] leading-4 text-amber-50/82">
          {rule.security}
        </div>
      )}

      <div className="mt-2 grid gap-1.5 text-[11px] leading-4 text-white/54 md:grid-cols-2">
        <div className="min-w-0">
          <span className="font-bold uppercase tracking-wide text-white/35">Binary path</span>
          <div className="mt-0.5 space-y-0.5">
            {(binaries.length ? binaries : [rule.binary || "unknown"]).map((binary) => (
              <div key={binary} className="break-all font-mono text-white/62">
                {binary}
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          <span className="font-bold uppercase tracking-wide text-white/35">Observed</span>
          <div className="mt-0.5 break-words font-mono text-white/62">
            {rule.last_seen
              ? `last ${rule.last_seen}`
              : rule.first_seen
                ? `first ${rule.first_seen}`
                : "waiting for hit metadata"}
          </div>
        </div>
      </div>
      {rule.status === "approved" && (
        <div className="mt-2 text-[10px] leading-4 text-emerald-50/62">
          Active for future retries. Revoke removes the allowance from OpenShell.
        </div>
      )}
      {rule.status === "pending" && (
        <div className="mt-2 text-[10px] leading-4 text-amber-50/62">
          Approve, then retry the blocked request or rerun the task if it already failed.
        </div>
      )}
    </div>
  );
}

export default function PoliciesTab({
  policies,
  error,
  busy,
  notice,
  preview,
  onPreview,
  onApply,
  onCancelPreview,
  onReload,
  credentialChecks = [],
  approvals,
  networkRules,
  networkRulesError,
  networkRulesBusy,
  onNetworkRulesReload,
  onNetworkRuleDecision,
  onNetworkRulesApproveAll,
  onNetworkRulesClearPending,
  webSearch,
  webSearchBusy = false,
  onWebSearchReload,
  onWebSearchProviderChange,
}: PoliciesTabProps) {
  const [clearPendingConfirm, setClearPendingConfirm] = useState(false);
  const [ruleQuery, setRuleQuery] = useState("");
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [showRuleHistory, setShowRuleHistory] = useState(false);
  const [webProviderDraft, setWebProviderDraft] = useState<OpenClawWebSearchProvider>("duckduckgo");
  const [ollamaBaseDraft, setOllamaBaseDraft] = useState("");
  const rules = networkRules?.rules ?? [];
  const allPendingRules = useMemo(
    () => rules.filter((rule) => rule.status === "pending"),
    [rules],
  );
  const allApprovedRules = useMemo(
    () => rules.filter((rule) => rule.status === "approved"),
    [rules],
  );
  const hiddenHistoryCount = useMemo(
    () => rules.filter((rule) => rule.status !== "pending").length,
    [rules],
  );
  const filteredRules = useMemo(() => {
    const q = ruleQuery.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((rule) => ruleSearchText(rule).toLowerCase().includes(q));
  }, [ruleQuery, rules]);
  const visibleRules = useMemo(
    () => showRuleHistory
      ? filteredRules
      : filteredRules.filter((rule) => rule.status === "pending"),
    [filteredRules, showRuleHistory],
  );
  const pendingRules = useMemo(
    () => visibleRules.filter((rule) => rule.status === "pending"),
    [visibleRules],
  );
  const approvedRules = useMemo(
    () => showRuleHistory ? visibleRules.filter((rule) => rule.status === "approved") : [],
    [showRuleHistory, visibleRules],
  );
  const rejectedRules = useMemo(
    () => showRuleHistory ? visibleRules.filter((rule) => rule.status === "rejected") : [],
    [showRuleHistory, visibleRules],
  );
  const webSearchDirty =
    webProviderDraft !== (webSearch?.provider ?? "auto") ||
    (webProviderDraft === "ollama" &&
      ollamaBaseDraft.trim() !== (webSearch?.ollama_base_url ?? webSearch?.plugin_ollama_base_url ?? ""));

  useEffect(() => {
    setWebProviderDraft(webSearch?.provider ?? "auto");
    setOllamaBaseDraft(webSearch?.ollama_base_url ?? webSearch?.plugin_ollama_base_url ?? "");
  }, [webSearch?.provider, webSearch?.ollama_base_url, webSearch?.plugin_ollama_base_url]);

  const handleClearPending = () => {
    if (!clearPendingConfirm) {
      setClearPendingConfirm(true);
      return;
    }
    setClearPendingConfirm(false);
    onNetworkRulesClearPending?.();
  };

  const copyNetworkRules = async () => {
    try {
      await navigator.clipboard.writeText(networkRulesSummaryText(visibleRules));
      setCopyNotice("Network rule summary copied.");
    } catch {
      setCopyNotice("Could not copy automatically.");
    }
    window.setTimeout(() => setCopyNotice(null), 2200);
  };

  const submitWebSearchProvider = () => {
    onWebSearchProviderChange?.(
      webProviderDraft,
      webProviderDraft === "ollama" ? ollamaBaseDraft : null,
    );
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">
              Policy architecture
            </div>
            <div className="mt-1.5 text-[12px] leading-5 text-white/65">
              NemoClaw presets define broad sandbox allowances. OpenShell network rules are approval-after-deny recommendations for outbound traffic. Runtime exec policy is separate and read-only here.
            </div>
          </div>
          <button
            type="button"
            onClick={onReload}
            className="shrink-0 rounded-md bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white/72 hover:bg-white/[0.16] hover:text-white"
          >
            Reload
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full bg-emerald-300/14 px-2.5 py-0.5 font-semibold uppercase tracking-wide text-emerald-100">
            presets on: {policies.filter((p) => p.enabled).length}
          </span>
          <span className="rounded-full bg-amber-300/14 px-2.5 py-0.5 font-semibold uppercase tracking-wide text-amber-100">
            pending rules: {allPendingRules.length}
          </span>
          <span className="rounded-full bg-emerald-300/14 px-2.5 py-0.5 font-semibold uppercase tracking-wide text-emerald-100">
            approved rules: {allApprovedRules.length}
          </span>
          <span className="rounded-full bg-cyan-300/14 px-2.5 py-0.5 font-semibold uppercase tracking-wide text-cyan-100">
            exec security: {approvals?.summary?.security ?? "unknown"}
          </span>
          <span className="rounded-full bg-cyan-300/14 px-2.5 py-0.5 font-semibold uppercase tracking-wide text-cyan-100">
            exec ask: {approvals?.summary?.ask ?? "unknown"}
          </span>
        </div>
      </section>

      <section className="rounded-xl border border-cyan-300/16 bg-cyan-300/[0.045] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-cyan-100/55">
              OpenClaw web search
            </div>
            <div className="mt-1.5 text-[12px] leading-5 text-white/66">
              This selects the provider behind OpenClaw&apos;s <span className="font-mono text-cyan-50/80">web_search</span> tool for this sandbox. OpenShell still denies unapproved outbound traffic first and surfaces network-rule requests below.
            </div>
          </div>
          <button
            type="button"
            onClick={onWebSearchReload ?? onReload}
            disabled={webSearchBusy}
            className="shrink-0 rounded-md bg-white/[0.08] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/70 hover:bg-white/[0.16] disabled:opacity-40"
          >
            Reload
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full bg-white/[0.08] px-2.5 py-0.5 font-semibold uppercase tracking-wide text-white/60">
            active: {providerLabel(webSearch?.provider)}
          </span>
          {webSearch?.keyless && (
            <span className="rounded-full bg-emerald-300/14 px-2.5 py-0.5 font-semibold uppercase tracking-wide text-emerald-100">
              keyless path
            </span>
          )}
          {webSearch?.credentials && webSearch.credentials.length > 0 && (
            <span className="rounded-full bg-amber-300/14 px-2.5 py-0.5 font-semibold uppercase tracking-wide text-amber-100">
              setup: {webSearch.credentials.join(" / ")}
            </span>
          )}
        </div>

        {webSearch?.error && (
          <div className="mt-3 rounded-lg border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-[12px] text-rose-100">
            {webSearch.error}
          </div>
        )}

        <div className="mt-3 grid gap-2 md:grid-cols-4">
          {WEB_SEARCH_OPTIONS.map((option) => {
            const selected = webProviderDraft === option.provider;
            return (
              <button
                key={option.provider}
                type="button"
                onClick={() => setWebProviderDraft(option.provider)}
                disabled={webSearchBusy}
                className={`rounded-xl border px-3 py-3 text-left transition disabled:opacity-45 ${
                  selected
                    ? "border-cyan-200/42 bg-cyan-300/[0.12]"
                    : "border-white/10 bg-white/[0.04] hover:border-white/22 hover:bg-white/[0.07]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[12px] font-semibold text-white/88">
                    {option.label}
                  </div>
                  <span className="rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white/52">
                    {option.tag}
                  </span>
                </div>
                <div className="mt-1 text-[11px] leading-4 text-white/55">
                  {option.description}
                </div>
              </button>
            );
          })}
        </div>

        {webProviderDraft === "ollama" && (
          <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/28 px-3 py-2">
            <label className="block text-[9px] font-bold uppercase tracking-wide text-white/38">
              Ollama base URL
            </label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <input
                value={ollamaBaseDraft}
                onChange={(event) => setOllamaBaseDraft(event.target.value)}
                placeholder="http://host.openshell.internal:11434"
                disabled={webSearchBusy}
                className="h-9 min-w-0 flex-1 rounded-md border border-white/10 bg-slate-950/50 px-2.5 font-mono text-[12px] text-white outline-none placeholder:text-white/30 focus:border-cyan-200/40 disabled:opacity-45"
              />
              <button
                type="button"
                onClick={() => setOllamaBaseDraft("http://host.openshell.internal:11434")}
                disabled={webSearchBusy}
                className="h-9 rounded-md bg-white/[0.08] px-2.5 text-[10px] font-bold uppercase tracking-wide text-white/70 hover:bg-white/[0.16] disabled:opacity-40"
              >
                Local host
              </button>
              <button
                type="button"
                onClick={() => setOllamaBaseDraft("https://ollama.com")}
                disabled={webSearchBusy}
                className="h-9 rounded-md bg-white/[0.08] px-2.5 text-[10px] font-bold uppercase tracking-wide text-white/70 hover:bg-white/[0.16] disabled:opacity-40"
              >
                Cloud
              </button>
            </div>
            <div className="mt-1.5 text-[11px] leading-4 text-white/48">
              Local search requires the host Ollama daemon to be signed in. Cloud search requires OpenClaw/Ollama credentials configured outside this UI.
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="text-[11px] leading-4 text-white/48">
            Recommended booth fallback: DuckDuckGo. Use Ollama once the demo station&apos;s Ollama search path is verified.
          </div>
          <button
            type="button"
            onClick={submitWebSearchProvider}
            disabled={!onWebSearchProviderChange || webSearchBusy || !webSearchDirty}
            className="shrink-0 rounded-md bg-cyan-300/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-cyan-50 hover:bg-cyan-300/38 disabled:cursor-not-allowed disabled:bg-white/[0.07] disabled:text-white/35"
          >
            {webSearchBusy ? "Saving" : "Save provider"}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">
              OpenShell network rules
            </div>
            <div className="mt-1 text-[12px] leading-5 text-white/65">
              OpenShell denies first, records the attempted outbound access, then proposes a minimal policy rule. Approving lets future retries through after policy hot-reload.
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <button
              type="button"
              onClick={onNetworkRulesReload ?? onReload}
              disabled={networkRulesBusy === "reload"}
              className="rounded-md bg-white/[0.08] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/70 hover:bg-white/[0.16] disabled:opacity-40"
            >
              Reload
            </button>
            {allPendingRules.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={onNetworkRulesApproveAll}
                  disabled={!onNetworkRulesApproveAll || Boolean(networkRulesBusy)}
                  className="rounded-md bg-emerald-300/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-50 hover:bg-emerald-300/32 disabled:opacity-40"
                >
                  {networkRulesBusy === "approve-all" ? "Approving" : "Approve all"}
                </button>
                <button
                  type="button"
                  onClick={handleClearPending}
                  disabled={!onNetworkRulesClearPending || Boolean(networkRulesBusy)}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide disabled:opacity-40 ${
                    clearPendingConfirm
                      ? "bg-rose-300/28 text-rose-50 hover:bg-rose-300/40"
                      : "bg-white/[0.08] text-white/70 hover:bg-white/[0.16]"
                  }`}
                >
                  {networkRulesBusy === "clear-pending"
                    ? "Clearing"
                    : clearPendingConfirm
                      ? "Confirm clear"
                      : "Clear pending"}
                </button>
              </>
            )}
          </div>
        </div>

        {networkRulesError && (
          <div className="mt-3 rounded-lg border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-[12px] text-rose-100">
            {networkRulesError}
          </div>
        )}

        {networkRules && !networkRulesError && rules.length > 0 && (
          <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/24 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={ruleQuery}
                onChange={(event) => setRuleQuery(event.target.value)}
                placeholder="Search endpoint, binary, rationale..."
                className="h-8 min-w-56 flex-1 rounded-md border border-white/10 bg-slate-950/50 px-2.5 text-[12px] text-white outline-none placeholder:text-white/30 focus:border-cyan-200/40"
              />
              {hiddenHistoryCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowRuleHistory((current) => !current)}
                  className="h-8 rounded-md bg-white/[0.08] px-2.5 text-[10px] font-bold uppercase tracking-wide text-white/70 hover:bg-white/[0.16]"
                >
                  {showRuleHistory ? "Hide history" : `Show history ${hiddenHistoryCount}`}
                </button>
              )}
              <button
                type="button"
                onClick={copyNetworkRules}
                disabled={visibleRules.length === 0}
                className="h-8 rounded-md bg-cyan-300/12 px-2.5 text-[10px] font-bold uppercase tracking-wide text-cyan-50 hover:bg-cyan-300/20 disabled:opacity-40"
              >
                Copy summary
              </button>
              <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/45">
                {visibleRules.length}/{rules.length}
              </span>
            </div>
            {!showRuleHistory && hiddenHistoryCount > 0 && (
              <div className="mt-1.5 text-[11px] font-medium text-white/45">
                Showing pending requests only. Approved and rejected rule history remains available but hidden for demo clarity.
              </div>
            )}
            {copyNotice && (
              <div className="mt-1.5 text-[11px] font-medium text-cyan-100/75">
                {copyNotice}
              </div>
            )}
          </div>
        )}

        {allPendingRules.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300/24 bg-amber-300/[0.08] px-3 py-2 text-[12px] leading-5 text-amber-50/82">
            {allPendingRules.length} OpenShell rule{allPendingRules.length === 1 ? "" : "s"} need a decision. Approving allows future retries; it does not automatically replay a failed request.
          </div>
        )}

        {!networkRules && !networkRulesError ? (
          <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-6 text-center text-[12px] text-white/55">
            Loading OpenShell network rules...
          </div>
        ) : rules.length === 0 && !networkRulesError ? (
          <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-6 text-center text-[12px] text-white/55">
            No OpenShell network-rule recommendations for this sandbox.
          </div>
        ) : visibleRules.length === 0 && !networkRulesError ? (
          <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-6 text-center text-[12px] text-white/55">
            {showRuleHistory
              ? "No OpenShell network rules match the current search."
              : hiddenHistoryCount > 0
                ? "No pending policy requests. Approved and rejected rule history is hidden."
                : "No pending policy requests."}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {pendingRules.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-amber-100/75">
                  Pending
                </div>
                {pendingRules.map((rule) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    busy={networkRulesBusy}
                    onDecision={onNetworkRuleDecision}
                  />
                ))}
              </div>
            )}

            {approvedRules.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-100/75">
                  Approved
                </div>
                {approvedRules.map((rule) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    busy={networkRulesBusy}
                    onDecision={onNetworkRuleDecision}
                  />
                ))}
              </div>
            )}

            {rejectedRules.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-rose-100/75">
                  Rejected
                </div>
                {rejectedRules.map((rule) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    busy={networkRulesBusy}
                    onDecision={onNetworkRuleDecision}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">
          Runtime exec policy
        </div>
        <div className="mt-1.5 text-[12px] leading-5 text-white/65">
          OpenClaw exec approvals are runtime-level command approvals. This panel shows effective policy only; OpenShell network rules above are the sandbox-level approve/reject flow.
        </div>
        {approvals?.effective_policy ? (
          <pre className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded bg-slate-950/35 px-3 py-2 font-mono text-[10px] leading-4 text-white/58">
            {approvals.effective_policy}
          </pre>
        ) : (
          <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] text-white/55">
            Runtime exec policy has not loaded yet.
          </div>
        )}
      </section>

      {credentialChecks.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">
            Credential checks
          </div>
          <div className="mt-2 space-y-1.5">
            {credentialChecks.map((check) => (
              <div
                key={`${check.policy}-${check.name}`}
                className={`rounded-lg px-3 py-2 text-[12px] leading-4 ${
                  check.status === "missing"
                    ? "border border-rose-300/24 bg-rose-300/[0.08] text-rose-50"
                    : check.status === "ok"
                      ? "border border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-50"
                      : "border border-white/10 bg-white/[0.04] text-white/64"
                }`}
              >
                <span className="font-semibold">{check.policy}</span>
                {" / "}
                <span className="font-mono">{check.name}</span>
                {" - "}
                {check.message}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">
              NemoClaw presets
            </div>
            <p className="mt-1 text-[12px] leading-5 text-white/65">
              Toggle a preset to preview what the NemoClaw policy CLI would do. Nothing is applied until you click <span className="font-semibold text-white/82">Apply</span>.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-[12px] text-rose-100">
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-3 rounded-lg border border-emerald-300/24 bg-emerald-300/10 px-3 py-2 text-[12px] text-emerald-100">
            {notice}
          </div>
        )}
        {preview && (
          <div className="mt-3">
            <PolicyPreviewPanel
              preview={preview}
              busy={busy}
              onApply={onApply}
              onCancelPreview={onCancelPreview}
            />
          </div>
        )}

        {policies.length === 0 && !error ? (
          <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-6 text-center text-[12px] text-white/55">
            Loading policies...
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {policies.map((p) => {
              const isBusy = busy === p.name;
              const previewMatches = preview?.preset === p.name;
              const nextEnabled = previewMatches ? preview.enabled : !p.enabled;
              return (
                <div
                  key={p.name}
                  className={`rounded-xl border px-3 py-3 transition ${
                    p.enabled
                      ? "border-emerald-300/22 bg-emerald-300/[0.05]"
                      : "border-white/10 bg-white/[0.04]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-white/88">
                        {p.name}
                      </div>
                      {p.description && (
                        <div className="mt-0.5 break-words text-[11px] leading-4 text-white/55">
                          {p.description}
                        </div>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        p.enabled
                          ? "bg-emerald-300/16 text-emerald-100"
                          : "bg-white/[0.08] text-white/65"
                      }`}
                    >
                      {p.enabled ? "on" : "off"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onPreview(p.name, nextEnabled)}
                      className="rounded-md bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white/82 hover:bg-white/[0.16] disabled:opacity-40"
                    >
                      {isBusy ? "Previewing..." : `Preview ${nextEnabled ? "enable" : "disable"}`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

    </div>
  );
}
