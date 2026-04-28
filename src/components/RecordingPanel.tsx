import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig, RecordingWidgetState } from "@shared/ipc";
import clsx from "../lib/clsx";
import { findDeviceByHint, listInputDevices } from "../lib/devices";
import { useT, type TranslateFn } from "../lib/i18n";
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
  const [elapsed, setElapsed] = useState(0);
  const [statusText, setStatusText] = useState<string>(() => t("record.status.ready"));
  const [dropActive, setDropActive] = useState(false);
  const [levels, setLevels] = useState<RecorderLevels>({
    mic: 0,
    system: 0,
    usedSystemAudio: false,
  });
  const recorderRef = useRef<MeetingRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const dragDepthRef = useRef(0);

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

  const startRecording = useCallback(async () => {
    if (disabled) return;
    setStatusText(t("record.status.opening"));
    setLevels({ mic: 0, system: 0, usedSystemAudio: false });
    let rec: MeetingRecorder | null = null;
    try {
      const devices = config.systemAudioDevice ? await listInputDevices() : [];
      const systemDev = config.systemAudioDevice
        ? findDeviceByHint(devices, config.systemAudioDevice)?.deviceId
        : undefined;
      rec = new MeetingRecorder({ systemDeviceId: systemDev, onLevel: setLevels });
      await rec.start();
      recorderRef.current = rec;
      setMode("recording");
      setElapsed(0);
      const startedAt = performance.now();
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((performance.now() - startedAt) / 1000));
      }, 500);
      setStatusText(
        systemDev ? t("record.status.micPlusSystem") : t("record.status.micOnly")
      );
    } catch (err) {
      rec?.abort();
      recorderRef.current?.abort();
      recorderRef.current = null;
      onLog("error", `record start: ${(err as Error).message}`);
      setStatusText(t("record.status.micError", { msg: (err as Error).message }));
      setLevels({ mic: 0, system: 0, usedSystemAudio: false });
      setMode("idle");
    }
  }, [config.systemAudioDevice, disabled, onLog, t]);

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    clearTimer();
    setStatusText(t("record.status.finishing"));
    try {
      const result: RecordingResult = await rec.stop();
      recorderRef.current = null;
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
      loadImportedAudio(new Blob([bytes]), filename);
    } catch (err) {
      onLog("error", `import: ${(err as Error).message}`);
      setStatusText(t("record.status.importError", { msg: (err as Error).message }));
    }
  }, [disabled, loadImportedAudio, onLog, t]);

  const handleDropImport = useCallback(
    (file: File) => {
      if (!supportsImport(file.name)) {
        setStatusText(t("record.status.unsupported"));
        return;
      }
      loadImportedAudio(file, file.name);
      if (file.size === 0) {
        setStatusText(t("record.status.empty"));
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
      <div className="flex flex-col gap-6">
        {/* Project input */}
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

        <div className="divider" />

        {/* Timer + status */}
        <div className="flex flex-col items-center gap-3 py-1">
          <div className="flex items-center gap-2 text-[11.5px]">
            <RecordingDot active={isRecording} />
            <span
              className={clsx(
                "font-medium tracking-tight",
                isRecording ? "text-danger" : "text-fg-muted"
              )}
            >
              {isRecording ? t("record.status.recordingLabel") : statusText}
            </span>
          </div>
          <div
            className={clsx(
              "font-mono text-[44px] leading-none tabular-nums tracking-tight transition-colors duration-150",
              isRecording ? "text-fg" : "text-fg-subtle"
            )}
            aria-live="polite"
          >
            {fmtDuration(elapsed)}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className={clsx(isRecording ? "btn-danger" : "btn-primary", "py-2.5")}
            disabled={disabled && !isRecording}
            onClick={isRecording ? stopRecording : startRecording}
          >
            {transcribing
              ? t("app.action.transcribing")
              : isRecording
                ? t("record.action.stop")
                : t("record.action.startWorkflow")}
          </button>
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
            disabled={disabled || isRecording}
            title={t("record.import.title")}
          >
            {t("record.action.import")}
          </button>
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

        {summary && (
          <p className="-mt-2 text-center text-[11px] leading-relaxed text-fg-subtle">
            {summary}
          </p>
        )}
      </div>
    </Card>
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
    mode: audio.isRecordedStereo
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

function supportsImport(filename: string): boolean {
  return /\.(wav|mp3|m4a|mp4|mkv|ogg|flac|webm)$/i.test(filename);
}
