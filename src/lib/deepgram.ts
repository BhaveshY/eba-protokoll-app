import type {
  DeepgramResponse,
  TranscribeOptions,
  UploadProgress,
} from "./types";

export const DEFAULT_ENDPOINT = "https://api.eu.deepgram.com";
const LISTEN_PATH = "/v1/listen";

export const MAX_SINGLE_REQUEST_BYTES = 2_000_000_000;
export const WARN_SINGLE_REQUEST_BYTES = 500_000_000;

const RETRY_STATUS = new Set([500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 2000;

export class TranscriptionError extends Error {}
export class TranscriptionCancelled extends Error {
  constructor(msg = "Abgebrochen") {
    super(msg);
  }
}

export function contentTypeFor(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return {
    wav: "audio/wav",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    mp4: "video/mp4",
    mkv: "video/x-matroska",
    ogg: "audio/ogg",
    flac: "audio/flac",
    webm: "audio/webm",
  }[ext] ?? "application/octet-stream";
}

export function buildQuery(opts: TranscribeOptions): URLSearchParams {
  const q = new URLSearchParams();
  const language = opts.language || "multi";
  q.set("model", opts.model ?? "nova-3");
  q.set("language", language);
  q.set("multichannel", String(opts.multichannel));
  q.set("diarize", String(opts.diarize ?? true));
  q.set("utterances", String(opts.utterances ?? true));
  q.set("smart_format", String(opts.smartFormat ?? true));
  q.set("punctuate", String(opts.punctuate ?? true));
  if (opts.paragraphs ?? true) q.set("paragraphs", "true");
  if (opts.filterFillers) q.set("filler_words", "false");
  if (opts.summarize && supportsDeepgramSummary(language)) {
    q.set("summarize", "v2");
  }
  for (const term of opts.keyterms ?? []) {
    const t = term.trim();
    if (t) q.append("keyterm", t);
  }
  return q;
}

export function supportsDeepgramSummary(language: string): boolean {
  const normalized = language.trim().toLowerCase();
  return normalized === "en" || normalized.startsWith("en-");
}

export interface TranscribeArgs {
  blob: Blob;
  filename: string;
  apiKey: string;
  endpoint?: string;
  options: TranscribeOptions;
  signal?: AbortSignal;
  onUpload?: (progress: UploadProgress) => void;
  onStage?: (label: string) => void;
  /** For tests: inject a fetch implementation. */
  fetchImpl?: typeof fetch;
  /** For tests: sleep stub. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

/**
 * Upload audio to Deepgram and return the parsed JSON response.
 * Retries on 5xx with exponential backoff. Aborts cleanly via AbortSignal.
 */
export async function transcribe(
  args: TranscribeArgs
): Promise<DeepgramResponse> {
  const {
    blob,
    filename,
    apiKey,
    endpoint = DEFAULT_ENDPOINT,
    options,
    signal,
    onUpload,
    onStage,
    fetchImpl = fetch,
    sleep = defaultSleep,
  } = args;

  if (!apiKey) throw new TranscriptionError("Kein Deepgram API-Key konfiguriert.");
  if (!blob || blob.size === 0) throw new TranscriptionError("Audio-Datei ist leer.");
  if (blob.size > MAX_SINGLE_REQUEST_BYTES) {
    throw new TranscriptionError(
      `Datei zu gross (${(blob.size / 1e9).toFixed(1)} GB).`
    );
  }

  const url = endpoint.replace(/\/+$/, "") + LISTEN_PATH + "?" +
    buildQuery(options).toString();

  const headers: Record<string, string> = {
    Authorization: `Token ${apiKey}`,
    "Content-Type": contentTypeFor(filename),
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new TranscriptionCancelled();

    onStage?.(`Hochladen (${(blob.size / 1_048_576).toFixed(1)} MB)`);
    onUpload?.({ sent: 0, total: blob.size });

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: blob,
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new TranscriptionCancelled();
      }
      if (attempt >= MAX_RETRIES) {
        throw new TranscriptionError(`Netzwerkfehler: ${(err as Error).message}`);
      }
      await sleep(BACKOFF_BASE_MS * attempt);
      continue;
    }

    // We can't observe per-chunk upload bytes from fetch() in the browser.
    // Report full-upload on each attempt end; the UI still shows progress
    // in terms of request lifecycle rather than streamed bytes.
    onUpload?.({ sent: blob.size, total: blob.size });

    if (response.ok) {
      onStage?.("Antwort erhalten");
      try {
        return (await response.json()) as DeepgramResponse;
      } catch (err) {
        throw new TranscriptionError(
          `Antwort war kein JSON: ${(err as Error).message}`
        );
      }
    }

    if (RETRY_STATUS.has(response.status) && attempt < MAX_RETRIES) {
      await sleep(BACKOFF_BASE_MS * attempt);
      continue;
    }

    const body = (await response.text().catch(() => "")).slice(0, 500);
    throw new TranscriptionError(
      `Deepgram HTTP ${response.status}: ${body}`.trim()
    );
  }

  throw new TranscriptionError("Unbekannter Fehler.");
}
