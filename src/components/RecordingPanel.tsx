import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig } from "@shared/ipc";
import clsx from "../lib/clsx";
import { findDeviceByHint, listInputDevices } from "../lib/devices";
import { MeetingRecorder, type RecordingResult } from "../lib/recorder";
import { humanSize } from "../lib/transcript";
import { Card } from "./ui/Card";
import { RecordingDot } from "./ui/RecordingDot";

type Mode = "idle" | "recording" | "stopped" | "imported";

export interface LoadedAudio {
  blob: Blob;
  filename: string;
  isRecordedStereo: boolean;
  durationSec: number;
  source: "recorded" | "imported";
}

export function RecordingPanel({
  config,
  projectName,
  onProjectNameChange,
  loaded,
  disabled,
  onLoaded,
  onLog,
}: {
  config: AppConfig;
  projectName: string;
  onProjectNameChange: (value: string) => void;
  loaded: LoadedAudio | null;
  disabled?: boolean;
  onLoaded: (audio: LoadedAudio) => void;
  onLog: (level: "info" | "warn" | "error", msg: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [statusText, setStatusText] = useState(
    "Bereit zur Aufnahme."
  );
  const [dropActive, setDropActive] = useState(false);
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
    },
    []
  );

  useEffect(() => {
    if (!loaded) return;
    setMode(loaded.source === "imported" ? "imported" : "stopped");
    setElapsed(loaded.durationSec);
    setStatusText(
      loaded.source === "imported"
        ? "Datei bereit zur Transkription."
        : "Aufnahme bereit fuer Transkription."
    );
  }, [loaded]);

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
      setStatusText("Datei bereit zur Transkription.");
    },
    [onLoaded]
  );

  const startRecording = useCallback(async () => {
    if (disabled) return;
    setStatusText("Mikrofon wird geoeffnet...");
    let rec: MeetingRecorder | null = null;
    try {
      const devices = config.systemAudioDevice ? await listInputDevices() : [];
      const systemDev = config.systemAudioDevice
        ? findDeviceByHint(devices, config.systemAudioDevice)?.deviceId
        : undefined;
      rec = new MeetingRecorder({ systemDeviceId: systemDev });
      await rec.start();
      recorderRef.current = rec;
      setMode("recording");
      setElapsed(0);
      const startedAt = performance.now();
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((performance.now() - startedAt) / 1000));
      }, 500);
      setStatusText(
        systemDev
          ? "Aufnahme laeuft (Mikrofon + System-Audio)."
          : "Aufnahme laeuft (nur Mikrofon — kein System-Audio-Geraet)."
      );
    } catch (err) {
      rec?.abort();
      recorderRef.current?.abort();
      recorderRef.current = null;
      onLog("error", `record start: ${(err as Error).message}`);
      setStatusText(`Mikrofon-Fehler: ${(err as Error).message}`);
      setMode("idle");
    }
  }, [config.systemAudioDevice, disabled, onLog]);

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    clearTimer();
    setStatusText("Aufnahme wird abgeschlossen...");
    try {
      const result: RecordingResult = await rec.stop();
      recorderRef.current = null;
      setMode("stopped");
      const filename = `${projectName.trim() || "Besprechung"}.wav`;
      onLoaded({
        blob: result.stereo,
        filename,
        isRecordedStereo: result.usedSystemAudio,
        durationSec: result.durationSec,
        source: "recorded",
      });
      setStatusText("Aufnahme bereit fuer Transkription.");
    } catch (err) {
      rec.abort();
      recorderRef.current = null;
      setMode("idle");
      onLog("error", `record stop: ${(err as Error).message}`);
      setStatusText(`Fehler beim Stoppen: ${(err as Error).message}`);
    }
  }, [onLoaded, onLog, projectName]);

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
      setStatusText(`Import fehlgeschlagen: ${(err as Error).message}`);
    }
  }, [disabled, loadImportedAudio, onLog]);

  const handleDropImport = useCallback(
    (file: File) => {
      if (!supportsImport(file.name)) {
        setStatusText("Nicht unterstuetzte Datei. Bitte Audio oder Video importieren.");
        return;
      }
      loadImportedAudio(file, file.name);
      if (file.size === 0) {
        setStatusText("Die importierte Datei ist leer.");
      }
    },
    [loadImportedAudio]
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
        setStatusText("Mehrere Dateien erkannt. Die erste Datei wurde geladen.");
      }

      handleDropImport(file);
    },
    [disabled, handleDropImport, mode]
  );

  const isRecording = mode === "recording";
  const summary = loaded ? describeLoadedAudio(loaded) : "Keine Aufnahme geladen.";

  return (
    <Card
      className={clsx(
        "transition",
        dropActive && "border-brand bg-brand/5 shadow-cardHover"
      )}
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-2">
          <label className="text-xs font-medium text-fg-muted">
            Projektname
          </label>
          <input
            className="input"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            placeholder="Besprechung"
          />
        </div>

        <div className="flex flex-col items-center gap-3 py-2">
          <div className="flex items-center gap-2">
            <RecordingDot active={isRecording} />
            <span
              className={
                isRecording
                  ? "text-sm font-semibold text-danger"
                  : "text-sm font-semibold text-fg-muted"
              }
            >
              {isRecording ? "Aufnahme laeuft" : statusText}
            </span>
          </div>
          <div
            className={
              "font-mono text-5xl tabular-nums tracking-tight " +
              (isRecording ? "text-danger" : "text-fg")
            }
            aria-live="polite"
          >
            {fmtDuration(elapsed)}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            className={isRecording ? "btn-danger" : "btn-primary"}
            disabled={disabled}
            onClick={isRecording ? stopRecording : startRecording}
          >
            {isRecording ? "STOPPEN" : "AUFNAHME STARTEN"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={importFile}
            disabled={disabled || isRecording}
          >
            Datei importieren...
          </button>
        </div>

        <div
          className={clsx(
            "rounded-lg border border-dashed px-4 py-3 text-center text-xs transition",
            dropActive
              ? "border-brand bg-brand/5 text-brand"
              : "border-line bg-bg-inset text-fg-muted"
          )}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          Datei hier hineinziehen oder ueber "Datei importieren..." auswaehlen.
        </div>

        <p className="text-center text-xs text-fg-muted">{summary}</p>
      </div>
    </Card>
  );
}

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(ss)}`;
}

function describeLoadedAudio(audio: LoadedAudio): string {
  if (audio.source === "imported") {
    return `Importiert: ${audio.filename}  ·  ${humanSize(audio.blob.size)}`;
  }
  return `Aufnahme: ${fmtDuration(audio.durationSec)}  ·  ${humanSize(
    audio.blob.size
  )}  ·  ${audio.isRecordedStereo ? "Stereo (Mic+System)" : "Mono (nur Mic)"}`;
}

function hasFiles(data: DataTransfer | null): boolean {
  return Boolean(data?.types.includes("Files"));
}

function supportsImport(filename: string): boolean {
  return /\.(wav|mp3|m4a|mp4|mkv|ogg|flac|webm)$/i.test(filename);
}
