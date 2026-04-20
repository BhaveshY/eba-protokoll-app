import { useEffect, useMemo, useState } from "react";
import { sampleQuotes } from "../lib/transcript";
import type { Segment } from "../lib/types";

export function SpeakerRenameDialog({
  segments,
  existing,
  onCancel,
  onConfirm,
}: {
  segments: Segment[];
  existing: Record<string, string>;
  onCancel: () => void;
  onConfirm: (names: Record<string, string>) => void;
}) {
  const quotes = useMemo(() => sampleQuotes(segments), [segments]);
  const speakers = Object.keys(quotes);
  const [names, setNames] = useState<Record<string, string>>({ ...existing });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const submit = () => {
    const next: Record<string, string> = { ...existing };
    for (const [id, val] of Object.entries(names)) {
      if (val.trim()) next[id] = val.trim();
    }
    onConfirm(next);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="card max-h-full w-full max-w-xl overflow-hidden p-0">
        <header className="border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-fg">Sprecher zuordnen</h2>
          <p className="text-xs text-fg-muted">
            Vergib echte Namen. "Ich" bleibt fest auf den Protokollersteller.
          </p>
        </header>

        {speakers.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-fg-muted">
            Keine weiteren Sprecher erkannt.
          </div>
        ) : (
          <div className="max-h-[55vh] overflow-auto px-6 py-4">
            <div className="flex flex-col gap-4">
              {speakers.map((id) => (
                <div key={id} className="rounded-lg border border-line p-3">
                  <div className="text-xs font-semibold text-fg">{id}</div>
                  <p className="mt-1 text-xs italic text-fg-muted">
                    "{quotes[id]}"
                  </p>
                  <input
                    className="input mt-2"
                    value={names[id] ?? existing[id] ?? ""}
                    onChange={(e) =>
                      setNames((m) => ({ ...m, [id]: e.target.value }))
                    }
                    placeholder="Name / Bezeichnung"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-bg-app px-6 py-3">
          <button className="btn-ghost" onClick={onCancel}>
            Abbrechen
          </button>
          <button className="btn-primary" onClick={submit}>
            Uebernehmen
          </button>
        </footer>
      </div>
    </div>
  );
}
