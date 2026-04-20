import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  keytermCounts: Record<string, number>;
  recent: RecentTranscript[];
  toast: ToastState | null;

  refreshConfig: () => Promise<AppConfig>;
  patchConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>;
  refreshApiKey: () => Promise<void>;
  saveApiKey: (value: string) => Promise<void>;
  refreshKeyterms: () => Promise<void>;
  refreshRecent: (baseDir?: string) => Promise<RecentTranscript[]>;
  notify: (kind: ToastKind, message: string) => void;
  dismissToast: () => void;
}

export function useAppStore(): AppStore {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [apiKey, setApiKey] = useState<string>("");
  const [keytermProfiles, setKeytermProfiles] = useState<string[]>(["default"]);
  const [keytermCounts, setKeytermCounts] = useState<Record<string, number>>({
    default: 0,
  });
  const [recent, setRecent] = useState<RecentTranscript[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const configRef = useRef<AppConfig | null>(null);

  const refreshConfig = useCallback(async () => {
    const cfg = await window.eba.config.get();
    setConfig(cfg);
    configRef.current = cfg;
    return cfg;
  }, []);

  const patchConfig = useCallback(async (patch: Partial<AppConfig>) => {
    const next = await window.eba.config.set(patch);
    setConfig(next);
    configRef.current = next;
    return next;
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
    const profiles = names.length ? names : ["default"];
    setKeytermProfiles(profiles);

    const counts = await Promise.all(
      profiles.map(async (profile) => {
        const terms = await window.eba.keyterms.load(profile);
        return [profile, terms.length] as const;
      })
    );
    setKeytermCounts(Object.fromEntries(counts));
  }, []);

  const refreshRecent = useCallback(async (baseDir?: string) => {
    const base = baseDir?.trim() || configRef.current?.outputDir?.trim() || "";
    if (!base) {
      setRecent([]);
      return [];
    }
    const items = await window.eba.fs.listTranscripts(base, 8);
    setRecent(items);
    return items;
  }, []);

  const notify = useCallback((kind: ToastKind, message: string) => {
    setToast({ id: Date.now(), kind, message });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    (async () => {
      await refreshConfig();
      await refreshApiKey();
      await refreshKeyterms();
    })().catch((err) => {
      console.error("initial app state load failed:", err);
    });
  }, [refreshConfig, refreshApiKey, refreshKeyterms]);

  useEffect(() => {
    configRef.current = config;
    if (!config?.outputDir) {
      setRecent([]);
      return;
    }
    void refreshRecent(config.outputDir);
  }, [config, refreshRecent]);

  return useMemo(
    () => ({
      config,
      apiKey,
      keytermProfiles,
      keytermCounts,
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
    }),
    [
      config,
      apiKey,
      keytermProfiles,
      keytermCounts,
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
    ]
  );
}
