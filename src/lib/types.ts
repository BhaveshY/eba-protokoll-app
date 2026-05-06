export interface Segment {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export type {
  DeepgramAlternative,
  DeepgramChannel,
  DeepgramParagraph,
  DeepgramParagraphs,
  DeepgramResponse,
  DeepgramSentence,
  DeepgramUtterance,
  DeepgramWord,
  Language,
  TranscribeOptions,
  UploadProgress,
} from "../../shared/deepgram";

export type TranscribeStage =
  | "prepare"
  | "upload"
  | "deepgram"
  | "save"
  | "done"
  | "error"
  | "cancelled";
