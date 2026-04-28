import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  screen,
  shell,
} from "electron";
import * as path from "node:path";
import * as fsp from "node:fs/promises";
import type {
  AppConfig,
  KeytermProfiles,
  RecentTranscript,
  RecordingWidgetState,
  TranscriptFileRequest,
  TranscriptFileResult,
} from "../shared/ipc";
import { DEFAULT_CONFIG } from "../shared/ipc";

const devServerUrl = process.env.VITE_DEV_SERVER_URL;

const CONFIG_FILE = "config.json";
const API_KEY_FILE = "deepgram.bin";
const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  ".wav",
  ".mp3",
  ".m4a",
  ".mp4",
  ".mkv",
  ".ogg",
  ".flac",
  ".webm",
]);
const TRANSCRIPT_EXTENSIONS = new Set([".txt", ".srt"]);
const selectedAudioFiles = new Set<string>();
const selectedDirectories = new Set<string>();
let mainWindow: BrowserWindow | null = null;
let recordingWidgetWindow: BrowserWindow | null = null;
let recordingWidgetLoad: Promise<BrowserWindow> | null = null;
let lastRecordingWidgetState: RecordingWidgetState | null = null;

// --- config --------------------------------------------------------------

function configPath(): string {
  return path.join(app.getPath("userData"), CONFIG_FILE);
}

function defaultOutputDir(): string {
  return path.join(app.getPath("documents"), "EBA-Protokoll");
}

async function readConfig(): Promise<AppConfig> {
  const file = configPath();
  let cfg: AppConfig = sanitizeConfig({
    ...DEFAULT_CONFIG,
    outputDir: defaultOutputDir(),
  });
  try {
    const raw = await fsp.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    cfg = sanitizeConfig({ ...cfg, ...parsed });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("config read failed:", err);
    }
  }
  return cfg;
}

async function writeConfig(cfg: AppConfig): Promise<void> {
  const file = configPath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(cfg, null, 2), "utf8");
}

// --- api key (OS-level safe storage) ------------------------------------

function apiKeyPath(): string {
  return path.join(app.getPath("userData"), API_KEY_FILE);
}

async function readApiKey(): Promise<string> {
  const envKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (envKey) return envKey;
  try {
    if (!safeStorage.isEncryptionAvailable()) return "";
    const buf = await fsp.readFile(apiKeyPath());
    return safeStorage.decryptString(buf).trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("api key read failed:", err);
    }
    return "";
  }
}

async function writeApiKey(value: string): Promise<void> {
  const trimmed = value.trim();
  const file = apiKeyPath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  if (!trimmed) {
    await fsp.rm(file, { force: true });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage nicht verfuegbar (OS-Keychain fehlt)");
  }
  const encrypted = safeStorage.encryptString(trimmed);
  await fsp.writeFile(file, encrypted);
}

// --- filesystem helpers -------------------------------------------------

async function ensureOutputDirs(base: string): Promise<void> {
  if (!base.trim()) {
    throw new Error("Ausgabe-Verzeichnis fehlt.");
  }
  for (const sub of ["aufnahmen", "transkripte", "protokolle"]) {
    await fsp.mkdir(path.join(base, sub), { recursive: true });
  }
}

