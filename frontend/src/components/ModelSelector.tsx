import { useCallback, useEffect, useMemo, useState } from "react";

interface ModelProfile {
  id: string;
  label: string;
  kind: string;
  base_url: string;
  model: string;
  api_key_set: boolean;
}

interface ModelsPayload {
  active_id: string;
  profiles: ModelProfile[];
  allowed_kinds: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onActiveChanged?: () => void;
}

// Empty-form template — also used to reset after a successful add.
const EMPTY_FORM = {
  id: "",
  label: "",
  kind: "ollama" as "ollama" | "openai",
  base_url: "",
  model: "",
  api_key: "",
};

export default function ModelSelector({ open, onClose, onActiveChanged }: Props) {
  const [data, setData] = useState<ModelsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [testResult, setTestResult] = useState<{
    ok?: boolean;
    error?: string;
    sample?: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const r = await fetch("/models", { cache: "no-store" });
      if (!r.ok) throw new Error(`/models ${r.status}`);
      const j = (await r.json()) as ModelsPayload;
      setData(j);
    } catch (err) {
      console.warn("[models] refresh failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // Esc closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset form + test state when the modal closes so reopening is clean.
  useEffect(() => {
    if (open) return;
    setForm({ ...EMPTY_FORM });
    setTestResult(null);
    setFormError(null);
  }, [open]);

  const activate = useCallback(
    async (id: string) => {
      try {
        setActivating(id);
        const r = await fetch(`/models/${encodeURIComponent(id)}/activate`, {
          method: "POST",
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.detail || `activate failed (${r.status})`);
        }
        await refresh();
        onActiveChanged?.();
      } catch (err) {
        console.warn("[models] activate failed", err);
      } finally {
        setActivating(null);
      }
    },
    [refresh, onActiveChanged],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm(`Remove profile ${id}?`)) return;
      try {
        const r = await fetch(`/models/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.detail || `delete failed (${r.status})`);
        }
        await refresh();
      } catch (err) {
        console.warn("[models] delete failed", err);
      }
    },
    [refresh],
  );

  const runTest = useCallback(async () => {
    setTestResult(null);
    setFormError(null);
    if (!form.label.trim() || !form.base_url.trim() || !form.model.trim()) {
      setFormError("Label, base URL, and model are required.");
      return;
    }
    try {
      setTesting(true);
      const r = await fetch("/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTestResult({ ok: false, error: j?.detail || `test failed (${r.status})` });
      } else {
        setTestResult(j);
      }
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : "test failed",
      });
    } finally {
      setTesting(false);
    }
  }, [form]);

  const save = useCallback(async () => {
    setFormError(null);
    if (!form.label.trim() || !form.base_url.trim() || !form.model.trim()) {
      setFormError("Label, base URL, and model are required.");
      return;
    }
    try {
      setSaving(true);
      const r = await fetch("/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setFormError(j?.detail || `save failed (${r.status})`);
        return;
      }
      setForm({ ...EMPTY_FORM });
      setTestResult(null);
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [form, refresh]);

  const profiles = useMemo(() => data?.profiles ?? [], [data]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="grid h-[min(82vh,720px)] w-[min(92vw,920px)] grid-cols-[minmax(0,1fr)_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-white/14 bg-slate-950/96 text-white shadow-[0_40px_120px_rgba(4,22,31,0.55)]"
      >
        {/* Header */}
        <div className="col-span-2 flex shrink-0 items-center justify-between gap-4 border-b border-white/8 bg-slate-900/40 px-6 py-3.5">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
              Model Backends
            </div>
            <div className="mt-0.5 text-[17px] font-semibold leading-6 text-white">
              Select & manage LLM backends
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md bg-white/[0.07] text-white/72 hover:bg-white/[0.16] hover:text-white"
            aria-label="Close"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Left: existing profiles */}
        <div className="min-h-0 overflow-y-auto border-r border-white/8 px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wide text-white/45">
              Registered profiles
            </span>
            {loading && (
              <span className="text-[10px] text-white/40">loading…</span>
            )}
          </div>
          <div className="space-y-2">
            {profiles.map((p) => {
              const isActive = data?.active_id === p.id;
              return (
                <div
                  key={p.id}
                  className={`rounded-lg border px-3 py-2.5 transition ${
                    isActive
                      ? "border-cyan-300/50 bg-cyan-300/10"
                      : "border-white/10 bg-white/[0.04]"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-white">
                        {p.label}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] font-mono text-white/55">
                        {p.kind} · {p.model}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-white/40">
                        {p.base_url}
                      </div>
                    </div>
                    {isActive && (
                      <span className="rounded bg-cyan-300/24 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-cyan-50">
                        active
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isActive || activating === p.id}
                      onClick={() => activate(p.id)}
                      className="rounded bg-cyan-300/24 px-2 py-1 text-[10px] font-bold uppercase text-cyan-50 hover:bg-cyan-300/38 disabled:opacity-40"
                    >
                      {activating === p.id
                        ? "Switching…"
                        : isActive
                          ? "In use"
                          : "Use"}
                    </button>
                    <button
                      type="button"
                      disabled={isActive}
                      onClick={() => remove(p.id)}
                      className="rounded bg-white/[0.06] px-2 py-1 text-[10px] font-bold uppercase text-white/65 hover:bg-rose-500/22 hover:text-rose-100 disabled:opacity-40"
                      title={
                        isActive ? "Activate another profile first" : "Remove"
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
            {profiles.length === 0 && !loading && (
              <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-3 text-[12px] text-white/55">
                No profiles registered.
              </div>
            )}
          </div>
        </div>

        {/* Right: add form */}
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/45">
            Add a backend
          </div>

          <Field label="Label">
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="vLLM Qwen3.6 27B"
              className="w-full rounded-md border border-white/14 bg-slate-950/60 px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-cyan-200/45"
            />
          </Field>

          <Field label="Kind">
            <div className="flex gap-1.5">
              {(["ollama", "openai"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setForm({ ...form, kind: k })}
                  className={`rounded-md border px-3 py-1.5 text-[11px] font-bold uppercase transition ${
                    form.kind === k
                      ? "border-cyan-300/50 bg-cyan-300/12 text-white"
                      : "border-white/10 bg-white/[0.04] text-white/65 hover:border-white/22 hover:text-white"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-white/40">
              ollama → /api/chat · openai → /v1/chat/completions (vLLM, etc.)
            </p>
          </Field>

          <Field label="Base URL">
            <input
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              placeholder="http://127.0.0.1:8000/v1"
              className="w-full rounded-md border border-white/14 bg-slate-950/60 px-2.5 py-1.5 font-mono text-[12px] text-white outline-none focus:border-cyan-200/45"
            />
          </Field>

          <Field label="Model name">
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="qwen3.6-27b-mtp"
              className="w-full rounded-md border border-white/14 bg-slate-950/60 px-2.5 py-1.5 font-mono text-[12px] text-white outline-none focus:border-cyan-200/45"
            />
          </Field>

          <Field label="API key (optional)">
            <input
              type="password"
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
              placeholder="Bearer token for OpenAI-style endpoints"
              className="w-full rounded-md border border-white/14 bg-slate-950/60 px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-cyan-200/45"
            />
          </Field>

          <Field label="ID (optional)">
            <input
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="auto-slugged from label"
              className="w-full rounded-md border border-white/14 bg-slate-950/60 px-2.5 py-1.5 font-mono text-[12px] text-white outline-none focus:border-cyan-200/45"
            />
          </Field>

          {formError && (
            <div className="mt-2 rounded-md border border-rose-300/24 bg-rose-300/10 px-3 py-2 text-[11px] font-medium text-rose-100">
              {formError}
            </div>
          )}

          {testResult && (
            <div
              className={`mt-2 rounded-md border px-3 py-2 text-[11px] ${
                testResult.ok
                  ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-50"
                  : "border-rose-300/24 bg-rose-300/10 text-rose-100"
              }`}
            >
              {testResult.ok ? (
                <>
                  <div className="font-bold uppercase tracking-wide">
                    ✓ Endpoint OK
                  </div>
                  {testResult.sample && (
                    <div className="mt-1 truncate font-mono text-white/80">
                      sample: {testResult.sample}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="font-bold uppercase tracking-wide">✗ Test failed</div>
                  <div className="mt-1 break-all">{testResult.error}</div>
                </>
              )}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={runTest}
              disabled={testing}
              className="rounded-md bg-white/[0.08] px-3 py-1.5 text-[12px] font-bold uppercase text-white/80 hover:bg-white/[0.16] disabled:opacity-40"
            >
              {testing ? "Testing…" : "Test"}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-cyan-300/30 px-4 py-1.5 text-[12px] font-bold uppercase text-cyan-50 hover:bg-cyan-300/45 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>

          <p className="mt-3 text-[10px] text-white/40">
            Profiles live in memory until the backend restarts. The backend
            re-seeds the default profile on restart.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-2.5 block">
      <span className="block text-[10px] font-bold uppercase tracking-wide text-white/50">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
