import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig } from "@shared/ipc";
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
}

export function RecordingPanel({
  config,
  disabled,
  onLoaded,
  onLog,
}: {
  config: AppConfig;
  disabled?: boolean;
  onLoaded: (audio: LoadedAudio) => void;
  onLog: (level: "info" | "warn" | "error", msg: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [project, setProject] = useState(defaultProject());
  const [elapsed, setElapsed] = useState(0);
  const [statusText, setStatusText] = useState(
    "Bereit zur Aufnahme."
  );
  const [summary, setSummary] = useState<string>("Keine Aufnahme geladen.");
  const recorderRef = useRef<MeetingRecorder | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => clearTimer(), []);

  const startRecording = useCallback(async () => {
    if (disabled) return;
    setStatusText("Mikrofon wird geoeffnet...");
    try {
      const devices = await listInputDevices();
      const hinted = config.systemAudioDevice
        ? findDeviceByHint(devices, config.systemAudioDevice)
        : undefined;
      const systemDev = hinted?.deviceId;

      const rec = new MeetingRecorder({ systemDeviceId: systemDev });
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
      const filename = `${project || "Besprechung"}.wav`;
      onLoaded({
        blob: result.stereo,
        filename,
        isRecordedStereo: result.usedSystemAudio,
        durationSec: result.durationSec,
      });
      setSummary(
        `Aufnahme: ${fmtDuration(result.durationSec)}  ·  ${humanSize(
          result.stereo.size
        )}  ·  ${result.usedSystemAudio ? "Stereo (Mic+System)" : "Mono (nur Mic)"}`
      );
      setStatusText("Aufnahme bereit fuer Transkription.");
    } catch (err) {
      onLog("error", `record stop: ${(err as Error).message}`);
      setStatusText(`Fehler beim Stoppen: ${(err as Error).message}`);
    }
  }, [onLoaded, onLog, project]);

  const importFile = useCallback(async () => {
    if (disabled) return;
    const p = await window.eba.fs.chooseAudioFile();
    if (!p) return;
    try {
      const bytes = await window.eba.fs.readFileAsBytes(p);
      const blob = new Blob([bytes]);
      const filename = p.split(/[/\\]/).pop() || "audio";
      onLoaded({
        blob,
        filename,
        isRecordedStereo: false,
        durationSec: 0,
      });
      setMode("imported");
      setSummary(`Importiert: ${filename}  ·  ${humanSize(blob.size)}`);
      setStatusText("Datei bereit zur Transkription.");
    } catch (err) {
      onLog("error", `import: ${(err as Error).message}`);
      setStatusText(`Import fehlgeschlagen: ${(err as Error).message}`);
    }
  }, [disabled, onLoaded, onLog]);

  const isRecording = mode === "recording";

  return (
    <Card>
      <div className="flex flex-col gap-6">
        <div className="grid gap-2">
          <label className="text-xs font-medium text-fg-muted">
            Projektname
          </label>
          <input
            className="input"
            value={project}
            onChange={(e) => setProject(e.target.value)}
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

        <p className="text-center text-xs text-fg-muted">{summary}</p>
      </div>
    </Card>
  );
}

function defaultProject(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Besprechung_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(ss)}`;
}