async function listTranscripts(base: string, limit = 8): Promise<RecentTranscript[]> {
  if (!base.trim()) return [];
  const folder = path.join(base, "transkripte");
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(folder);
  } catch {
    return [];
  }
  const items: RecentTranscript[] = [];
  for (const name of entries) {
    if (!name.endsWith(".txt")) continue;
    if (name.endsWith(".summary.txt")) continue;
    const full = path.join(folder, name);
    try {
      const stat = await fsp.stat(full);
      if (!stat.isFile()) continue;
      const subtitlePath = await matchingSubtitlePath(folder, name);
      items.push({
        name,
        path: full,
        ...(subtitlePath ? { subtitlePath } : {}),
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    } catch {
      // ignore unreadable files
    }
  }
  items.sort((a, b) => b.mtime - a.mtime);
  return items.slice(0, limit);
}

async function saveRecording(
  base: string,
  filename: string,
  bytes: ArrayBuffer | ArrayBufferView
): Promise<string> {
  const outputDir = await assertConfiguredOutputBase(base);
  const folder = path.join(outputDir, "aufnahmen");
  await fsp.mkdir(folder, { recursive: true });
  assertPathInside(outputDir, folder);
  const safeName = safeArtifactFilename(filename, "aufnahme.wav");
  const target = await uniqueFilePath(folder, safeName);
  assertPathInside(folder, target);
  await fsp.writeFile(target, bufferFromBytes(bytes));
  return target;
}

function bufferFromBytes(bytes: ArrayBuffer | ArrayBufferView): Buffer {
  if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function safeArtifactFilename(filename: string, fallback: string): string {
  const name = path.basename(filename.trim() || fallback);
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

async function assertConfiguredOutputBase(base: string): Promise<string> {
  if (!base.trim()) throw new Error("Ausgabe-Verzeichnis fehlt.");
  const cfg = await readConfig();
  const outputDir = path.resolve(cfg.outputDir);
  if (path.resolve(base) !== outputDir) {
    throw new Error("Ausgabe-Verzeichnis stimmt nicht mit der Konfiguration ueberein.");
  }
  return outputDir;
}

function assertPathInside(base: string, target: string): void {
  const root = path.resolve(base);
  const resolved = path.resolve(target);
  const rel = path.relative(root, resolved);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return;
  throw new Error("Pfad liegt ausserhalb des erlaubten Ausgabe-Verzeichnisses.");
}

function transcriptFolder(base: string): string {
  return path.join(base, "transkripte");
}

function outputPathAllowed(base: string, target: string): boolean {
  const outputDir = path.resolve(base);
  const resolved = path.resolve(target);
  const rel = path.relative(outputDir, resolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function supportedAudioFile(p: string): boolean {
  return SUPPORTED_AUDIO_EXTENSIONS.has(path.extname(p).toLowerCase());
}

async function readGrantedAudioFile(p: string): Promise<ArrayBuffer> {
  const resolved = path.resolve(p);
  if (!selectedAudioFiles.has(resolved) || !supportedAudioFile(resolved)) {
    throw new Error("Audio-Datei wurde nicht ueber den Dateidialog freigegeben.");
  }
  const buf = await fsp.readFile(resolved);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function saveTranscriptFiles(
  base: string,
  files: TranscriptFileRequest[]
): Promise<TranscriptFileResult[]> {
  const outputDir = await assertConfiguredOutputBase(base);
  const folder = transcriptFolder(outputDir);
  await fsp.mkdir(folder, { recursive: true });

  const writes = files.map((input) => {
    const file = normalizeTranscriptFileRequest(input);
    return {
      kind: readTranscriptKind(file.kind),
      path: resolveTranscriptTarget(folder, file),
      text: String(file.text ?? ""),
    };
  });
  if (!writes.length) return [];
  ensureUniqueTargets(writes.map((file) => file.path));

  await writeTextFilesAtomically(writes);
  return writes.map(({ kind, path: filePath }) => ({ kind, path: filePath }));
}

function normalizeTranscriptFileRequest(input: unknown): TranscriptFileRequest {
  if (!input || typeof input !== "object") {
    throw new Error("Ungueltige Transkript-Datei.");
  }
  const candidate = input as Partial<TranscriptFileRequest>;
  if (typeof candidate.text !== "string") {
    throw new Error("Transkript-Inhalt fehlt.");
  }
  return {
    kind: typeof candidate.kind === "string" ? candidate.kind : "file",
    text: candidate.text,
    ...(typeof candidate.filename === "string"
      ? { filename: candidate.filename }
      : {}),
    ...(typeof candidate.path === "string" ? { path: candidate.path } : {}),
  };
}

function readTranscriptKind(kind: unknown): string {
  const text = typeof kind === "string" ? kind.trim() : "";
  return text || "file";
}

function resolveTranscriptTarget(
  folder: string,
  file: TranscriptFileRequest
): string {
  if (file.path) {
    const target = path.resolve(file.path);
    assertPathInside(folder, target);
    assertTranscriptExtension(target);
    return target;
  }

  const filename = safeArtifactFilename(file.filename ?? "", "transkript.txt");
  const target = path.join(folder, filename);
  assertPathInside(folder, target);
  assertTranscriptExtension(target);
  return target;
}

function assertTranscriptExtension(p: string): void {
  if (!TRANSCRIPT_EXTENSIONS.has(path.extname(p).toLowerCase())) {
    throw new Error("Nur .txt- und .srt-Dateien duerfen als Transkript gespeichert werden.");
  }
}

function ensureUniqueTargets(paths: string[]): void {
  const seen = new Set<string>();
  for (const p of paths) {
    const key = path.resolve(p);
    if (seen.has(key)) {
      throw new Error("Transkript-Zieldatei wurde doppelt angegeben.");
    }
    seen.add(key);
  }
}

async function writeTextFilesAtomically(
  files: Array<{ path: string; text: string }>
): Promise<void> {
  const prepared: Array<{ target: string; temp: string }> = [];
  const backups: Array<{ target: string; backup: string }> = [];
  const token = `${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;

  try {
    for (let i = 0; i < files.length; i++) {
      const target = files[i].path;
      const temp = path.join(
        path.dirname(target),
        `.${path.basename(target)}.${token}.${i}.tmp`
      );
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(temp, files[i].text, "utf8");
      prepared.push({ target, temp });
    }

    for (const item of prepared) {
      const backup = `${item.target}.${token}.bak`;
      try {
        await fsp.rename(item.target, backup);
        backups.push({ target: item.target, backup });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }

    for (const item of prepared) {
      await fsp.rename(item.temp, item.target);
    }

    await Promise.all(
      backups.map((item) => fsp.rm(item.backup, { force: true }).catch(() => {}))
    );
  } catch (err) {
    await Promise.all(
      prepared.map((item) => fsp.rm(item.temp, { force: true }).catch(() => {}))
    );
    await Promise.all(
      prepared.map((item) => fsp.rm(item.target, { force: true }).catch(() => {}))
    );
    await Promise.all(
      backups.map(async (item) => {
        await fsp.rename(item.backup, item.target).catch(() => {});
      })
    );
    throw err;
  }
}

async function uniqueFilePath(folder: string, filename: string): Promise<string> {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext) || "aufnahme";
  for (let i = 0; i < 10_000; i++) {
    const suffix = i === 0 ? "" : `-${i + 1}`;
    const candidate = path.join(folder, `${stem}${suffix}${ext}`);
    try {
      await fsp.stat(candidate);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return candidate;
      throw err;
    }
  }
  throw new Error("Kein freier Dateiname fuer Aufnahme gefunden.");
}

async function matchingSubtitlePath(
  folder: string,
  transcriptName: string
): Promise<string | null> {
  const subtitleName = transcriptName.replace(/\.txt$/, ".srt");
  const full = path.join(folder, subtitleName);
  try {
    const stat = await fsp.stat(full);
    return stat.isFile() ? full : null;
  } catch {
    return null;
  }
}

// --- keyterms -----------------------------------------------------------

function userKeytermsPath(): string {
  return path.join(app.getPath("userData"), "keyterms.json");
}

function bundledKeytermsPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "keyterms.json")
    : path.join(__dirname, "..", "..", "keyterms.json");
}

const DEFAULT_KEYTERMS: KeytermProfiles = { profiles: { default: [] } };

async function loadKeyterms(): Promise<KeytermProfiles> {
  // Preferred source: user-writable copy.
  try {
    const raw = await fsp.readFile(userKeytermsPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.profiles) {
      return parsed as KeytermProfiles;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("keyterms user read failed:", err);
    }
  }
  // Fallback: seed from bundled file on first run.
  try {
    const raw = await fsp.readFile(bundledKeytermsPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.profiles) {
      return parsed as KeytermProfiles;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("keyterms bundled read failed:", err);
    }
  }
  return DEFAULT_KEYTERMS;
}

async function saveKeyterms(data: KeytermProfiles): Promise<void> {
  const file = userKeytermsPath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function sanitizeProfileName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 64);
}

function normalizeTerms(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== "string") continue;
    const term = v.trim();
    if (!term) continue;
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function profileNames(data: KeytermProfiles): string[] {
  const names = Object.keys(data.profiles).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  return names.length ? names : ["default"];
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeConfig(input: Partial<AppConfig>): AppConfig {
  const outputDir = readTrimmedString(input.outputDir) || defaultOutputDir();
  const uiLang = readTrimmedString(input.uiLanguage);
  const uiLanguage: AppConfig["uiLanguage"] =
    uiLang === "en" || uiLang === "de" ? uiLang : DEFAULT_CONFIG.uiLanguage;

  return {
    language: readTrimmedString(input.language) || DEFAULT_CONFIG.language,
    uiLanguage,
    outputDir,
    keytermProfile:
      readTrimmedString(input.keytermProfile) || DEFAULT_CONFIG.keytermProfile,
    deepgramEndpoint:
      readTrimmedString(input.deepgramEndpoint) || DEFAULT_CONFIG.deepgramEndpoint,
    systemAudioDevice:
      readTrimmedString(input.systemAudioDevice) || DEFAULT_CONFIG.systemAudioDevice,
    smartFormat: readBoolean(input.smartFormat, DEFAULT_CONFIG.smartFormat),
    filterFillers: readBoolean(input.filterFillers, DEFAULT_CONFIG.filterFillers),
    paragraphs: readBoolean(input.paragraphs, DEFAULT_CONFIG.paragraphs),
    summarize: readBoolean(input.summarize, DEFAULT_CONFIG.summarize),
    generateSubtitles: readBoolean(
      input.generateSubtitles,
      DEFAULT_CONFIG.generateSubtitles
    ),
  };
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// --- floating recording widget -----------------------------------------

const RECORDING_WIDGET_WIDTH = 360;
const RECORDING_WIDGET_HEIGHT = 78;

function normalizeRecordingWidgetState(input: unknown): RecordingWidgetState {
  const candidate =
    input && typeof input === "object"
      ? (input as Partial<RecordingWidgetState>)
      : {};
  const labels = (
    candidate.labels && typeof candidate.labels === "object"
      ? candidate.labels
      : {}
  ) as Partial<RecordingWidgetState["labels"]>;
  return {
    elapsed: Math.max(0, Math.floor(readFiniteNumber(candidate.elapsed, 0))),
    statusText: readDisplayText(candidate.statusText, "", 180),
    micLevel: clampLevel(candidate.micLevel),
    systemLevel: clampLevel(candidate.systemLevel),
    usedSystemAudio: candidate.usedSystemAudio === true,
    labels: {
      title: readDisplayText(labels.title, "Recording", 48),
      stop: readDisplayText(labels.stop, "Stop", 32),
      mic: readDisplayText(labels.mic, "Microphone", 40),
      system: readDisplayText(labels.system, "Computer", 40),
    },
  };
}

function readFiniteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampLevel(value: unknown): number {
  const n = readFiniteNumber(value, 0);
  return Math.max(0, Math.min(1, n));
}

function readDisplayText(
  value: unknown,
  fallback: string,
  maxLength: number
): string {
  const text = typeof value === "string" ? value.trim() : fallback;
  return text.slice(0, maxLength);
}

async function showRecordingWidget(state: RecordingWidgetState): Promise<void> {
  lastRecordingWidgetState = state;
  const win = await ensureRecordingWidgetWindow();
  if (win.isDestroyed()) return;
  positionRecordingWidget(win);
  sendRecordingWidgetState(state);
  win.setAlwaysOnTop(true);
  win.showInactive();
}

function updateRecordingWidget(state: RecordingWidgetState): void {
  lastRecordingWidgetState = state;
  sendRecordingWidgetState(state);
}

async function ensureRecordingWidgetWindow(): Promise<BrowserWindow> {
  if (recordingWidgetWindow && !recordingWidgetWindow.isDestroyed()) {
    return recordingWidgetWindow;
  }
  if (recordingWidgetLoad) return recordingWidgetLoad;

  const win = new BrowserWindow({
    width: RECORDING_WIDGET_WIDTH,
    height: RECORDING_WIDGET_HEIGHT,
    minWidth: RECORDING_WIDGET_WIDTH,
    minHeight: RECORDING_WIDGET_HEIGHT,
    maxWidth: RECORDING_WIDGET_WIDTH,
    maxHeight: RECORDING_WIDGET_HEIGHT,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: "#00000000",
    show: false,
    title: "Aufnahme",
    webPreferences: {
      preload: path.join(__dirname, "recordingWidgetPreload.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  recordingWidgetWindow = win;
  positionRecordingWidget(win);
  win.setAlwaysOnTop(true);
  if (process.platform === "darwin") {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  win.on("closed", () => {
    if (recordingWidgetWindow === win) recordingWidgetWindow = null;
    if (recordingWidgetLoad) recordingWidgetLoad = null;
  });

  recordingWidgetLoad = win
    .loadURL(recordingWidgetDataUrl())
    .then(() => {
      if (recordingWidgetWindow === win) recordingWidgetLoad = null;
      if (lastRecordingWidgetState) sendRecordingWidgetState(lastRecordingWidgetState);
      return win;
    })
    .catch((err) => {
      if (recordingWidgetWindow === win) recordingWidgetWindow = null;
      if (recordingWidgetLoad) recordingWidgetLoad = null;
      if (win.isDestroyed()) return win;
      win.destroy();
      throw err;
    });

  return recordingWidgetLoad;
}

function closeRecordingWidget(): void {
  const win = recordingWidgetWindow;
  recordingWidgetWindow = null;
  recordingWidgetLoad = null;
  lastRecordingWidgetState = null;
  if (win && !win.isDestroyed()) win.destroy();
}

function sendRecordingWidgetState(state: RecordingWidgetState): void {
  const win = recordingWidgetWindow;
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send("recordingWidget:state", state);
}

function positionRecordingWidget(win: BrowserWindow): void {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const x = Math.round(
    workArea.x + (workArea.width - RECORDING_WIDGET_WIDTH) / 2
  );
  const y = Math.round(workArea.y + workArea.height - RECORDING_WIDGET_HEIGHT - 24);
  win.setPosition(x, Math.max(workArea.y, y), false);
}

function recordingWidgetDataUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(recordingWidgetHtml())}`;
}

function recordingWidgetHtml(): string {
  return String.raw`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';" />
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #191919;
      user-select: none;
    }
    #shell {
      box-sizing: border-box;
      height: calc(100% - 12px);
      margin: 6px;
      border: 1px solid rgba(25, 25, 25, 0.11);
      border-radius: 8px;
      background: rgba(252, 252, 250, 0.97);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      -webkit-app-region: drag;
    }
    .dot {
      width: 24px;
      height: 24px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: rgba(190, 45, 45, 0.08);
      display: grid;
      place-items: center;
    }
    .dot::after {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #be2d2d;
      box-shadow: 0 0 0 0 rgba(190, 45, 45, 0.3);
      animation: pulse 1.5s ease-out infinite;
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(190, 45, 45, 0.3); }
      70% { box-shadow: 0 0 0 7px rgba(190, 45, 45, 0); }
      100% { box-shadow: 0 0 0 0 rgba(190, 45, 45, 0); }
    }
    .copy {
      min-width: 0;
      flex: 1 1 auto;
    }
    .topline {
      display: grid;
      gap: 1px;
      min-width: 0;
    }
    #title {
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 10px;
      font-weight: 650;
      white-space: nowrap;
      color: #77736d;
    }
    #timer {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 15px;
      font-weight: 700;
      color: #191919;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    #status {
      display: none;
    }
    .meters {
      width: 84px;
      flex: 0 0 auto;
      display: grid;
      gap: 4px;
    }
    #shell.system-off .meters {
      width: 66px;
      grid-template-columns: 1fr;
    }
    #shell.system-off .system {
      display: none;
    }
    .meter-block {
      min-width: 0;
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr);
      align-items: center;
      gap: 5px;
    }
    .label {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 9px;
      font-weight: 700;
      color: #77736d;
    }
    .meter {
      height: 6px;
      box-sizing: border-box;
      display: flex;
      align-items: stretch;
      gap: 1px;
      padding: 0;
      border-radius: 999px;
      background: #e8e7e2;
      overflow: hidden;
    }
    .bar {
      flex: 1 1 0;
      height: 100% !important;
      border-radius: 0;
      background: transparent;
      transition: background 120ms ease;
    }
    .bar.active {
      background: #be2d2d;
    }
    #stop {
      flex: 0 0 auto;
      border: 0;
      border-radius: 8px;
      background: #be2d2d;
      color: #fff;
      min-width: 54px;
      padding: 8px 10px;
      font: inherit;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      -webkit-app-region: no-drag;
    }
    #stop:active {
      background: #a92525;
    }
    #stop:disabled {
      opacity: 0.65;
      cursor: default;
    }
  </style>
</head>
<body>
  <div id="shell">
    <div class="dot" aria-hidden="true"></div>
    <div class="copy">
      <div class="topline">
        <span id="title">Recording</span>
        <span id="timer">00:00:00</span>
      </div>
      <p id="status"></p>
    </div>
    <div class="meters" aria-hidden="true">
      <div class="meter-block">
        <span class="label" id="mic-label">Microphone</span>
        <div class="meter" id="mic-meter"></div>
      </div>
      <div class="meter-block system">
        <span class="label" id="system-label">Computer</span>
        <div class="meter" id="system-meter"></div>
      </div>
    </div>
    <button id="stop" type="button">Stop</button>
  </div>
  <script>
    const shell = document.getElementById("shell");
    const stopButton = document.getElementById("stop");
    const micMeter = document.getElementById("mic-meter");
    const systemMeter = document.getElementById("system-meter");
    const bars = new Map();

    function makeBars(root) {
      const set = [];
      for (let i = 0; i < 14; i += 1) {
        const bar = document.createElement("span");
        bar.className = "bar";
        bar.style.height = 5 + (i % 7) * 2 + "px";
        root.appendChild(bar);
        set.push(bar);
      }
      return set;
    }

    bars.set("mic", makeBars(micMeter));
    bars.set("system", makeBars(systemMeter));

    function fmtDuration(sec) {
      const safe = Math.max(0, Math.floor(Number(sec) || 0));
      const h = Math.floor(safe / 3600);
      const m = Math.floor((safe % 3600) / 60);
      const s = safe % 60;
      const pad = (n) => String(n).padStart(2, "0");
      return pad(h) + ":" + pad(m) + ":" + pad(s);
    }

    function setText(id, value) {
      document.getElementById(id).textContent = value || "";
    }

    function shortLabel(value, fallback) {
      const text = String(value || "").toLowerCase();
      if (text.includes("computer") || text.includes("system")) return "PC";
      if (text.includes("mikro") || text.includes("micro") || text.includes("mic")) return "Mic";
      return fallback;
    }

    function renderMeter(name, level) {
      const active = Math.round(Math.max(0, Math.min(1, Number(level) || 0)) * 14);
      for (const [index, bar] of bars.get(name).entries()) {
        bar.classList.toggle("active", index < active);
      }
    }

    function render(state) {
      const labels = state && state.labels ? state.labels : {};
      setText("title", labels.title || "Recording");
      setText("timer", fmtDuration(state && state.elapsed));
      setText("status", state && state.statusText ? state.statusText : "");
      setText("mic-label", shortLabel(labels.mic, "Mic"));
      setText("system-label", shortLabel(labels.system, "PC"));
      setText("stop", labels.stop || "Stop");
      shell.classList.toggle("system-off", !(state && state.usedSystemAudio));
      renderMeter("mic", state && state.micLevel);
      renderMeter("system", state && state.systemLevel);
    }

    stopButton.addEventListener("click", () => {
      stopButton.disabled = true;
      window.recordingWidget.requestStop();
      window.setTimeout(() => {
        stopButton.disabled = false;
      }, 3000);
    });

    window.recordingWidget.onState(render);
  </script>
</body>
</html>`;
}

// --- IPC ----------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle("config:get", async () => await readConfig());

  ipcMain.handle("config:set", async (_evt, patch: Partial<AppConfig>) => {
    const current = await readConfig();
    const next = sanitizeConfig({ ...current, ...patch });
    await writeConfig(next);
    return next;
  });

  ipcMain.handle("apiKey:get", async () => await readApiKey());
  ipcMain.handle("apiKey:set", async (_evt, value: string) => {
    await writeApiKey(value);
  });

  ipcMain.handle("fs:ensureOutputDirs", async (_evt, base: string) => {
    const outputDir = await assertConfiguredOutputBase(base);
    await ensureOutputDirs(outputDir);
  });

  ipcMain.handle(
    "fs:saveTranscriptFiles",
    async (_evt, base: string, files: TranscriptFileRequest[]) =>
      await saveTranscriptFiles(base, Array.isArray(files) ? files : [])
  );

  ipcMain.handle(
    "fs:saveRecording",
    async (_evt, base: string, filename: string, bytes: ArrayBuffer) =>
      await saveRecording(base, filename, bytes)
  );

  ipcMain.handle(
    "fs:listTranscripts",
    async (_evt, base: string, limit?: number) => {
      const outputDir = await assertConfiguredOutputBase(base);
      return await listTranscripts(outputDir, limit ?? 8);
    }
  );

  ipcMain.handle("fs:readFileAsBytes", async (_evt, p: string) =>
    await readGrantedAudioFile(p)
  );

  ipcMain.handle("fs:revealInFolder", async (_evt, p: string) => {
    if (!p.trim()) throw new Error("Pfad fehlt.");
    const cfg = await readConfig();
    if (!outputPathAllowed(cfg.outputDir, p)) {
      throw new Error("Pfad liegt ausserhalb des Ausgabe-Verzeichnisses.");
    }
    shell.showItemInFolder(path.resolve(p));
  });

  ipcMain.handle("fs:openPath", async (_evt, p: string) => {
    if (!p.trim()) throw new Error("Pfad fehlt.");
    const cfg = await readConfig();
    const resolved = path.resolve(p);
    if (
      !outputPathAllowed(cfg.outputDir, resolved) &&
      !selectedDirectories.has(resolved)
    ) {
      throw new Error("Pfad liegt ausserhalb des Ausgabe-Verzeichnisses.");
    }
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
  });

  ipcMain.handle("fs:chooseDirectory", async (_evt, initial?: string) => {
    const result = await dialog.showOpenDialog({
      defaultPath: initial || undefined,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const selected = path.resolve(result.filePaths[0]);
    selectedDirectories.add(selected);
    return selected;
  });

  ipcMain.handle("fs:chooseAudioFile", async () => {
    const result = await dialog.showOpenDialog({
      title: "Audio-/Video-Datei importieren",
      properties: ["openFile"],
      filters: [
        {
          name: "Audio/Video",
          extensions: ["wav", "mp3", "m4a", "mp4", "mkv", "ogg", "flac", "webm"],
        },
        { name: "Alle Dateien", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const selected = path.resolve(result.filePaths[0]);
    if (!supportedAudioFile(selected)) {
      throw new Error("Dateityp wird nicht unterstuetzt.");
    }
    selectedAudioFiles.add(selected);
    return selected;
  });

  ipcMain.handle("fs:defaultOutputDir", async () => defaultOutputDir());

  ipcMain.handle(
    "fs:joinTranscriptPath",
    async (_evt, base: string, filename: string) => {
      const outputDir = await assertConfiguredOutputBase(base);
      const folder = transcriptFolder(outputDir);
      const target = path.join(
        folder,
        safeArtifactFilename(filename, "transkript.txt")
      );
      assertPathInside(folder, target);
      assertTranscriptExtension(target);
      return target;
    }
  );

  ipcMain.handle("keyterms:list", async () => {
    const data = await loadKeyterms();
    return profileNames(data);
  });

  ipcMain.handle("keyterms:load", async (_evt, profile: string) => {
    const data = await loadKeyterms();
    const terms = data.profiles[profile] ?? [];
    return terms.map((t) => String(t));
  });

  ipcMain.handle(
    "keyterms:save",
    async (_evt, profile: string, terms: string[]) => {
      const name = sanitizeProfileName(profile || "");
      if (!name) throw new Error("Profilname fehlt.");
      const data = await loadKeyterms();
      const next: KeytermProfiles = {
        profiles: { ...data.profiles, [name]: normalizeTerms(terms) },
      };
      await saveKeyterms(next);
      return next.profiles[name];
    }
  );

  ipcMain.handle("keyterms:createProfile", async (_evt, rawName: string) => {
    const name = sanitizeProfileName(rawName || "");
    if (!name) throw new Error("Profilname fehlt.");
    const data = await loadKeyterms();
    if (data.profiles[name]) {
      throw new Error(`Profil "${name}" existiert bereits.`);
    }
    const next: KeytermProfiles = {
      profiles: { ...data.profiles, [name]: [] },
    };
    await saveKeyterms(next);
    return profileNames(next);
  });

  ipcMain.handle("keyterms:deleteProfile", async (_evt, rawName: string) => {
    const name = sanitizeProfileName(rawName || "");
    if (!name) throw new Error("Profilname fehlt.");
    if (name === "default") {
      throw new Error("Standard-Profil kann nicht geloescht werden.");
    }
    const data = await loadKeyterms();
    if (!data.profiles[name]) {
      throw new Error(`Profil "${name}" nicht gefunden.`);
    }
    const rest = { ...data.profiles };
    delete rest[name];
    const next: KeytermProfiles = {
      profiles: Object.keys(rest).length ? rest : { default: [] },
    };
    await saveKeyterms(next);
    return profileNames(next);
  });

  ipcMain.handle(
    "log",
    (_evt, level: "info" | "warn" | "error", msg: string) => {
      const line = `[${new Date().toISOString()}] [renderer:${level}] ${msg}`;
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    }
  );

  ipcMain.handle("shell:openExternal", async (_evt, url: string) => {
    const parsed = new URL(url);
    if (!["https:", "http:", "mailto:"].includes(parsed.protocol)) {
      throw new Error("URL-Schema ist nicht erlaubt.");
    }
    await shell.openExternal(parsed.toString());
  });

  ipcMain.handle("recordingWidget:show", async (_evt, state: unknown) => {
    await showRecordingWidget(normalizeRecordingWidgetState(state));
  });

  ipcMain.on("recordingWidget:update", (_evt, state: unknown) => {
    updateRecordingWidget(normalizeRecordingWidgetState(state));
  });

  ipcMain.handle("recordingWidget:hide", async () => {
    closeRecordingWidget();
  });

  ipcMain.on("recordingWidget:requestStop", (evt) => {
    const sender = BrowserWindow.fromWebContents(evt.sender);
    if (sender !== recordingWidgetWindow) return;
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send("recordingWidget:stopRequested");
  });
}

// --- window -------------------------------------------------------------

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 820,
    minWidth: 720,
    minHeight: 640,
    backgroundColor: "#f5f6f8",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  if (!devServerUrl) {
    Menu.setApplicationMenu(null);
  }

  win.once("ready-to-show", () => win.show());

  if (devServerUrl) {
    win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Main is emitted at dist-electron/electron/main.js,
    // renderer at dist/index.html  →  two levels up.
    win.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  }

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
    closeRecordingWidget();
  });

  return win;
}

app.whenReady().then(async () => {
  registerIpc();

  // Make sure the output dirs exist before the UI asks for them.
  try {
    const cfg = await readConfig();
    await ensureOutputDirs(cfg.outputDir);
  } catch (err) {
    console.warn("output dirs init failed:", err);
  }

  createWindow();

  app.on("activate", () => {
    if (!mainWindow) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
