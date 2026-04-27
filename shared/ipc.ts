/**
 * Typed IPC contract between Electron main and renderer.
 *
 * The preload script exposes `window.eba` with these methods.
 */

export type UiLanguage = "de" | "en";

export interface AppConfig {
  language: string;
  uiLanguage: UiLanguage;
  outputDir: string;
  keytermProfile: string;
  deepgramEndpoint: string;
  systemAudioDevice: string;

  // Transcription-quality toggles (Deepgram features)
  smartFormat: boolean;      // numbers/dates/currency as digits
  filterFillers: boolean;    // drop "um", "ah", "ähm" etc
  paragraphs: boolean;       // break transcript into paragraphs
  summarize: boolean;        // generate a short summary sidecar
  generateSubtitles: boolean; // generate a SubRip .srt sidecar
}

export const DEFAULT_CONFIG: AppConfig = {
  language: "multi",
  uiLanguage: "de",
  outputDir: "",
  keytermProfile: "default",
  deepgramEndpoint: "https://api.eu.deepgram.com",
  systemAudioDevice: "",
  smartFormat: true,
  filterFillers: false,
  paragraphs: true,
  summarize: false,
  generateSubtitles: true,
};

export interface RecentTranscript {
  name: string;
  path: string;
  subtitlePath?: string;
  size: number;
  mtime: number;
}

export interface KeytermProfiles {
  profiles: Record<string, string[]>;
}

export interface EbaApi {
  platform: "darwin" | "win32" | "linux";

  // Config (non-secret, JSON on disk)
  config: {
    get(): Promise<AppConfig>;
    set(patch: Partial<AppConfig>): Promise<AppConfig>;
  };

  // API key (OS-level secure storage via safeStorage)
  apiKey: {
    get(): Promise<string>;
    set(value: string): Promise<void>;
  };

  // Filesystem helpers
  fs: {
    ensureOutputDirs(base: string): Promise<void>;
    writeTranscript(path: string, text: string): Promise<void>;
    saveRecording(base: string, filename: string, bytes: ArrayBuffer): Promise<string>;
    listTranscripts(base: string, limit?: number): Promise<RecentTranscript[]>;
    readFileAsBytes(path: string): Promise<ArrayBuffer>;
    revealInFolder(path: string): Promise<void>;
    openPath(path: string): Promise<void>;
    chooseDirectory(initial?: string): Promise<string | null>;
    chooseAudioFile(): Promise<string | null>;
    defaultOutputDir(): Promise<string>;
    joinTranscriptPath(base: string, filename: string): Promise<string>;
  };

  // Keyterm glossary (read + write)
  keyterms: {
    list(): Promise<string[]>; // profile names
    load(profile: string): Promise<string[]>;
    save(profile: string, terms: string[]): Promise<string[]>; // returns normalized terms
    createProfile(name: string): Promise<string[]>; // returns new profile list
    deleteProfile(name: string): Promise<string[]>; // returns new profile list
  };

  // Log + open external
  log(level: "info" | "warn" | "error", msg: string): void;
  openExternal(url: string): Promise<void>;
}

declare global {
  interface Window {
    eba: EbaApi;
  }
}
