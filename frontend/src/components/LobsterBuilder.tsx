import { useCallback, useEffect, useMemo, useState } from "react";
import LobsterStage from "./LobsterStage";
import type {
  AgentInfo,
  AgentRole,
  Room,
  AgentState,
  GeneratedHeadwear,
  LobsterEyewear,
  LobsterHeadwear,
} from "../types";

// Reef-tasteful palette for the shell-color picker. Eight presets cover the
// obvious crustacean reds + complementary kelp/tide/sand hues so the user
// can spawn lobsters that stand out from the starter 7 without falling back
// to the OS color dialog.
const COLOR_SWATCHES: { label: string; hex: string }[] = [
  { label: "Coral red", hex: "#ff6f61" },
  { label: "Tide cyan", hex: "#5ec8ce" },
  { label: "Kelp green", hex: "#76b900" },
  { label: "Anemone pink", hex: "#ff7fb5" },
  { label: "Deep ocean", hex: "#1d6fa5" },
  { label: "Sun amber", hex: "#f6c14a" },
  { label: "Sand", hex: "#e6b873" },
  { label: "Sea purple", hex: "#a168c8" },
];

const HEADWEAR_OPTIONS: { value: LobsterHeadwear; label: string }[] = [
  { value: "none", label: "None" },
  { value: "cowboy_hat", label: "Cowboy hat" },
  { value: "baseball_cap", label: "Baseball cap" },
];

