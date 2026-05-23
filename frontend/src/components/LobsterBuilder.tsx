import { useCallback, useEffect, useMemo, useState } from "react";

interface Archetype {
  role: string;
  label: string;
  default_name: string;
  personality: string;
  tools: string[];
  openclaw_skills: string[];
}

interface SkillEntry {
  slug: string;
  name: string;
  description: string;
  needs_setup?: boolean;
}

interface LobsterBuilderProps {
  open: boolean;
  onClose: () => void;
  onSpawned?: () => void | Promise<void>;
}

/**
 * Modal for crafting a new lobster — name + archetype + hand-picked skill set.
 * Replaces the cramped inline + form in the dock. Live preview pane on the
 * right shows what the lobster will become before you spawn it.
 */
export default function LobsterBuilder({ open, onClose, onSpawned }: LobsterBuilderProps) {
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [catalog, setCatalog] = useState<SkillEntry[]>([]);
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState<string>("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  // null = inherit archetype defaults; non-null = user has touched the picker
  const [skillsDirty, setSkillsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load catalogs once when first opened.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      fetch("/archetypes", { cache: "no-store" }).then((r) => r.json()),
      fetch("/skills/catalog", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([arch, cat]) => {
        if (cancelled) return;
        setArchetypes(arch.archetypes ?? []);
        setCatalog(cat.skills ?? []);
        if (!archetype && arch.archetypes?.length) {
          setArchetype(arch.archetypes[0].role);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load catalogs");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // When archetype changes, sync the skills to its defaults — unless the
  // user has explicitly touched the skill picker.
  const currentArch = useMemo(
    () => archetypes.find((a) => a.role === archetype) ?? null,
    [archetype, archetypes]
  );

  useEffect(() => {
    if (!currentArch) return;
    if (skillsDirty) return;
    setSelectedSkills(currentArch.openclaw_skills);
  }, [currentArch, skillsDirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Reset form when the modal closes so reopening is clean.
  useEffect(() => {
    if (open) return;
    setName("");
    setSelectedSkills([]);
    setSkillsDirty(false);
    setError(null);
    setBusy(false);
  }, [open]);

  const toggleSkill = useCallback((slug: string) => {
    setSkillsDirty(true);
    setSelectedSkills((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  }, []);

  const submit = useCallback(async () => {
    if (!name.trim() || !archetype) {
      setError("Pick an archetype and give them a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/lobsters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archetype,
          name: name.trim(),
          // Only send a skills override if user actually changed from defaults
          skills: skillsDirty ? selectedSkills : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.detail || `Spawn failed (${res.status})`);
      await onSpawned?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spawn failed");
    } finally {
      setBusy(false);
    }
  }, [name, archetype, selectedSkills, skillsDirty, onSpawned, onClose]);

  if (!open) return null;

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[min(78vh,720px)] w-[min(92vw,920px)] flex-col overflow-hidden rounded-2xl border border-white/14 bg-slate-950/94 shadow-[0_40px_120px_rgba(4,22,31,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/8 bg-slate-900/40 px-6 py-3.5">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
              🦞 New Lobster
            </div>
            <div className="mt-0.5 text-[17px] font-semibold leading-6 text-white">
              Lobster Builder
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

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)] gap-0 overflow-hidden">
          {/* Form */}
          <div className="min-h-0 overflow-y-auto border-r border-white/8 px-6 py-4">
            {/* Name */}
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wide text-white/45">
                Name
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && name.trim()) submit();
                }}
                placeholder="e.g. Pip, Driftwood, Ripple…"
                maxLength={40}
                className="mt-1 w-full rounded-md border border-white/14 bg-slate-950/60 px-3 py-2 text-[14px] font-medium text-white outline-none placeholder:text-white/30 focus:border-cyan-200/45"
              />
            </label>

            {/* Archetype */}
            <div className="mt-4">
              <span className="text-[11px] font-bold uppercase tracking-wide text-white/45">
                Archetype
              </span>
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                {archetypes.map((a) => (
                  <button
                    key={a.role}
                    type="button"
                    onClick={() => {
                      setArchetype(a.role);
                      // Switching archetype re-syncs skill defaults unless dirty.
                    }}
                    className={`rounded-md border px-3 py-2 text-left text-[12px] font-medium transition ${
                      archetype === a.role
                        ? "border-cyan-300/50 bg-cyan-300/12 text-white"
                        : "border-white/10 bg-white/[0.045] text-white/72 hover:border-white/22 hover:bg-white/[0.08] hover:text-white"
                    }`}
                  >
                    <div className="font-semibold">{a.label}</div>
                    <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-white/40">
                      e.g. {a.default_name}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Skills picker */}
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-white/45">
                  Installed OpenClaw skills
                </span>
                {skillsDirty && currentArch && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSkills(currentArch.openclaw_skills);
                      setSkillsDirty(false);
                    }}
                    className="text-[10px] font-semibold uppercase tracking-wide text-white/40 hover:text-white/72"
                  >
                    Reset to {currentArch.label} defaults
                  </button>
                )}
              </div>
              <div className="mt-1 space-y-1">
                {catalog.map((skill) => {
                  const on = selectedSkills.includes(skill.slug);
                  return (
                    <button
                      key={skill.slug}
                      type="button"
                      onClick={() => toggleSkill(skill.slug)}
                      className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition ${
                        on
                          ? "border-emerald-300/40 bg-emerald-300/10"
                          : "border-white/10 bg-white/[0.04] hover:border-white/22 hover:bg-white/[0.08]"
                      }`}
                    >
                      <span
                        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] font-bold ${
                          on
                            ? "border-emerald-300/70 bg-emerald-300/30 text-emerald-50"
                            : "border-white/25 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-[12px] font-semibold text-white/90">
                            {skill.name}
                          </span>
                          <span className="rounded bg-white/[0.08] px-1 py-0.5 font-mono text-[9px] text-white/45">
                            {skill.slug}
                          </span>
                          {skill.needs_setup && (
                            <span
                              title="Requires additional config (API keys, ffmpeg, etc.) before it's ready."
                              className="rounded bg-amber-300/16 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-100"
                            >
                              needs setup
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-4 text-white/55">
                          {skill.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Preview pane */}
          <div className="min-h-0 overflow-y-auto bg-slate-950/30 px-5 py-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-white/45">
              Preview
            </div>
            <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
              <div className="text-[17px] font-bold leading-6 text-white">
                {name.trim() || (
                  <span className="text-white/30">Untitled lobster</span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-100/72">
                {currentArch?.label ?? "—"}
              </div>
              {currentArch && (
                <p className="mt-2 text-[11px] leading-4 text-white/65">
                  {currentArch.personality}
                </p>
              )}
            </div>

            <div className="mt-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">
                Traits
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(currentArch?.tools ?? []).map((tool) => (
                  <span
                    key={tool}
                    className="rounded-full bg-cyan-300/14 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-50"
                  >
                    {tool.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-white/40">
                OpenClaw skills{" "}
                <span className="text-white/30">
                  ({selectedSkills.length})
                </span>
              </div>
              {selectedSkills.length === 0 ? (
                <div className="mt-1 text-[11px] text-white/45">
                  No skills selected — this lobster will spawn without any
                  ClawHub skills installed.
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {selectedSkills.map((slug) => (
                    <span
                      key={slug}
                      className="rounded-full bg-emerald-300/16 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-50"
                    >
                      {slug}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <div className="mt-3 rounded-md border border-rose-300/24 bg-rose-300/10 px-3 py-2 text-[11px] font-medium text-rose-100">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/8 bg-slate-900/40 px-6 py-3">
          <div className="text-[11px] text-white/45">
            Lobsters live in memory until backend restart. Restart re-seeds the starter 7.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-white/[0.08] px-3 py-1.5 text-[12px] font-bold uppercase text-white/70 hover:bg-white/[0.16] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !name.trim() || !archetype}
              onClick={submit}
              className="rounded-md bg-cyan-300/30 px-4 py-1.5 text-[12px] font-bold uppercase text-cyan-50 hover:bg-cyan-300/45 disabled:opacity-40"
            >
              {busy ? "Spawning…" : "🦞 Build & Spawn"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
