import type { DeepgramResponse, Segment } from "./types";

export function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Cowork-compatible transcript: `[HH:MM:SS] Speaker: text` per line.
 * Speaker names are substituted from `names` when present.
 */
export function formatTranscript(
  segments: Segment[],
  names: Record<string, string>
): string {
  return segments
    .filter((s) => s.text.trim())
    .map((s) => {
      const label = names[s.speaker] ?? s.speaker;
      return `[${formatTimestamp(s.start)}] ${label}: ${s.text}`;
    })
    .join("\n");
}

function utteranceSpeakerLabel(
  utt: DeepgramResponse extends infer _ ? NonNullable<DeepgramResponse["results"]>["utterances"] extends infer U ? U extends (infer I)[] ? I : never : never : never,
  isRecordedStereo: boolean
): string {
  if (isRecordedStereo && utt?.channel === 0) return "Ich";
  const speaker = utt?.speaker;
  if (speaker === undefined || speaker === null) return "Sprecher 1";
  const n = Number(speaker);
  if (!Number.isFinite(n)) return "Sprecher 1";
  return `Sprecher ${Math.floor(n) + 1}`;
}

/**
 * Normalize a Deepgram response into `{start,end,speaker,text}` segments,
 * sorted by start time, with empty transcripts dropped.
 *
 * Recorded stereo (mic=L, system=R):
 *   channel 0 -> "Ich"
 *   channel 1 + speaker n -> "Sprecher n+1"
 * Imported files:
 *   speaker n -> "Sprecher n+1"
 */
export function responseToSegments(
  response: DeepgramResponse,
  isRecordedStereo: boolean
): Segment[] {
  const utterances = response.results?.utterances ?? [];
  const segments: Segment[] = [];
  for (const u of utterances) {
    const text = (u.transcript ?? "").trim();
    if (!text) continue;
    segments.push({
      start: Number(u.start ?? 0),
      end: Number(u.end ?? 0),
      speaker: utteranceSpeakerLabel(u, isRecordedStereo),
      text,
    });
  }
  segments.sort((a, b) => a.start - b.start);
  return segments;
}

/**
 * Sample one quote per non-"Ich" speaker for the rename dialog.
 */
export function sampleQuotes(
  segments: Segment[],
  maxLen = 120
): Record<string, string> {
  const quotes: Record<string, string> = {};
  for (const s of segments) {
    if (!s.speaker || s.speaker === "Ich") continue;
    const text = s.text.trim();
    if (!text) continue;
    if (quotes[s.speaker]) continue;
    quotes[s.speaker] =
      text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
  }
  return quotes;
}

export function safeProject(name: string): string {
  return [...name]
    .map((c) => (/[\p{L}\p{N}\-_ ]/u.test(c) ? c : "_"))
    .join("");
}

export function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let idx = -1;
  let val = n;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[idx]}`;
}
