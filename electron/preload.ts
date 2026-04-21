import { contextBridge, ipcRenderer } from "electron";
import type { AppConfig, EbaApi } from "../shared/ipc";

const api: EbaApi = {
  platform: process.platform as EbaApi["platform"],

  config: {
    get: () => ipcRenderer.invoke("config:get"),
    set: (patch: Partial<AppConfig>) => ipcRenderer.invoke("config:set", patch),
  },

  apiKey: {
    get: () => ipcRenderer.invoke("apiKey:get"),
    set: (value: string) => ipcRenderer.invoke("apiKey:set", value),
  },

  fs: {
    ensureOutputDirs: (base: string) =>
      ipcRenderer.invoke("fs:ensureOutputDirs", base),
    writeTranscript: (p: string, text: string) =>
      ipcRenderer.invoke("fs:writeTranscript", p, text),
    listTranscripts: (base: string, limit?: number) =>
      ipcRenderer.invoke("fs:listTranscripts", base, limit),
    readFileAsBytes: (p: string) =>
      ipcRenderer.invoke("fs:readFileAsBytes", p) as Promise<ArrayBuffer>,
    revealInFolder: (p: string) => ipcRenderer.invoke("fs:revealInFolder", p),
    openPath: (p: string) => ipcRenderer.invoke("fs:openPath", p),
    chooseDirectory: (initial?: string) =>
      ipcRenderer.invoke("fs:chooseDirectory", initial),
    chooseAudioFile: () => ipcRenderer.invoke("fs:chooseAudioFile"),
    defaultOutputDir: () => ipcRenderer.invoke("fs:defaultOutputDir"),
    joinTranscriptPath: (base: string, filename: string) =>
      ipcRenderer.invoke("fs:joinTranscriptPath", base, filename),
  },

  keyterms: {
    list: () => ipcRenderer.invoke("keyterms:list"),
    load: (profile: string) => ipcRenderer.invoke("keyterms:load", profile),
    save: (profile: string, terms: string[]) =>
      ipcRenderer.invoke("keyterms:save", profile, terms),
    createProfile: (name: string) =>
      ipcRenderer.invoke("keyterms:createProfile", name),
    deleteProfile: (name: string) =>
      ipcRenderer.invoke("keyterms:deleteProfile", name),
  },

  log: (level, msg) => {
    ipcRenderer.invoke("log", level, msg);
  },

  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
};

contextBridge.exposeInMainWorld("eba", api);
