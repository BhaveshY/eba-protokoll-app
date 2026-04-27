export interface Segment {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface DeepgramUtterance {
  start?: number;
  end?: number;
  channel?: number | string;
  speaker?: number | string;
  transcript?: string;
}

export interface DeepgramWord {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  speaker?: number | string;
  language?: string;
}

export interface DeepgramSentence {
  text?: string;
  start?: number;
  end?: number;
}

export interface DeepgramParagraph {
  sentences?: DeepgramSentence[];
  speaker?: number | string;
  start?: number;
  end?: number;
}

export interface DeepgramParagraphs {
  transcript?: string;
  paragraphs?: DeepgramParagraph[];
}

export interface DeepgramAlternative {
  transcript?: string;
  words?: DeepgramWord[];
  languages?: string[];
  paragraphs?: DeepgramParagraphs;
}

export interface DeepgramChannel {
  alternatives?: DeepgramAlternative[];
}

export interface DeepgramResponse {
  results?: {
    channels?: DeepgramChannel[];
    utterances?: DeepgramUtterance[];
    summary?: {
      short?: string;
      result?: string;
    };
  };
}

export type Language =
  | "multi"
  | "de"
  | "en"
  | "fr"
  | "es"
  | "it";

export interface TranscribeOptions {
  language: Language | string;
  multichannel: boolean;
  keyterms: string[];
  model?: string;
  diarize?: boolean;
  utterances?: boolean;
  smartFormat?: boolean;
  punctuate?: boolean;
  /** Drop filler words ("um", "uh", "ähm") from the transcript. */
  filterFillers?: boolean;
  /** Produce paragraph breaks within a speaker turn. */
  paragraphs?: boolean;
  /** Generate a short summary as part of the response. */
  summarize?: boolean;
}

export type TranscribeStage =
  | "prepare"
  | "upload"
  | "deepgram"
  | "save"
  | "done"
  | "error"
  | "cancelled";

export interface UploadProgress {
  sent: number;
  total: number;
}
