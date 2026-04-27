import type {
  DeepgramAlternative,
  DeepgramResponse,
  DeepgramUtterance,
  DeepgramWord,
  Segment,
} from "./types";

const SPEAKER_ME = "Ich";
const DEFAULT_SPEAKER_PREFIX = "Sprecher";
const SAMPLE_QUOTES_DEFAULT_MAX_LEN = 120;
const REVIEW_SAMPLE_MAX_LEN = 110;
const CHANNEL_WORD_SEGMENT_GAP_SEC = 1.5;
const CHANNEL_COMPLETENESS_MIN_EXTRA_WORDS = 3;
const CHANNEL_COMPLETENESS_MIN_EXTRA_RATIO = 0.05;
const LOCAL_SUMMARY_MAX_ITEMS = 6;
const LOCAL_SUMMARY_MAX_TEXT_LEN = 220;

interface RawSegment {
  start: number;
  end: number;
  channel?: number | string;
  speaker?: number | string;
  text: string;
}

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

const SUBRIP_NEWLINE = "\r\n";

export function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function formatSubRipTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = String(totalMs % 1000).padStart(3, "0");
  const totalSec = Math.floor(totalMs / 1000);
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss},${ms}`;
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

/**
 * Standards-compliant SubRip subtitles for video sidecars.
 * Times use Deepgram utterance boundaries at millisecond precision.
 */
export function formatSubRip(
  segments: Segment[],
  names: Record<string, string>
): string {
  const ordered = segments
    .filter((s) => s.text.trim())
    .map((s) => ({
      ...s,
      start: cleanTime(s.start),
      end: cleanTime(s.end),
    }))
    .sort((a, b) => a.start - b.start);

  const cues = ordered.flatMap((segment, i) => {
    const text = cueText(segment, names);
    if (!text) return [];

    const nextStart = ordered[i + 1]?.start;
    const start = segment.start;
    const fallbackEnd = start + fallbackCueDuration(segment.text);
    let end = segment.end > start ? segment.end : fallbackEnd;

    if (
      typeof nextStart === "number" &&
      Number.isFinite(nextStart) &&
      nextStart > start &&
      end > nextStart
    ) {
      end = nextStart;
    }
    if (end <= start) {
      const hasUsableNextStart =
        typeof nextStart === "number" &&
        Number.isFinite(nextStart) &&
        nextStart > start;
      end = hasUsableNextStart
        ? nextStart
        : start + 0.5;
    }

    return [{
      start,
      end,
      text,
    }];
  });

  if (!cues.length) return "";

  return cues
    .map((cue, i) =>
      [
        String(i + 1),
        `${formatSubRipTimestamp(cue.start)} --> ${formatSubRipTimestamp(cue.end)}`,
        ...wrapCueText(cue.text),
      ].join(SUBRIP_NEWLINE)
    )
    .join(`${SUBRIP_NEWLINE}${SUBRIP_NEWLINE}`) + SUBRIP_NEWLINE;
}

function cleanTime(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function fallbackCueDuration(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(7, Math.max(1.5, words * 0.35));
}

function cueText(segment: Segment, names: Record<string, string>): string {
  const text = normalizeCueLine(segment.text);
  if (!text) return "";
  const label = normalizeCueLine(names[segment.speaker] ?? segment.speaker);
  return label ? `${label}: ${text}` : text;
}

function normalizeCueLine(value: string): string {
  return value.replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
}

function wrapCueText(text: string, maxLineLength = 42): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if (!line) {
      line = word;
      continue;
    }
    if (`${line} ${word}`.length <= maxLineLength) {
      line += ` ${word}`;
      continue;
    }
    lines.push(line);
    line = word;
  }

  if (line) lines.push(line);
  return lines.length ? lines : [text];
}

/**
 * Normalize a Deepgram response into `{start,end,speaker,text}` segments,
 * sorted by start time, with empty transcripts dropped.
 *
 * Recorded stereo (mic=L, system=R):
 *   Deepgram speaker IDs stay channel-aware so equal IDs on different
 *   channels do not get merged. "Ich" is only used when channel 0 has
 *   no speaker label from Deepgram.
 * Imported files:
 *   Deepgram speaker IDs are preserved as stable Sprecher labels.
 */
export function responseToSegments(
  response: DeepgramResponse,
  isRecordedStereo: boolean
): Segment[] {
  const utteranceSegments = utterancesToSegments(
    response.results?.utterances ?? [],
    isRecordedStereo
  );
  const channelSegments = channelsToSegments(response, isRecordedStereo);

  if (!utteranceSegments.length) return channelSegments;
  if (!channelSegments.length) return utteranceSegments;
  if (isRicherTranscript(channelSegments, utteranceSegments)) {
    return channelSegments;
  }
  return utteranceSegments;
}

function utterancesToSegments(
  utterances: DeepgramUtterance[],
  isRecordedStereo: boolean
): Segment[] {
  const segments: RawSegment[] = [];
  for (const u of utterances) {
    const text = (u.transcript ?? "").trim();
    if (!text) continue;
    segments.push({
      start: Number(u.start ?? 0),
      end: Number(u.end ?? 0),
      channel: u.channel,
      speaker: u.speaker,
      text,
    });
  }
  return labelSegments(segments, isRecordedStereo);
}

function channelsToSegments(
  response: DeepgramResponse,
  isRecordedStereo: boolean
): Segment[] {
  const channels = response.results?.channels ?? [];
  const segments: RawSegment[] = [];
  const seenChannelTexts = new Set<string>();

  channels.forEach((channel, channelIndex) => {
    const alternative = firstUsableAlternative(channel.alternatives ?? []);
    if (!alternative) return;

    const comparisonText = comparisonTextForAlternative(alternative);
    if (comparisonText) {
      const key = normalizeForComparison(comparisonText);
      if (seenChannelTexts.has(key)) return;
      seenChannelTexts.add(key);
    }

    const wordSegments = wordsToSegments(
      alternative.words ?? [],
      channelIndex,
      isRecordedStereo
    );
    if (wordSegments.length) {
      segments.push(...wordSegments);
      return;
    }

    const paragraphSegments = paragraphSegmentsFromAlternative(
      alternative,
      channelIndex
    );
    if (paragraphSegments.length) {
      segments.push(...paragraphSegments);
      return;
    }

    const text = cleanSegmentText(
      alternative.paragraphs?.transcript || alternative.transcript || ""
    );
    if (text) {
      segments.push({
        start: 0,
        end: 0,
        channel: channelIndex,
        text,
      });
    }
  });

  return labelSegments(segments, isRecordedStereo);
}

function firstUsableAlternative(
  alternatives: DeepgramAlternative[]
): DeepgramAlternative | null {
  for (const alternative of alternatives) {
    if (comparisonTextForAlternative(alternative)) return alternative;
  }
  return null;
}

function comparisonTextForAlternative(alternative: DeepgramAlternative): string {
  const direct = cleanSegmentText(
    alternative.paragraphs?.transcript || alternative.transcript || ""
  );
  if (direct) return direct;
  return cleanSegmentText((alternative.words ?? []).map(wordText).join(" "));
}

function wordsToSegments(
  words: DeepgramWord[],
  channelIndex: number,
  isRecordedStereo: boolean
): RawSegment[] {
  const segments: RawSegment[] = [];
  let current: RawSegment | null = null;
  let currentWords: string[] = [];

  const flush = () => {
    if (!current) return;
    const text = cleanJoinedWords(currentWords);
    if (text) segments.push({ ...current, text });
    current = null;
    currentWords = [];
  };

  for (const word of words) {
    const text = wordText(word);
    if (!text) continue;

    const start = safeSeconds(word.start);
    const end = Math.max(start, safeSeconds(word.end, start));
    if (
      !current ||
      rawSpeakerIdentity(current.channel, current.speaker, isRecordedStereo) !==
        rawSpeakerIdentity(channelIndex, word.speaker, isRecordedStereo) ||
      start - current.end > CHANNEL_WORD_SEGMENT_GAP_SEC
    ) {
      flush();
      current = {
        start,
        end,
        channel: channelIndex,
        speaker: word.speaker,
        text: "",
      };
      currentWords = [text];
      continue;
    }

    current.end = Math.max(current.end, end);
    currentWords.push(text);
  }

  flush();
  return segments;
}

function paragraphSegmentsFromAlternative(
  alternative: DeepgramAlternative,
  channelIndex: number
): RawSegment[] {
  const segments: RawSegment[] = [];
  for (const paragraph of alternative.paragraphs?.paragraphs ?? []) {
    for (const sentence of paragraph.sentences ?? []) {
      const text = cleanSegmentText(sentence.text ?? "");
      if (!text) continue;
      const start = safeSeconds(sentence.start, safeSeconds(paragraph.start));
      const end = safeSeconds(sentence.end, safeSeconds(paragraph.end, start));
      segments.push({
        start,
        end: Math.max(start, end),
        channel: channelIndex,
        speaker: paragraph.speaker,
        text,
      });
    }
  }
  return segments;
}

function labelSegments(
  rawSegments: RawSegment[],
  isRecordedStereo: boolean
): Segment[] {
  const labelFor = createSpeakerLabeler(isRecordedStereo);
  return rawSegments
    .filter((segment) => cleanSegmentText(segment.text))
    .sort((a, b) => a.start - b.start)
    .map((segment) => ({
      start: segment.start,
      end: segment.end,
      speaker: labelFor(segment.channel, segment.speaker),
      text: cleanSegmentText(segment.text),
    }));
}

function createSpeakerLabeler(isRecordedStereo: boolean) {
  const labels = new Map<string, string>();
  let nextSpeaker = 1;

  return (channel?: number | string, speaker?: number | string): string => {
    if (isRecordedStereo && isChannelZero(channel) && !hasUsableSpeaker(speaker)) {
      return SPEAKER_ME;
    }

    const key = rawSpeakerIdentity(channel, speaker, isRecordedStereo);
    const existing = labels.get(key);
    if (existing) return existing;

    const label = `${DEFAULT_SPEAKER_PREFIX} ${nextSpeaker}`;
    nextSpeaker += 1;
    labels.set(key, label);
    return label;
  };
}

function rawSpeakerIdentity(
  channel: number | string | undefined,
  speaker: number | string | undefined,
  isRecordedStereo: boolean
): string {
  const speakerKey = hasUsableSpeaker(speaker)
    ? String(Math.floor(Number(speaker)))
    : "unknown";
  if (!isRecordedStereo) return `speaker:${speakerKey}`;
  return `channel:${channelKey(channel)}|speaker:${speakerKey}`;
}

function channelKey(channel: number | string | undefined): string {
  const n = Number(channel);
  return Number.isFinite(n) ? String(Math.floor(n)) : "unknown";
}

function hasUsableSpeaker(speaker: number | string | undefined): boolean {
  if (speaker === undefined || speaker === null) return false;
  return Number.isFinite(Number(speaker));
}

function isChannelZero(channel: number | string | undefined): boolean {
  const n = Number(channel);
  return Number.isFinite(n) && Math.floor(n) === 0;
}

function isRicherTranscript(candidate: Segment[], baseline: Segment[]): boolean {
  const candidateWords = segmentWordCount(candidate);
  const baselineWords = segmentWordCount(baseline);
  const requiredExtra = Math.max(
    CHANNEL_COMPLETENESS_MIN_EXTRA_WORDS,
    Math.ceil(baselineWords * CHANNEL_COMPLETENESS_MIN_EXTRA_RATIO)
  );
  return candidateWords >= baselineWords + requiredExtra;
}

function segmentWordCount(segments: Segment[]): number {
  return wordCount(segments.map((s) => s.text).join(" "));
}

function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

function wordText(word: DeepgramWord): string {
  return cleanSegmentText(word.punctuated_word || word.word || "");
}

function cleanJoinedWords(words: string[]): string {
  return cleanSegmentText(words.join(" "))
    .replace(/\s+([,.;:!?%])/g, "$1")
    .replace(/([¿¡])\s+/g, "$1");
}

function cleanSegmentText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeForComparison(value: string): string {
  return cleanSegmentText(value).toLocaleLowerCase();
}

function safeSeconds(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function extractDeepgramSummary(response: DeepgramResponse): string {
  const summary = response.results?.summary;
  if (!summary || summary.result?.toLowerCase() === "failure") return "";
  const text = cleanSegmentText(summary.short || "");
  if (/summarization.*only available in english/i.test(text)) return "";
  return text;
}

export function formatSummary(
  segments: Segment[],
  deepgramSummary = ""
): string {
  const remoteSummary = cleanSegmentText(deepgramSummary);
  if (remoteSummary) return remoteSummary;

  const items = localSummaryItems(segments);
  if (!items.length) return "";
  return ["Zusammenfassung", "", ...items.map((item) => `- ${item}`)].join("\n");
}

function localSummaryItems(segments: Segment[]): string[] {
  const candidates = segments.filter((s) => cleanSegmentText(s.text));
  if (!candidates.length) return [];

  if (candidates.length <= LOCAL_SUMMARY_MAX_ITEMS) {
    return candidates.map(summaryItemText);
  }

  const selected = new Set<number>([0, 1, candidates.length - 1]);
  const byLength = candidates
    .map((segment, index) => ({ index, words: wordCount(segment.text) }))
    .filter((item) => !selected.has(item.index))
    .sort((a, b) => b.words - a.words || a.index - b.index);

  for (const item of byLength) {
    selected.add(item.index);
    if (selected.size >= LOCAL_SUMMARY_MAX_ITEMS) break;
  }

  return [...selected]
    .sort((a, b) => candidates[a].start - candidates[b].start)
    .map((index) => summaryItemText(candidates[index]));
}

function summaryItemText(segment: Segment): string {
  return `${formatTimestamp(segment.start)} ${segment.speaker}: ${truncateText(
    cleanSegmentText(segment.text),
    LOCAL_SUMMARY_MAX_TEXT_LEN
  )}`;
}

function truncateText(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen - 3).trimEnd() + "...";
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
