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
