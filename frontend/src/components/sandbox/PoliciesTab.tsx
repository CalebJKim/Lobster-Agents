import type { NemoClawPolicyPreset } from "../../types";

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
}: PoliciesTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] leading-5 text-white/65">
          Toggle a preset to preview what the NemoClaw policy CLI would do.
          Nothing is applied until you click <span className="font-semibold text-white/82">Apply</span>.
        </p>
        <button
          type="button"
          onClick={onReload}
          className="rounded-md bg-white/[0.08] px-2.5 py-1 text-[11px] font-semibold text-white/72 hover:bg-white/[0.16] hover:text-white"
        >
          Reload
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-[12px] text-rose-100">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-300/24 bg-emerald-300/10 px-3 py-2 text-[12px] text-emerald-100">
          {notice}
        </div>
      )}

      {policies.length === 0 && !error ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-6 text-center text-[12px] text-white/55">
          Loading policies…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {policies.map((p) => {
            const isBusy = busy === p.name;
            const previewMatches = preview?.preset === p.name;
            const nextEnabled = previewMatches ? preview!.enabled : !p.enabled;
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
                    {isBusy ? "Working…" : `Preview turning ${nextEnabled ? "on" : "off"}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {preview && (
        <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/[0.08] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-cyan-100/85">
                Preview
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
                {busy === preview.preset ? "Applying…" : "Apply"}
              </button>
            </div>
          </div>
          {preview.output && (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-slate-950/40 px-3 py-2 font-mono text-[11px] leading-4 text-white/75">
              {preview.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
