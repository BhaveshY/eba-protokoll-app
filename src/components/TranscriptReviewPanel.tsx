import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "../lib/clsx";
import { useT } from "../lib/i18n";
import {
  cleanSpeakerNames,
  collectSpeakerReviewItems,
  formatTimestamp,
} from "../lib/transcript";
import type { Segment } from "../lib/types";

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
  const t = useT();
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
      renameableSpeakers.filter((speaker) => !draftNames[speaker.id]?.trim())
        .length,
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
      className="fixed inset-0 z-40 bg-fg/25 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="mx-auto flex h-full w-full max-w-6xl animate-fadeInUp flex-col overflow-hidden rounded-card border border-line bg-bg-card shadow-cardHover"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-fg">
              {t("review.title")}
            </h2>
            <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-fg-muted">
              {t("review.description")}
            </p>
            <p className="mt-2 truncate font-mono text-[11px] text-fg-subtle">
              {basename(transcriptPath)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Meta
              label={t("review.meta.speakers")}
              value={String(renameableSpeakers.length)}
            />
            <Meta
              label={t("review.meta.pending")}
              value={String(pendingCount)}
              tone={pendingCount ? "warn" : "ok"}
            />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-5 overflow-hidden bg-bg-subtle p-5 lg:grid-cols-[360px,minmax(0,1fr)]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-bg-card">
            <header className="flex items-center justify-between border-b border-line px-5 py-3">
              <div>
                <h3 className="text-[13px] font-semibold tracking-tight text-fg">
                  {t("review.speakers.title")}
                </h3>
                <p className="mt-0.5 text-[11px] text-fg-subtle">
                  {t("review.speakers.subtitle")}
                </p>
              </div>
            </header>
            {renameableSpeakers.length === 0 ? (
              <div className="p-5 text-[12px] text-fg-muted">
                {t("review.speakers.empty")}
              </div>
            ) : (
              <div className="flex min-h-0 flex-col gap-2.5 overflow-auto p-4">
                {renameableSpeakers.map((speaker) => (
                  <article
                    key={speaker.id}
                    className={clsx(
                      "rounded-lg border p-3 transition-colors",
                      activeSpeakerId === speaker.id
                        ? "border-fg/40 bg-bg-subtle"
                        : "border-line bg-bg-card"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-semibold text-fg">
                          {speaker.id}
                        </div>
                        <div className="mt-0.5 text-[11px] text-fg-subtle">
                          {t("review.speakers.contributions", {
                            count: speaker.segmentCount,
                            duration: formatDuration(speaker.totalDurationSec),
                            timestamp: formatTimestamp(speaker.firstStart),
                          })}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-quiet px-2 py-1 text-[11px]"
                        onClick={() => setActiveSpeakerId(speaker.id)}
                      >
                        {t("review.speakers.focus")}
                      </button>
                    </div>

                    <label className="mt-2.5 block">
                      <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-wider text-fg-subtle">
                        {t("review.speakers.nameLabel")}
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
                        placeholder={t("review.speakers.namePlaceholder")}
                        autoFocus={speaker.id === firstUnnamedSpeakerId}
                      />
                    </label>

                    {speaker.samples.length > 0 && (
                      <div className="mt-3 grid gap-1">
                        {speaker.samples.map((sample, idx) => (
                          <p
                            key={`${speaker.id}-${idx}`}
                            className="rounded-md bg-bg-subtle px-2.5 py-1.5 text-[11.5px] italic leading-snug text-fg-muted"
                          >
                            „{sample}”
                          </p>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-bg-card">
            <header className="flex items-center justify-between border-b border-line px-5 py-3">
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold tracking-tight text-fg">
                  {t("review.preview.title")}
                </h3>
                <p className="mt-0.5 truncate text-[11px] text-fg-subtle">
                  {activeSpeakerId
                    ? t("review.preview.filtered", {
                        name: displaySpeakerName(activeSpeakerId, draftNames),
                      })
                    : t("review.preview.all")}
                </p>
              </div>
              {activeSpeakerId && (
                <button
                  type="button"
                  className="btn-quiet text-[11px]"
                  onClick={() => setActiveSpeakerId(null)}
                >
                  {t("review.preview.showAll")}
                </button>
              )}
            </header>

            <div className="border-b border-line bg-bg-subtle px-5 py-2 text-[11px] text-fg-muted">
              {t("review.preview.note")}
            </div>

            {previewSegments.length === 0 ? (
              <div className="p-6 text-center text-[12.5px] text-fg-muted">
                {t("review.preview.empty")}
              </div>
            ) : (
              <div className="flex min-h-0 flex-col gap-2 overflow-auto p-4">
                {previewSegments.map((segment, idx) => {
                  const displayName = displaySpeakerName(
                    segment.speaker,
                    draftNames
                  );
                  return (
                    <article
                      key={`${segment.start}-${segment.speaker}-${idx}`}
                      className={clsx(
                        "rounded-lg border px-4 py-3 transition-colors",
                        activeSpeakerId === segment.speaker
                          ? "border-fg/30 bg-bg-subtle"
                          : "border-line bg-bg-card"
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="rounded bg-bg-inset px-1.5 py-0.5 font-mono tabular-nums text-fg-muted">
                          {formatTimestamp(segment.start)}
                        </span>
                        <span className="text-[12px] font-semibold text-fg">
                          {displayName}
                        </span>
                        {segment.speaker !== displayName && (
                          <span className="text-fg-subtle">
                            · {segment.speaker}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-[13px] leading-6 text-fg">
                        {segment.text}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg-card px-6 py-4">
          <p className="text-[12px] text-fg-muted">
            {pendingCount === 0
              ? t("review.footer.allNamed")
              : t("review.footer.pending", { count: pendingCount })}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={resetNames}
              disabled={saving}
            >
              {t("review.action.reset")}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={onClose}
              disabled={saving}
            >
              {t("review.action.close")}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? t("review.action.saving") : t("review.action.save")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Meta({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "muted";
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg-card px-2.5 py-1 text-[11px]">
      <span className="text-fg-muted">{label}</span>
      <span
        className={clsx(
          "font-semibold",
          tone === "ok" && "text-success",
          tone === "warn" && "text-warn",
          tone === "muted" && "text-fg"
        )}
      >
        {value}
      </span>
    </span>
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
