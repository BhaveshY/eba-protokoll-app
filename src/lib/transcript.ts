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

function formatSrtTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const totalMs = Math.round(clamped * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  const mmm = String(ms).padStart(3, "0");
  return `${hh}:${mm}:${ss},${mmm}`;
}

const SRT_LINE_MAX = 42;
const SRT_MAX_LINES = 2;

/**
 * Break text into chunks that each fit within SRT_MAX_LINES × SRT_LINE_MAX,
 * splitting at word boundaries. A single word longer than SRT_LINE_MAX keeps
 * its own line rather than being broken — readability > strict width.
 */
function splitIntoSrtChunks(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks: string[] = [];
  let lines: string[] = [];
  let current = "";

  const pushLine = () => {
    if (current) {
      lines.push(current);
      current = "";
    }
    if (lines.length >= SRT_MAX_LINES) {
      chunks.push(lines.join("\n"));
      lines = [];
    }
  };

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= SRT_LINE_MAX) {
      current = current + " " + word;
    } else {
      pushLine();
      current = word;
    }
  }
  pushLine();
  if (lines.length) chunks.push(lines.join("\n"));
  return chunks;
}

/**
 * SubRip (.srt) subtitles built from segments. Cue format:
 *   n
 *   HH:MM:SS,mmm --> HH:MM:SS,mmm
 *   Speaker: text
 *
 * Speaker names are substituted from `names` when present (same rule as
 * `formatTranscript`). Utterances longer than 2×42 chars are split across
 * multiple cues with timestamps distributed proportionally by character count,
 * so each on-screen caption stays readable.
 */
export function formatSrt(
  segments: Segment[],
  names: Record<string, string>
): string {
  const cues: string[] = [];
  let index = 1;
  for (const s of segments) {
    const text = s.text.trim();
    if (!text) continue;
    const label = names[s.speaker] ?? s.speaker;
    const chunks = splitIntoSrtChunks(`${label}: ${text}`);
    if (chunks.length === 0) continue;

    const startSec = Math.max(0, s.start);
    const endSec = Math.max(startSec, s.end);
    const duration = endSec - startSec;
    const charCounts = chunks.map((c) => c.length);
    const totalChars = charCounts.reduce((a, b) => a + b, 0) || 1;

    let cursor = startSec;
    chunks.forEach((chunk, i) => {
      const isLast = i === chunks.length - 1;
      const chunkEnd = isLast
        ? endSec
        : cursor + (duration * charCounts[i]) / totalChars;
      const timecode = `${formatSrtTimestamp(cursor)} --> ${formatSrtTimestamp(chunkEnd)}`;
      cues.push(`${index}\n${timecode}\n${chunk}`);
      index += 1;
      cursor = chunkEnd;
    });
  }
  return cues.length ? cues.join("\n\n") + "\n" : "";
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
