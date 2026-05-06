export const MAX_SINGLE_REQUEST_BYTES = 2_000_000_000;
export const WARN_SINGLE_REQUEST_BYTES = 500_000_000;

const AUDIO_EXTENSIONS = new Set([
  "wav",
  "mp3",
  "m4a",
  "mp4",
  "mkv",
  "ogg",
  "flac",
  "webm",
]);

export type AudioImportAssessment =
  | { ok: true; size: number; warning?: "large" }
  | { ok: false; size: number; code: "unsupported" | "empty" | "too_large" };

export function supportedAudioExtension(filename: string): boolean {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return false;
  const ext = base.slice(dot + 1).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

export function assessAudioImport(
  filename: string,
  size: number
): AudioImportAssessment {
  const safeSize = Math.max(0, Number.isFinite(size) ? size : 0);
  if (!supportedAudioExtension(filename)) {
    return { ok: false, code: "unsupported", size: safeSize };
  }
  if (safeSize === 0) {
    return { ok: false, code: "empty", size: safeSize };
  }
  if (safeSize > MAX_SINGLE_REQUEST_BYTES) {
    return { ok: false, code: "too_large", size: safeSize };
  }
  if (safeSize > WARN_SINGLE_REQUEST_BYTES) {
    return { ok: true, warning: "large", size: safeSize };
  }
  return { ok: true, size: safeSize };
}
