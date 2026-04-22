import type { DeepgramResponse, DeepgramUtterance, Segment } from "./types";

const SPEAKER_ME = "Ich";
const DEFAULT_SPEAKER_PREFIX = "Sprecher";
const DEFAULT_SPEAKER_FALLBACK = `${DEFAULT_SPEAKER_PREFIX} 1`;
const SAMPLE_QUOTES_DEFAULT_MAX_LEN = 120;
const REVIEW_SAMPLE_MAX_LEN = 110;

export interface SpeakerReviewItem {
  id: string;
  assignedName: string;
  isFixed: boolean;
  segmentCount: number;
  wordCount: number;
  totalDurationSec: number;
  firstStart: number;
  samples: string[];
}

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
  utt: DeepgramUtterance,
  isRecordedStereo: boolean
): string {
  if (isRecordedStereo && utt?.channel === 0) return SPEAKER_ME;
  const speaker = utt?.speaker;
  if (speaker === undefined || speaker === null) return DEFAULT_SPEAKER_FALLBACK;
  const n = Number(speaker);
  if (!Number.isFinite(n)) return DEFAULT_SPEAKER_FALLBACK;
  return `${DEFAULT_SPEAKER_PREFIX} ${Math.floor(n) + 1}`;
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
  maxLen = SAMPLE_QUOTES_DEFAULT_MAX_LEN
): Record<string, string> {
  const quotes: Record<string, string> = {};
  for (const s of segments) {
    if (!s.speaker || s.speaker === SPEAKER_ME) continue;
    const text = s.text.trim();
    if (!text) continue;
    if (quotes[s.speaker]) continue;
    quotes[s.speaker] =
      text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
  }
  return quotes;
}

export function cleanSpeakerNames(
  names: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(names).flatMap(([id, value]) => {
      const nextId = id.trim();
      const nextValue = value.trim();
      return nextId && nextValue ? [[nextId, nextValue]] : [];
    })
  );
}

export function collectSpeakerReviewItems(
  segments: Segment[],
  names: Record<string, string> = {},
  maxSamples = 3
): SpeakerReviewItem[] {
  const cleanedNames = cleanSpeakerNames(names);
  const items = new Map<string, SpeakerReviewItem>();

  for (const segment of segments) {
    const speaker = segment.speaker.trim();
    const text = segment.text.trim();
    if (!speaker || !text) continue;

    let item = items.get(speaker);
    if (!item) {
      item = {
        id: speaker,
        assignedName: cleanedNames[speaker] ?? "",
        isFixed: speaker === SPEAKER_ME,
        segmentCount: 0,
        wordCount: 0,
        totalDurationSec: 0,
        firstStart: segment.start,
        samples: [],
      };
      items.set(speaker, item);
    }

    item.segmentCount += 1;
    item.wordCount += text.split(/\s+/).filter(Boolean).length;
    item.totalDurationSec += Math.max(0, segment.end - segment.start);
    item.firstStart = Math.min(item.firstStart, segment.start);

    if (item.samples.length < maxSamples) {
      item.samples.push(
        text.length > REVIEW_SAMPLE_MAX_LEN
          ? `${text.slice(0, REVIEW_SAMPLE_MAX_LEN)}...`
          : text
      );
    }
  }

  return [...items.values()].sort((a, b) => {
    if (a.isFixed !== b.isFixed) return a.isFixed ? -1 : 1;
    return a.firstStart - b.firstStart;
  });
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
