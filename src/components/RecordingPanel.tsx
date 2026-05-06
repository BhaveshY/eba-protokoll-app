import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig, RecordingWidgetState } from "@shared/ipc";
import { assessAudioImport } from "@shared/audioLimits";
import clsx from "../lib/clsx";
import { listInputDevices } from "../lib/devices";
import { useT, type TranslateFn } from "../lib/i18n";
import {
  resolveRecordingAudioPlan,
  shouldListInputDevices,
  type RecordingIntent,
} from "../lib/recordingMode";
import {
  MeetingRecorder,
  type RecorderLevels,
  type RecordingResult,
} from "../lib/recorder";
import { humanSize, safeProject } from "../lib/transcript";
import { Card } from "./ui/Card";
import { RecordingDot } from "./ui/RecordingDot";

type Mode = "idle" | "recording" | "stopped" | "imported";

export interface LoadedAudio {
  blob: Blob;
  filename: string;
  isRecordedStereo: boolean;
  durationSec: number;
  source: "recorded" | "imported";
  recordingIntent?: RecordingIntent;
  recordingPath?: string;
  recordingSaveError?: string;
}

export function RecordingPanel({
  config,
  projectName,
  onProjectNameChange,
  loaded,
  disabled,
  transcribing,
  onLoaded,
  onTranscribeAudio,
  onLog,
}: {
  config: AppConfig;
  projectName: string;
  onProjectNameChange: (value: string) => void;
  loaded: LoadedAudio | null;
  disabled?: boolean;
  transcribing?: boolean;
  onLoaded: (audio: LoadedAudio) => void;
  onTranscribeAudio?: (audio: LoadedAudio) => Promise<boolean> | boolean;
  onLog: (level: "info" | "warn" | "error", msg: string) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("idle");
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [statusText, setStatusText] = useState<string>(() => t("record.status.ready"));
  const [dropActive, setDropActive] = useState(false);
  const [levels, setLevels] = useState<RecorderLevels>({
    mic: 0,
    system: 0,
    usedSystemAudio: false,
  });
  const recorderRef = useRef<MeetingRecorder | null>(null);
  const startingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const dragDepthRef = useRef(0);
  const recordingIntentRef = useRef<RecordingIntent>("meeting");

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(
    () => () => {
      clearTimer();
      recorderRef.current?.abort();
      recorderRef.current = null;
      startingRef.current = false;
      recordingIntentRef.current = "meeting";
      void window.eba.recordingWidget.hide();
    },
    []
  );

  // Re-translate the idle status when language changes.
  useEffect(() => {
    if (mode === "idle") setStatusText(t("record.status.ready"));
    else if (mode === "imported") setStatusText(t("record.status.readyToTranscribeFile"));
    else if (mode === "stopped" && loaded) setStatusText(statusForLoadedAudio(loaded, t));
    else if (mode === "stopped") setStatusText(t("record.status.readyToTranscribeRec"));
  }, [loaded, t, mode]);

  useEffect(() => {
    if (!loaded) return;
    setMode(loaded.source === "imported" ? "imported" : "stopped");
    setElapsed(loaded.durationSec);
    setStatusText(statusForLoadedAudio(loaded, t));
  }, [loaded, t]);

  const loadImportedAudio = useCallback(
    (blob: Blob, filename: string) => {
      onLoaded({
        blob,
        filename,
        isRecordedStereo: false,
        durationSec: 0,
        source: "imported",
      });
      setMode("imported");
      setStatusText(t("record.status.readyToTranscribeFile"));
    },
    [onLoaded, t]
  );

  const startRecording = useCallback(
    async (intent: RecordingIntent = "meeting") => {
      if (disabled || startingRef.current || recorderRef.current) return;
      startingRef.current = true;
      setStarting(true);
      setStatusText(t("record.status.opening"));
      setLevels({ mic: 0, system: 0, usedSystemAudio: false });
      let rec: MeetingRecorder | null = null;
      try {
        recordingIntentRef.current = intent;
        const devices = shouldListInputDevices(intent, config.systemAudioDevice)
          ? await listInputDevices()
          : [];
        const audioPlan = resolveRecordingAudioPlan(
          intent,
          window.eba.platform,
          devices,
          config.systemAudioDevice
        );
        rec = new MeetingRecorder({
          systemAudio:
            audioPlan.status === "minutes_only" ? undefined : audioPlan.source,
          onLevel: setLevels,
        });
        await rec.start();
        recorderRef.current = rec;
        startingRef.current = false;
        setStarting(false);
        setMode("recording");
        setElapsed(0);
        const startedAt = performance.now();
        timerRef.current = window.setInterval(() => {
          setElapsed(Math.floor((performance.now() - startedAt) / 1000));
        }, 500);
        if (audioPlan.status === "minutes_only") {
          setStatusText(t("record.status.minutesOnly"));
        } else if (audioPlan.status === "configured_missing") {
          setStatusText(
            t("record.status.systemDeviceMissing", { name: audioPlan.hint })
          );
        } else if (audioPlan.source && rec.systemAudioError) {
          setStatusText(
            t("record.status.systemDeviceFailed", { msg: rec.systemAudioError })
          );
        } else {
          setStatusText(
            rec.systemAudioActive
              ? t("record.status.micPlusSystem")
              : t("record.status.micOnly")
          );
        }
      } catch (err) {
        rec?.abort();
        recorderRef.current?.abort();
        recorderRef.current = null;
        startingRef.current = false;
        setStarting(false);
        recordingIntentRef.current = "meeting";
        onLog("error", `record start: ${(err as Error).message}`);
        setStatusText(t("record.status.micError", { msg: (err as Error).message }));
        setLevels({ mic: 0, system: 0, usedSystemAudio: false });
        setMode("idle");
      }
    },
    [config.systemAudioDevice, disabled, onLog, t]
  );

  const startMinutesOnlyRecording = useCallback(async () => {
    if (disabled || startingRef.current || recorderRef.current) return;
    const ok = window.confirm(t("record.minutes.confirm"));
    if (!ok) return;
    await startRecording("minutes");
  }, [disabled, startRecording, t]);

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    clearTimer();
    setStatusText(t("record.status.finishing"));
    try {
      const recordingIntent = recordingIntentRef.current;
      const result: RecordingResult = await rec.stop();
      recorderRef.current = null;
      recordingIntentRef.current = "meeting";
      setMode("stopped");
      const filename = recordingFilename(projectName, result.extension);
      let recordingPath = "";
      let recordingSaveError = "";
      try {
        recordingPath = await window.eba.fs.saveRecording(
          config.outputDir,
          filename,
          await result.stereo.arrayBuffer()
        );
      } catch (err) {
        recordingSaveError = (err as Error).message;
        onLog("error", `record save: ${recordingSaveError}`);
      }
      const audio: LoadedAudio = {
        blob: result.stereo,
        filename,
        isRecordedStereo: result.usedSystemAudio,
        durationSec: result.durationSec,
        source: "recorded",
        recordingIntent,
        ...(recordingPath ? { recordingPath } : {}),
        ...(recordingSaveError ? { recordingSaveError } : {}),
      };
      onLoaded(audio);
      setLevels({ mic: 0, system: 0, usedSystemAudio: false });
      if (onTranscribeAudio) {
        setStatusText(t("record.status.autoTranscribing"));
        try {
          const started = await onTranscribeAudio(audio);
          if (!started) setStatusText(statusForLoadedAudio(audio, t));
        } catch (err) {
          onLog("error", `auto transcribe: ${(err as Error).message}`);
          setStatusText(statusForLoadedAudio(audio, t));
        }
      }
    } catch (err) {
      rec.abort();
      recorderRef.current = null;
      recordingIntentRef.current = "meeting";
      setMode("idle");
      setLevels({ mic: 0, system: 0, usedSystemAudio: false });
      onLog("error", `record stop: ${(err as Error).message}`);
      setStatusText(t("record.status.stopError", { msg: (err as Error).message }));
    }
  }, [config.outputDir, onLoaded, onLog, onTranscribeAudio, projectName, t]);

  useEffect(
    () =>
      window.eba.recordingWidget.onStopRequested(() => {
        void stopRecording();
      }),
    [stopRecording]
  );

  const importFile = useCallback(async () => {
    if (disabled) return;
    const p = await window.eba.fs.chooseAudioFile();
    if (!p) return;
    try {
      const bytes = await window.eba.fs.readFileAsBytes(p);
      const filename = p.split(/[/\\]/).pop() || "audio";
      const assessment = assessAudioImport(filename, bytes.byteLength);
      if (!assessment.ok) {
        setStatusText(statusForImportAssessment(assessment, t));
        return;
      }
      loadImportedAudio(new Blob([bytes]), filename);
      if (assessment.warning) {
        setStatusText(statusForImportAssessment(assessment, t));
      }
    } catch (err) {
      onLog("error", `import: ${(err as Error).message}`);
      setStatusText(t("record.status.importError", { msg: (err as Error).message }));
    }
  }, [disabled, loadImportedAudio, onLog, t]);

  const handleDropImport = useCallback(
    (file: File) => {
      const assessment = assessAudioImport(file.name, file.size);
      if (!assessment.ok) {
        setStatusText(statusForImportAssessment(assessment, t));
        return;
      }
      loadImportedAudio(file, file.name);
      if (assessment.warning) {
        setStatusText(statusForImportAssessment(assessment, t));
      }
    },
    [loadImportedAudio, t]
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (disabled || mode === "recording" || !hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDropActive(true);
    },
    [disabled, mode]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (disabled || mode === "recording" || !hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropActive(true);
    },
    [disabled, mode]
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDropActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (disabled || mode === "recording" || !hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setDropActive(false);

      const [file] = Array.from(e.dataTransfer.files);
      if (!file) return;

      if (e.dataTransfer.files.length > 1) {
        setStatusText(t("record.status.multipleDropped"));
      }

      handleDropImport(file);
    },
    [disabled, handleDropImport, mode, t]
  );

  const isRecording = mode === "recording";
  const isStartDisabled = Boolean(disabled || starting);
  const summary = loaded ? describeLoadedAudio(loaded, t) : null;

  useEffect(() => {
    if (!isRecording) {
      void window.eba.recordingWidget.hide();
      return;
    }
    void window.eba.recordingWidget.show(
      toRecordingWidgetState({ elapsed, levels, statusText, t })
    );
    return () => {
      void window.eba.recordingWidget.hide();
    };
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording) return;
    window.eba.recordingWidget.update(
      toRecordingWidgetState({ elapsed, levels, statusText, t })
    );
  }, [elapsed, isRecording, levels, statusText, t]);

  return (
    <Card
      className={clsx(
        "transition-colors duration-150",
        dropActive && "border-fg/40 bg-fg/[0.02]"
      )}
    >
      <div className="flex flex-col gap-4">
        {/* Project input */}
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto] md:items-end">
          <div className="grid gap-1.5">
            <label
              htmlFor="projectName"
              className="text-[11px] font-medium text-fg-muted"
            >
              {t("record.projectName")}
            </label>
            <input
              id="projectName"
              className="input"
              value={projectName}
              onChange={(e) => onProjectNameChange(e.target.value)}
              placeholder={t("record.projectName.placeholder")}
            />
          </div>
          {summary && (
            <p className="rounded-lg border border-line bg-bg-subtle px-3 py-2 text-[11px] leading-relaxed text-fg-subtle md:max-w-[320px]">
              {summary}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-line bg-bg-subtle/70 p-4 sm:p-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1fr)_minmax(220px,0.8fr)] lg:items-center">
            {/* Timer + status */}
            <div className="flex flex-col items-center gap-2 text-center lg:items-start lg:text-left">
              <div
                className={clsx(
                  "font-mono text-[44px] leading-none tabular-nums tracking-tight transition-colors duration-150 sm:text-[50px]",
                  isRecording ? "text-fg" : "text-fg-subtle"
                )}
                aria-live="polite"
              >
                {fmtDuration(elapsed)}
              </div>
              <div className="flex max-w-full items-center gap-2 text-[11.5px]">
                <RecordingDot active={isRecording} />
                <span
                  className={clsx(
                    "min-w-0 break-words font-medium leading-snug",
                    isRecording ? "text-danger" : "text-fg-muted"
                  )}
                >
                  {statusText}
                </span>
              </div>
            </div>

            {/* Live levels */}
            <div className="border-y border-line py-4 lg:border-y-0 lg:border-l lg:py-0 lg:pl-6">
              <LevelBars level={levels.mic} active={isRecording} />
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <LevelLegend
                  label={t("record.widget.mic")}
                  active={isRecording}
                  value={levels.mic}
                />
                <LevelLegend
                  label={t("record.widget.system")}
                  active={levels.usedSystemAudio}
                  value={levels.system}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2">
              {isRecording ? (
                <button
                  type="button"
                  className="btn-danger py-2.5"
                  onClick={() => void stopRecording()}
                >
                  {t("record.action.stop")}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-primary py-2.5"
                    disabled={isStartDisabled}
                    onClick={() => void startRecording("meeting")}
                  >
                    {transcribing
                      ? t("app.action.transcribing")
                      : t("record.action.startWorkflow")}
                  </button>
                  <button
                    type="button"
                    className={clsx(
                      "btn-ghost py-2.5 text-warn",
                      "border-warn/40 bg-warn-soft/70",
                      "hover:border-warn/60 hover:bg-warn-soft"
                    )}
                    disabled={isStartDisabled}
                    onClick={() => void startMinutesOnlyRecording()}
                  >
                    {t("record.action.minutesOnly")}
                  </button>
                </>
              )}
              {loaded && !isRecording && !transcribing && onTranscribeAudio && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => void onTranscribeAudio(loaded)}
                >
                  {loaded.source === "imported"
                    ? t("record.action.transcribeFile")
                    : t("record.action.transcribeRecording")}
                </button>
              )}
              <button
                type="button"
                className="btn-ghost"
                onClick={importFile}
                disabled={isStartDisabled || isRecording}
                title={t("record.import.title")}
              >
                {t("record.action.import")}
              </button>
            </div>
          </div>
        </div>

        {/* Dropzone */}
        <div
          className={clsx(
            "rounded-lg border border-dashed px-4 py-3 text-center text-[11.5px] transition-colors duration-150",
            dropActive
              ? "border-fg/50 bg-bg-subtle text-fg"
              : "border-line bg-bg-subtle text-fg-muted"
          )}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dropActive ? t("record.drop.active") : t("record.drop.idle")}
        </div>
      </div>
    </Card>
  );
}

