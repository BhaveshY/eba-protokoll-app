import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  shell,
} from "electron";
import * as path from "node:path";
import * as fsp from "node:fs/promises";
import type { AppConfig, KeytermProfiles, RecentTranscript } from "../shared/ipc";
import { DEFAULT_CONFIG } from "../shared/ipc";

const devServerUrl = process.env.VITE_DEV_SERVER_URL;

const CONFIG_FILE = "config.json";
const API_KEY_FILE = "deepgram.bin";

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
    await ensureOutputDirs(base);
  });

  ipcMain.handle(
    "fs:writeTranscript",
    async (_evt, p: string, text: string) => {
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, text, "utf8");
    }
  );

  ipcMain.handle(
    "fs:listTranscripts",
    async (_evt, base: string, limit?: number) =>
      await listTranscripts(base, limit ?? 8)
  );

  ipcMain.handle("fs:readFileAsBytes", async (_evt, p: string) => {
    const buf = await fsp.readFile(p);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle("fs:revealInFolder", async (_evt, p: string) => {
    if (!p.trim()) throw new Error("Pfad fehlt.");
    shell.showItemInFolder(p);
  });

  ipcMain.handle("fs:openPath", async (_evt, p: string) => {
    if (!p.trim()) throw new Error("Pfad fehlt.");
    const error = await shell.openPath(p);
    if (error) throw new Error(error);
  });

  ipcMain.handle("fs:chooseDirectory", async (_evt, initial?: string) => {
    const result = await dialog.showOpenDialog({
      defaultPath: initial || undefined,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
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
    return result.filePaths[0];
  });

  ipcMain.handle("fs:defaultOutputDir", async () => defaultOutputDir());

  ipcMain.handle(
    "fs:joinTranscriptPath",
    async (_evt, base: string, filename: string) =>
      {
        if (!base.trim()) throw new Error("Ausgabe-Verzeichnis fehlt.");
        return path.join(base, "transkripte", filename);
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
    await shell.openExternal(url);
  });
}

// --- window -------------------------------------------------------------

function createWindow(): void {
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
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
