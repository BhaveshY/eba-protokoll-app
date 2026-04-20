import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "../lib/clsx";
import {
  cleanSpeakerNames,
  collectSpeakerReviewItems,
  formatTimestamp,
} from "../lib/transcript";
import type { Segment } from "../lib/types";
import { Card } from "./ui/Card";

export function TranscriptReviewPanel({
  segments,
  transcriptPath,
  initialNames,
  onClose,
  onSave,
}: {
  segments: Segment[];
  transcriptPath: string;
  initialNames: Record<string, string>;
  onClose: () => void;
  onSave: (names: Record<string, string>) => Promise<void>;
}) {
  const cleanedInitialNames = useMemo(
    () => cleanSpeakerNames(initialNames),
    [initialNames]
  );
  const [draftNames, setDraftNames] = useState<Record<string, string>>(
    cleanedInitialNames
  );
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftNames(cleanedInitialNames);
  }, [cleanedInitialNames, transcriptPath]);

  const speakers = useMemo(
    () => collectSpeakerReviewItems(segments, draftNames),
    [segments, draftNames]
  );
  const renameableSpeakers = useMemo(
    () => speakers.filter((speaker) => !speaker.isFixed),
    [speakers]
  );
  const firstUnnamedSpeakerId = useMemo(
    () =>
      renameableSpeakers.find((speaker) => !draftNames[speaker.id]?.trim())?.id ??
      renameableSpeakers[0]?.id ??
      null,
    [draftNames, renameableSpeakers]
  );

  useEffect(() => {
    if (!renameableSpeakers.length) {
      setActiveSpeakerId(null);
      return;
    }
    if (
      activeSpeakerId &&
      renameableSpeakers.some((speaker) => speaker.id === activeSpeakerId)
    ) {
      return;
    }
    setActiveSpeakerId(firstUnnamedSpeakerId);
  }, [activeSpeakerId, firstUnnamedSpeakerId, renameableSpeakers]);

  const previewSegments = useMemo(() => {
    if (!activeSpeakerId) return segments;
    return segments.filter((segment) => segment.speaker === activeSpeakerId);
  }, [activeSpeakerId, segments]);

  const pendingCount = useMemo(
    () =>
      renameableSpeakers.filter((speaker) => !draftNames[speaker.id]?.trim()).length,
    [draftNames, renameableSpeakers]
  );

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(cleanSpeakerNames(draftNames));
    } finally {
      setSaving(false);
    }
  }, [draftNames, onSave]);

  const resetNames = useCallback(() => {
    setDraftNames(cleanedInitialNames);
  }, [cleanedInitialNames]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void save();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, save]);

  return (
    <div
      className="fixed inset-0 z-40 bg-black/35 p-5"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-card border border-line bg-bg-app shadow-cardHover">
        <header className="border-b border-line bg-bg-card px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-fg">
                Transkript pruefen
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                Das Transkript ist bereits gespeichert. Hier ordnest du Sprecher
                sauber zu und ueberschreibst nur die Namen im Export.
              </p>
              <p className="mt-2 truncate text-xs text-fg-muted">
                Datei: {basename(transcriptPath)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="chip">
                <span className="text-fg-muted">Sprecher:</span>
                <span className="text-fg">{renameableSpeakers.length}</span>
              </span>
              <span className="chip">
                <span className="text-fg-muted">Offen:</span>
                <span className={clsx(pendingCount ? "text-warn" : "text-success")}>
                  {pendingCount}
                </span>
              </span>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-5 overflow-hidden p-5 lg:grid-cols-[360px,minmax(0,1fr)]">
          <Card
            title="Sprecher"
            subtitle="Namen gelten nur fuer dieses Transkript."
            className="flex min-h-0 flex-col overflow-hidden"
          >
            {renameableSpeakers.length === 0 ? (
              <div className="rounded-lg border border-line bg-bg-inset px-4 py-3 text-sm text-fg-muted">
                Keine umbenennbaren Sprecher erkannt.
              </div>
            ) : (
              <div className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
                {renameableSpeakers.map((speaker) => (
                  <section
                    key={speaker.id}
                    className={clsx(
                      "rounded-lg border p-3 transition",
                      activeSpeakerId === speaker.id
                        ? "border-brand bg-brand/5"
                        : "border-line bg-bg-card"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-fg">
                          {speaker.id}
                        </div>
                        <div className="mt-1 text-xs text-fg-muted">
                          {speaker.segmentCount} Beitraege ·{" "}
                          {formatDuration(speaker.totalDurationSec)} · ab{" "}
                          {formatTimestamp(speaker.firstStart)}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-ghost px-2 py-1 text-xs"
                        onClick={() => setActiveSpeakerId(speaker.id)}
                      >
                        Fokus
                      </button>
                    </div>

                    <label className="mt-3 block">
                      <span className="mb-1 block text-xs font-medium text-fg-muted">
                        Name im Export
                      </span>
                      <input
                        className={clsx(
                          "input",
                          !draftNames[speaker.id]?.trim() &&
                            "border-warn/40 focus:border-warn focus:ring-warn/20"
                        )}
                        value={draftNames[speaker.id] ?? ""}
                        onChange={(e) =>
                          setDraftNames((current) => ({
                            ...current,
                            [speaker.id]: e.target.value,
                          }))
                        }
                        placeholder="z.B. Herr Mueller"
                        autoFocus={speaker.id === firstUnnamedSpeakerId}
                      />
                    </label>

                    <div className="mt-3 grid gap-1.5">
                      {speaker.samples.map((sample, idx) => (
                        <p
                          key={`${speaker.id}-${idx}`}
                          className="rounded-md bg-bg-inset px-2.5 py-2 text-xs italic text-fg-muted"
                        >
                          "{sample}"
                        </p>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </Card>

          <Card
            title="Live-Vorschau"
            subtitle={
              activeSpeakerId
                ? `${displaySpeakerName(activeSpeakerId, draftNames)} im Verlauf`
                : "Alle Segmente mit den aktuellen Namen"
            }
            right={
              activeSpeakerId ? (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setActiveSpeakerId(null)}
                >
                  Alle anzeigen
                </button>
              ) : undefined
            }
            className="flex min-h-0 flex-col overflow-hidden"
          >
            <div className="mb-3 rounded-lg border border-line bg-bg-inset px-3 py-2 text-xs text-fg-muted">
              "Ich" bleibt fix. Leere Felder lassen den Originalnamen wie
              "Sprecher 1" bestehen.
            </div>

            {previewSegments.length === 0 ? (
              <div className="rounded-lg border border-line bg-bg-card px-4 py-6 text-center text-sm text-fg-muted">
                Keine Segmente fuer diese Auswahl.
              </div>
            ) : (
              <div className="flex min-h-0 flex-col gap-2 overflow-auto pr-1">
                {previewSegments.map((segment, idx) => {
                  const displayName = displaySpeakerName(segment.speaker, draftNames);
                  return (
                    <article
                      key={`${segment.start}-${segment.speaker}-${idx}`}
                      className={clsx(
                        "rounded-lg border px-4 py-3",
                        activeSpeakerId === segment.speaker
                          ? "border-brand/40 bg-brand/5"
                          : "border-line bg-bg-card"
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded bg-bg-inset px-2 py-1 font-mono text-fg-muted">
                          {formatTimestamp(segment.start)}
                        </span>
                        <span className="font-semibold text-fg">
                          {displayName}
                        </span>
                        {segment.speaker !== displayName && (
                          <span className="text-fg-muted">
                            ({segment.speaker})
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-fg">
                        {segment.text}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg-card px-6 py-4">
          <p className="text-xs text-fg-muted">
            {pendingCount === 0
              ? "Alle erkannten Sprecher haben einen Namen."
              : `${pendingCount} Sprecher verwenden noch Platzhalter.`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={resetNames}
              disabled={saving}
            >
              Zuruecksetzen
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={onClose}
              disabled={saving}
            >
              Unveraendert schliessen
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? "Speichert..." : "Transkript aktualisieren"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function displaySpeakerName(
  speakerId: string,
  names: Record<string, string>
): string {
  return names[speakerId]?.trim() || speakerId;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs ? `${mins}m ${secs}s` : `${mins}m`;
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}
