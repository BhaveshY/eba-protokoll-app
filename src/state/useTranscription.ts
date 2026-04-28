import { useCallback, useMemo, useRef, useState } from "react";
import {
  transcribe,
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
    subtitlePath: "",
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
        subtitlePath: "",
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
      subtitlePath: "",
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
