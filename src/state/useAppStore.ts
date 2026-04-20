import { useCallback, useEffect, useState } from "react";
import type { AppConfig, RecentTranscript } from "@shared/ipc";
import type { ToastKind } from "../components/ui/Toast";

interface ToastState {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface AppStore {
  config: AppConfig | null;
  apiKey: string;
  keytermProfiles: string[];
  recent: RecentTranscript[];
  toast: ToastState | null;

  refreshConfig: () => Promise<void>;
  patchConfig: (patch: Partial<AppConfig>) => Promise<void>;
  refreshApiKey: () => Promise<void>;
  saveApiKey: (value: string) => Promise<void>;
  refreshKeyterms: () => Promise<void>;
  refreshRecent: () => Promise<void>;
  notify: (kind: ToastKind, message: string) => void;
  dismissToast: () => void;
}

export function useAppStore(): AppStore {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [apiKey, setApiKey] = useState<string>("");
  const [keytermProfiles, setKeytermProfiles] = useState<string[]>(["default"]);
  const [recent, setRecent] = useState<RecentTranscript[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);

  const refreshConfig = useCallback(async () => {
    const cfg = await window.eba.config.get();
    setConfig(cfg);
  }, []);

  const patchConfig = useCallback(async (patch: Partial<AppConfig>) => {
    const next = await window.eba.config.set(patch);
    setConfig(next);
  }, []);

  const refreshApiKey = useCallback(async () => {
    setApiKey(await window.eba.apiKey.get());
  }, []);

  const saveApiKey = useCallback(async (value: string) => {
    await window.eba.apiKey.set(value);
    setApiKey(value.trim());
  }, []);

  const refreshKeyterms = useCallback(async () => {
    const names = await window.eba.keyterms.list();
    setKeytermProfiles(names.length ? names : ["default"]);
  }, []);

  const refreshRecent = useCallback(async () => {
    if (!config?.outputDir) return;
    const items = await window.eba.fs.listTranscripts(config.outputDir, 8);
    setRecent(items);
  }, [config?.outputDir]);

  const notify = useCallback((kind: ToastKind, message: string) => {
    setToast({ id: Date.now(), kind, message });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    (async () => {
      await refreshConfig();
      await refreshApiKey();
      await refreshKeyterms();
    })();
  }, [refreshConfig, refreshApiKey, refreshKeyterms]);

  useEffect(() => {
    if (config?.outputDir) refreshRecent();
  }, [config?.outputDir, refreshRecent]);

  return {
    config,
    apiKey,
    keytermProfiles,
    recent,
    toast,
    refreshConfig,
    patchConfig,
    refreshApiKey,
    saveApiKey,
    refreshKeyterms,
    refreshRecent,
    notify,
    dismissToast,
  };
}
