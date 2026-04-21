export interface Segment {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface DeepgramUtterance {
  start?: number;
  end?: number;
  channel?: number;
  speaker?: number | string;
  transcript?: string;
}

export interface DeepgramResponse {
  results?: {
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