const EYEWEAR_OPTIONS: { value: LobsterEyewear; label: string }[] = [
  { value: "none", label: "None" },
  { value: "sunglasses", label: "Sunglasses" },
];

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
  // null = the lobster builder uses the default per-archetype color from
  // the frontend palette; set when the user clicks a swatch or the custom picker.
  const [color, setColor] = useState<string | null>(null);
  const [headwear, setHeadwear] = useState<LobsterHeadwear>("none");
  const [eyewear, setEyewear] = useState<LobsterEyewear>("none");
  const [accessoryPrompt, setAccessoryPrompt] = useState("");
  const [generatedHeadwear, setGeneratedHeadwear] = useState<GeneratedHeadwear | null>(null);
  // Free-form user-supplied mission text. Empty string = no mission; the
  // backend trims and discards empty strings, so we don't have to guard here.
  const [mission, setMission] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generatingAccessory, setGeneratingAccessory] = useState(false);

  // Load catalogs once when first opened.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    Promise.all([
      fetch("/archetypes", { cache: "no-store", signal: controller.signal }).then((r) => r.json()),
      fetch("/skills/catalog", { cache: "no-store", signal: controller.signal }).then((r) => r.json()),
    ])
      .then(([arch, cat]) => {
        if (controller.signal.aborted) return;
        setArchetypes(arch.archetypes ?? []);
        setCatalog(cat.skills ?? []);
        if (!archetype && arch.archetypes?.length) {
          setArchetype(arch.archetypes[0].role);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not load catalogs");
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // When archetype changes, sync the skills to its defaults — unless the
  // user has explicitly touched the skill picker.
  const currentArch = useMemo(
    () => archetypes.find((a) => a.role === archetype) ?? null,
    [archetype, archetypes]
  );

  // Synthesize an AgentInfo for the LobsterStage preview canvas. The
  // stage's effect re-runs whenever this object identity changes, so we
  // memoize on the exact fields it cares about (name/role/color/skills)
  // to avoid pointless scene rebuilds.
  const previewAgent: AgentInfo = useMemo(
    () => ({
      name: name.trim() || "New Lobster",
      role: (archetype || "researcher") as AgentRole,
      state: "idle" as AgentState,
      location: "break_room" as Room,
      position: { x: 0, y: 0 },
      current_task: null,
      tools: currentArch?.tools ?? [],
      openclaw_skills: selectedSkills,
      color,
      appearance: { headwear, eyewear, generated_headwear: generatedHeadwear },
    }),
    [name, archetype, color, headwear, eyewear, generatedHeadwear, selectedSkills, currentArch?.tools],
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
    setColor(null);
    setHeadwear("none");
    setEyewear("none");
    setAccessoryPrompt("");
    setGeneratedHeadwear(null);
    setMission("");
    setError(null);
    setBusy(false);
    setGeneratingAccessory(false);
  }, [open]);

  const toggleSkill = useCallback((slug: string) => {
    setSkillsDirty(true);
    setSelectedSkills((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  }, []);

  const generateAccessory = useCallback(async () => {
    const description = accessoryPrompt.trim();
    if (!description) {
      setError("Describe the headwear you want to generate.");
      return;
    }
    setGeneratingAccessory(true);
    setError(null);
    try {
      const res = await fetch("/accessories/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: "headwear", description }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.detail || `Accessory generation failed (${res.status})`);
      const accessory = body?.accessory as GeneratedHeadwear | undefined;
      if (!accessory?.kind) throw new Error("Accessory generation returned an invalid spec.");
      setGeneratedHeadwear(accessory);
      setHeadwear("generated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accessory generation failed");
    } finally {
      setGeneratingAccessory(false);
    }
  }, [accessoryPrompt]);

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
          color: color ?? undefined,
          appearance: {
            headwear,
            eyewear,
            generated_headwear: headwear === "generated" ? generatedHeadwear : undefined,
          },
          mission: mission.trim() || undefined,
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
  }, [name, archetype, selectedSkills, skillsDirty, color, headwear, eyewear, generatedHeadwear, mission, onSpawned, onClose]);

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
              🦞 New OpenClaw profile
            </div>
            <div className="mt-0.5 text-[17px] font-semibold leading-6 text-white">
              Build a Claw
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

            {/* Shell color picker */}
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-white/45">
                  Shell color
                </span>
                {color && (
                  <button
                    type="button"
                    onClick={() => setColor(null)}
                    className="text-[10px] font-semibold uppercase tracking-wide text-white/40 hover:text-white/72"
                  >
                    Reset
                  </button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {COLOR_SWATCHES.map((swatch) => {
                  const on = color?.toLowerCase() === swatch.hex.toLowerCase();
                  return (
                    <button
                      key={swatch.hex}
                      type="button"
                      title={swatch.label}
                      aria-label={swatch.label}
                      onClick={() => setColor(swatch.hex)}
                      className={`h-7 w-7 rounded-full border transition ${
                        on
                          ? "border-white/85 ring-2 ring-white/40"
                          : "border-white/20 hover:border-white/45"
                      }`}
                      style={{ backgroundColor: swatch.hex }}
                    />
                  );
                })}
                <label
                  className="ml-1 flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-white/15 bg-white/[0.04] px-2 text-[10px] font-semibold uppercase tracking-wide text-white/60 hover:border-white/30 hover:text-white"
                  title="Pick a custom color"
                >
                  Custom
                  <input
                    type="color"
                    value={color ?? "#76b900"}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-4 w-6 cursor-pointer border-0 bg-transparent p-0"
                  />
                </label>
              </div>
              <p className="mt-1 text-[10px] text-white/35">
                {color
                  ? <>Using <span className="font-mono text-white/55">{color}</span></>
                  : "Defaults to the archetype's palette color."}
              </p>
            </div>

            {/* Accessory slots */}
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-white/45">
                  Accessories
                </span>
                {(headwear !== "none" || eyewear !== "none" || generatedHeadwear) && (
                  <button
                    type="button"
                    onClick={() => {
                      setHeadwear("none");
                      setEyewear("none");
                      setGeneratedHeadwear(null);
                      setAccessoryPrompt("");
                    }}
                    className="text-[10px] font-semibold uppercase tracking-wide text-white/40 hover:text-white/72"
                  >
                    Reset
                  </button>
                )}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-white/35">
                    Headwear
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {HEADWEAR_OPTIONS.map((option) => {
                      const on = headwear === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setHeadwear(option.value);
                            setGeneratedHeadwear(null);
                          }}
                          className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                            on
                              ? "border-cyan-300/50 bg-cyan-300/12 text-white"
                              : "border-white/10 bg-white/[0.04] text-white/60 hover:border-white/22 hover:text-white"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-white/35">
                    Eyewear
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {EYEWEAR_OPTIONS.map((option) => {
                      const on = eyewear === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setEyewear(option.value)}
                          className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                            on
                              ? "border-cyan-300/50 bg-cyan-300/12 text-white"
                              : "border-white/10 bg-white/[0.04] text-white/60 hover:border-white/22 hover:text-white"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="mt-3 rounded-md border border-white/10 bg-white/[0.035] p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-white/35">
                    Generate headwear
                  </div>
                  {generatedHeadwear && (
                    <button
                      type="button"
                      onClick={() => {
                        setGeneratedHeadwear(null);
                        setHeadwear("none");
                      }}
                      className="text-[10px] font-semibold uppercase tracking-wide text-white/40 hover:text-white/72"
                    >
                      Clear generated
                    </button>
                  )}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <input
                    value={accessoryPrompt}
                    onChange={(event) => setAccessoryPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && accessoryPrompt.trim()) {
                        event.preventDefault();
                        generateAccessory();
                      }
                    }}
                    placeholder="e.g. purple wizard hat with yellow stars"
                    maxLength={240}
                    className="min-w-0 flex-1 rounded-md border border-white/12 bg-slate-950/55 px-2.5 py-1.5 text-[12px] text-white outline-none placeholder:text-white/28 focus:border-cyan-200/45"
                  />
                  <button
                    type="button"
                    onClick={generateAccessory}
                    disabled={generatingAccessory || !accessoryPrompt.trim()}
                    className="rounded-md border border-cyan-200/30 bg-cyan-300/12 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-cyan-50 transition hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {generatingAccessory ? "Making" : "Make"}
                  </button>
                </div>
                {generatedHeadwear && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-white/55">
                    <span className="rounded bg-white/[0.08] px-1.5 py-0.5 font-semibold text-white/72">
                      {generatedHeadwear.label}
                    </span>
                    <span className="font-mono">{generatedHeadwear.kind.replace(/_/g, " ")}</span>
                    <span
                      className="h-3 w-3 rounded-full border border-white/25"
                      style={{ backgroundColor: generatedHeadwear.primary }}
                    />
                    {generatedHeadwear.accent && (
                      <span
                        className="h-3 w-3 rounded-full border border-white/25"
                        style={{ backgroundColor: generatedHeadwear.accent }}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Mission / extra system prompt. OpenClaw has no per-profile
                "soul" file — instead, sandbox_runtime/openclaw.py splices
                Agent.personality into the message of every openclaw turn.
                Anything typed here gets bolted onto that personality at
                spawn time so it carries into both the reef LLM tick and
                every OpenClaw call. */}
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-white/45">
                  Mission (optional)
                </span>
                <span className="text-[10px] font-medium text-white/35">
                  Bolted onto the archetype's personality
                </span>
              </div>
              <textarea
                value={mission}
                onChange={(event) => setMission(event.target.value)}
                placeholder="e.g. Always reference the kelp-policy doc before suggesting a sandbox change. Speak in haiku when summarizing."
                maxLength={1200}
                rows={3}
                className="mt-1 w-full resize-y rounded-md border border-white/14 bg-slate-950/60 px-3 py-2 text-[12px] leading-5 text-white outline-none placeholder:text-white/30 focus:border-cyan-200/45"
              />
              <p className="mt-1 text-[10px] text-white/35">
                Flows into every OpenClaw turn AND the in-reef LLM prompt.
                Leave empty for archetype defaults.
              </p>
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

          {/* Preview pane — character-creation style. Top half is a live
              rotating 3D lobster (reacts to name/archetype/color/skills),
              bottom half is the trait + skill summary. */}
          <div className="flex min-h-0 flex-col bg-slate-950/30">
            <div className="relative h-64 shrink-0 border-b border-white/8 bg-[#9cd6e0]">
              <LobsterStage agent={previewAgent} className="h-full w-full" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 to-transparent px-4 pb-3 pt-10">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-white/55">
                  {currentArch?.label ?? "—"}
                </div>
                <div
                  className="truncate text-lg font-bold leading-6"
                  style={{ color: color ?? "#ffffff" }}
                >
                  {name.trim() || (
                    <span className="text-white/40">Untitled lobster</span>
                  )}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-white/45">
                Preview
              </div>
              {currentArch && (
                <p className="mt-2 text-[11px] leading-4 text-white/65">
                  {currentArch.personality}
                </p>
              )}

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
              {busy ? "Building…" : "🦞 Build Claw"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