function LevelBars({ level, active }: { level: number; active: boolean }) {
  const count = 28;
  const lit = active ? Math.max(1, Math.round(Math.max(0, Math.min(1, level)) * count)) : 1;

  return (
    <div className="flex h-10 items-center gap-1" aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={clsx(
            "h-7 w-1 rounded-full transition-colors duration-150",
            index < lit
              ? active
                ? "bg-success"
                : "bg-line-strong"
              : "bg-line"
            )}
        />
      ))}
    </div>
  );
}

function LevelLegend({
  label,
  active,
  value,
}: {
  label: string;
  active: boolean;
  value: number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[11px] text-fg-muted">
      <span
        className={clsx(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          active || value > 0.02 ? "bg-success" : "bg-line-strong"
        )}
        aria-hidden
      />
      <span className="truncate font-medium">{label}</span>
    </div>
  );
}

function toRecordingWidgetState({
  elapsed,
  levels,
  statusText,
  t,
}: {
  elapsed: number;
  levels: RecorderLevels;
  statusText: string;
  t: TranslateFn;
}): RecordingWidgetState {
  return {
    elapsed,
    statusText,
    micLevel: levels.mic,
    systemLevel: levels.system,
    usedSystemAudio: levels.usedSystemAudio,
    labels: {
      title: t("record.widget.title"),
      stop: t("record.widget.stop"),
      mic: t("record.widget.mic"),
      system: t("record.widget.system"),
    },
  };
}

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(ss)}`;
}

function describeLoadedAudio(audio: LoadedAudio, t: TranslateFn): string {
  if (audio.source === "imported") {
    return t("record.summary.imported", {
      filename: audio.filename,
      size: humanSize(audio.blob.size),
    });
  }
  return t("record.summary.recorded", {
    duration: fmtDuration(audio.durationSec),
    size: humanSize(audio.blob.size),
    mode:
      audio.recordingIntent === "minutes"
        ? t("record.summary.modeMinutes")
        : audio.isRecordedStereo
          ? t("record.summary.modeStereo")
          : t("record.summary.modeMono"),
  });
}

function statusForLoadedAudio(audio: LoadedAudio, t: TranslateFn): string {
  if (audio.source === "imported") return t("record.status.readyToTranscribeFile");
  if (audio.recordingSaveError) {
    return t("record.status.saveError", { msg: audio.recordingSaveError });
  }
  if (audio.recordingPath) return t("record.status.savedRecording");
  return t("record.status.readyToTranscribeRec");
}

function recordingFilename(projectName: string, extension: string): string {
  const project = safeProject(projectName.trim() || "Besprechung").trim();
  const ext = extension.replace(/^\.+/, "").replace(/[^a-z0-9]/gi, "") || "webm";
  return `${project || "Besprechung"}_${timestampForFile()}.${ext}`;
}

function timestampForFile(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function hasFiles(data: DataTransfer | null): boolean {
  return Boolean(data?.types.includes("Files"));
}

function statusForImportAssessment(
  assessment: ReturnType<typeof assessAudioImport>,
  t: TranslateFn
): string {
  if (assessment.ok) {
    return assessment.warning
      ? t("record.status.largeFile", { size: humanSize(assessment.size) })
      : t("record.status.readyToTranscribeFile");
  }
  if (assessment.code === "empty") return t("record.status.empty");
  if (assessment.code === "too_large") {
    return t("record.status.tooLarge", { size: humanSize(assessment.size) });
  }
  return t("record.status.unsupported");
}
