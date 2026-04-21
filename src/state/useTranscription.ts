import { useCallback, useMemo, useRef, useState } from "react";
import { transcribe, TranscriptionCancelled, TranscriptionError } from "../lib/deepgram";
import { formatTranscript, responseToSegments, safeProject } from "../lib/transcript";
import type { Segment, TranscribeStage } from "../lib/types";
import type { AppConfig } from "@shared/ipc";

export interface TranscriptionState {
  stage: TranscribeStage | null;
  status: string;
  uploadPct: number;
  error: string | null;
  segments: Segment[];
  transcriptPath: string;
}

export interface StartArgs {
  apiKey: string;
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
  });

  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const start = useCallback(
    async (args: StartArgs): Promise<void> => {
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        stage: "prepare",
        status: "Audio vorbereiten",
        uploadPct: 0,
        error: null,
        segments: [],
        transcriptPath: "",
      });

      try {
        await window.eba.fs.ensureOutputDirs(args.config.outputDir);

        setState((s) => ({ ...s, stage: "upload", status: "Upload startet" }));

        const response = await transcribe({
          blob: args.audioBlob,
          filename: args.filename,
          apiKey: args.apiKey,
          endpoint: args.config.deepgramEndpoint,
          options: {
            language: args.config.language,
            multichannel: args.isRecordedStereo,
            keyterms: args.keyterms,
            smartFormat: args.config.smartFormat,
            filterFillers: args.config.filterFillers,
            paragraphs: args.config.paragraphs,
            summarize: args.config.summarize,
          },
          signal: controller.signal,
          onStage: (label) =>
            setState((s) => ({ ...s, status: label })),
          onUpload: (p) =>
            setState((s) => ({
              ...s,
              uploadPct: p.total ? (p.sent / p.total) * 100 : 0,
            })),
        });

        setState((s) => ({
          ...s,
          stage: "deepgram",
          status: "Antwort verarbeiten",
          uploadPct: 100,
        }));

        const segments = responseToSegments(response, args.isRecordedStereo);

        setState((s) => ({ ...s, stage: "save", status: "Transkript speichern" }));

        const stem = `${safeProject(args.project)}_${timestampForFile()}`;
        const outPath = await window.eba.fs.joinTranscriptPath(
          args.config.outputDir,
          `${stem}.txt`
        );
        const text = formatTranscript(segments, {});
        await window.eba.fs.writeTranscript(outPath, text);

        // Sidecar summary if Deepgram returned one.
        const summary =
          response.results?.summary?.short ||
          response.results?.summary?.result ||
          "";
        if (args.config.summarize && summary.trim()) {
          const summaryPath = await window.eba.fs.joinTranscriptPath(
            args.config.outputDir,
            `${stem}.summary.txt`
          );
          await window.eba.fs.writeTranscript(summaryPath, summary.trim() + "\n");
        }

        setState({
          stage: "done",
          status: `Gespeichert: ${outPath}`,
          uploadPct: 100,
          error: null,
          segments,
          transcriptPath: outPath,
        });
      } catch (err) {
        if (err instanceof TranscriptionCancelled) {
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
        abortRef.current = null;
      }
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
    });
  }, []);

  return useMemo(
    () => ({ state, start, cancel, reset }),
    [state, start, cancel, reset]
  );
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
