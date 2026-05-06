import { useCallback, useMemo, useRef, useState } from "react";
import {
  TranscriptionCancelled,
  TranscriptionError,
} from "../lib/deepgram";
import {
  formatSubRip,
  extractDeepgramSummary,
  formatSummary,
  formatTranscript,
  responseToSegments,
  safeProject,
} from "../lib/transcript";
import { SingleFlight } from "../lib/singleFlight";
import type { Segment, TranscribeStage } from "../lib/types";
import type { AppConfig } from "@shared/ipc";

export interface TranscriptionState {
  stage: TranscribeStage | null;
  status: string;
  uploadPct: number;
  error: string | null;
  segments: Segment[];
  transcriptPath: string;
  subtitlePath: string;
}

export interface StartArgs {
  config: AppConfig;
  audioBlob: Blob;
  filename: string;
  isRecordedStereo: boolean;
  keyterms: string[];
  project: string;
}

export function useTranscription() {
  const [state, setState] = useState<TranscriptionState>({
    stage: null,
    status: "Bereit.",
    uploadPct: 0,
    error: null,
    segments: [],
    transcriptPath: "",
    subtitlePath: "",
  });

  const abortRef = useRef<AbortController | null>(null);
  const singleFlightRef = useRef(new SingleFlight());

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    void window.eba.transcription.cancel();
  }, []);

  const start = useCallback(
    (args: StartArgs): boolean => {
      const controller = new AbortController();
      const started = singleFlightRef.current.run(async () => {
        abortRef.current = controller;

        setState({
          stage: "prepare",
          status: "Audio vorbereiten",
          uploadPct: 0,
          error: null,
          segments: [],
          transcriptPath: "",
          subtitlePath: "",
        });

        try {
          await window.eba.fs.ensureOutputDirs(args.config.outputDir);

          setState((s) => ({
            ...s,
            stage: "upload",
            status: `Hochladen (${(args.audioBlob.size / 1_048_576).toFixed(1)} MB)`,
          }));
          const audioBytes = await args.audioBlob.arrayBuffer();
          if (controller.signal.aborted) throw new TranscriptionCancelled();

          const response = await window.eba.transcription.transcribe({
            audioBytes,
            filename: args.filename,
            config: args.config,
            isRecordedStereo: args.isRecordedStereo,
            keyterms: args.keyterms,
          });

          setState((s) => ({
            ...s,
            stage: "deepgram",
            status: "Antwort verarbeiten",
            uploadPct: 100,
          }));

          const segments = responseToSegments(response, args.isRecordedStereo);
          if (!segments.length) {
            throw new TranscriptionError(
              "Deepgram hat keinen Transkript-Text zurueckgegeben. Die Aufnahme wurde nicht als leeres Transkript gespeichert."
            );
          }

          setState((s) => ({ ...s, stage: "save", status: "Transkript speichern" }));

          const stem = `${safeProject(args.project)}_${timestampForFile()}`;
          const text = formatTranscript(segments, {});
          const files = [
            { kind: "transcript", filename: `${stem}.txt`, text },
          ];

          if (args.config.generateSubtitles) {
            setState((s) => ({ ...s, status: "Untertitel speichern" }));
            files.push({
              kind: "subtitles",
              filename: `${stem}.srt`,
              text: formatSubRip(segments, {}),
            });
          }

          if (args.config.summarize) {
            const summary = formatSummary(
              segments,
              extractDeepgramSummary(response)
            );
            if (summary.trim()) {
              files.push({
                kind: "summary",
                filename: `${stem}.summary.txt`,
                text: summary.trim() + "\n",
              });
            }
          }

          const saved = await window.eba.fs.saveTranscriptFiles(
            args.config.outputDir,
            files
          );
          const outPath =
            saved.find((file) => file.kind === "transcript")?.path ?? "";
          const subtitlePath =
            saved.find((file) => file.kind === "subtitles")?.path ?? "";

          setState({
            stage: "done",
            status: subtitlePath
              ? `Gespeichert: ${outPath} + SRT`
              : `Gespeichert: ${outPath}`,
            uploadPct: 100,
            error: null,
            segments,
            transcriptPath: outPath,
            subtitlePath,
          });
        } catch (err) {
          if (isTranscriptionCancelled(err)) {
            setState((s) => ({
              ...s,
              stage: "cancelled",
              status: "Abgebrochen. Audio bleibt fuer erneuten Versuch.",
            }));
          } else if (err instanceof TranscriptionError) {
            setState((s) => ({
              ...s,
              stage: "error",
              status: err.message,
              error: err.message,
            }));
          } else {
            const msg = (err as Error).message || "Unerwarteter Fehler";
            setState((s) => ({
              ...s,
              stage: "error",
              status: msg,
              error: msg,
            }));
          }
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
      });

      return started !== null;
    },
    []
  );

  const reset = useCallback(() => {
    setState({
      stage: null,
      status: "Bereit.",
      uploadPct: 0,
      error: null,
      segments: [],
      transcriptPath: "",
      subtitlePath: "",
    });
  }, []);

  return useMemo(
    () => ({ state, start, cancel, reset }),
    [state, start, cancel, reset]
  );
}

function isTranscriptionCancelled(err: unknown): boolean {
  if (err instanceof TranscriptionCancelled) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /abgebrochen|cancelled|canceled|abort/i.test(msg);
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
