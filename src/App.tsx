import { useCallback, useEffect, useRef, useState } from "react";
import type { UiLanguage } from "@shared/ipc";
import { GlossaryPanel } from "./components/GlossaryPanel";
import { Header } from "./components/Header";
import { ProgressPanel } from "./components/ProgressPanel";
import { RecentList } from "./components/RecentList";
import { RecordingPanel, type LoadedAudio } from "./components/RecordingPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { TranscriptReviewPanel } from "./components/TranscriptReviewPanel";
import { Toast } from "./components/ui/Toast";
import { I18nProvider, useT } from "./lib/i18n";
import { formatSubRip, formatTranscript, sampleQuotes } from "./lib/transcript";
import type { Segment } from "./lib/types";
import { useAppStore } from "./state/useAppStore";
import { useTranscription } from "./state/useTranscription";

export function App() {
  const store = useAppStore();
  const lang: UiLanguage = store.config?.uiLanguage ?? "de";
  return (
    <I18nProvider lang={lang}>
      <AppInner store={store} />
    </I18nProvider>
  );
}

function AppInner({ store }: { store: ReturnType<typeof useAppStore> }) {
  const {
    config,
    apiKey,
    keytermProfiles,
    recent,
    toast,
    patchConfig,
    saveApiKey,
    refreshKeyterms,
    refreshRecent,
    notify,
    dismissToast,
  } = store;
  const t = useT();
  const { state: txState, start: startTx, cancel: cancelTx } = useTranscription();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [loaded, setLoaded] = useState<LoadedAudio | null>(null);
  const [projectName, setProjectName] = useState(() => defaultProjectName());
  const [reviewState, setReviewState] = useState<{
    segments: Segment[];
    target: string;
    subtitleTarget: string;
  } | null>(null);
  const onboardedRef = useRef(false);
  const handledTranscriptRef = useRef<string>("");

  const transcribing =
    txState.stage !== null &&
    !["done", "error", "cancelled"].includes(txState.stage);

  // Prompt for API key on first run
  useEffect(() => {
    if (!config) return;
    if (!apiKey && !onboardedRef.current) {
      onboardedRef.current = true;
      notify("info", t("notify.welcome"));
    }
  }, [apiKey, config, notify, t]);

  useEffect(() => {
    const preventWindowDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
    };
    window.addEventListener("dragover", preventWindowDrop);
    window.addEventListener("drop", preventWindowDrop);
    return () => {
      window.removeEventListener("dragover", preventWindowDrop);
      window.removeEventListener("drop", preventWindowDrop);
    };
  }, []);

  // Open transcript review when transcription succeeds
  useEffect(() => {
    const reviewableSpeakerCount = Object.keys(sampleQuotes(txState.segments)).length;
    if (
      txState.stage === "done" &&
      txState.segments.length > 0 &&
      txState.transcriptPath &&
      txState.transcriptPath !== handledTranscriptRef.current
    ) {
      handledTranscriptRef.current = txState.transcriptPath;
      if (reviewableSpeakerCount > 0) {
        setReviewState({
          segments: txState.segments,
          target: txState.transcriptPath,
          subtitleTarget: txState.subtitlePath,
        });
      }
      void refreshRecent();
      notify(
        "success",
        reviewableSpeakerCount > 0
          ? t("notify.transcriptSavedReview")
          : t("notify.transcriptSaved")
      );
    }
  }, [
    txState.stage,
    txState.segments,
    txState.transcriptPath,
    txState.subtitlePath,
    refreshRecent,
    notify,
    t,
  ]);

  useEffect(() => {
    if (txState.stage === "error" && txState.error) {
      notify("error", txState.error);
    }
  }, [txState.stage, txState.error, notify]);

  const startTranscription = useCallback(async () => {
    if (!loaded || !config) return;
    if (!apiKey) {
      notify("warn", t("notify.apiKeyMissing"));
      setSettingsOpen(true);
      return;
    }
    const keyterms = await window.eba.keyterms.load(
      config.keytermProfile || "default"
    );
    const project = projectName.trim() || deriveProjectName(loaded.filename);
    await startTx({
      apiKey,
      config,
      audioBlob: loaded.blob,
      filename: loaded.filename,
      isRecordedStereo: loaded.isRecordedStereo,
      keyterms,
      project,
    });
  }, [loaded, config, apiKey, notify, projectName, startTx, t]);

  const saveSettings = useCallback(
    async ({
      apiKey,
      patch,
    }: {
      apiKey: string;
      patch: Parameters<typeof patchConfig>[0];
    }) => {
      try {
        await saveApiKey(apiKey);
        const nextConfig = await patchConfig(patch);
        await window.eba.fs.ensureOutputDirs(nextConfig.outputDir);
        await refreshKeyterms();
        await refreshRecent(nextConfig.outputDir);
        notify("success", t("notify.settingsSaved"));
        setSettingsOpen(false);
      } catch (err) {
        notify("error", t("notify.saveFailed", { msg: (err as Error).message }));
      }
    },
    [patchConfig, refreshKeyterms, refreshRecent, saveApiKey, notify, t]
  );

  const saveReview = useCallback(
    async (names: Record<string, string>) => {
      if (!reviewState) {
        setReviewState(null);
        return;
      }
      try {
        const text = formatTranscript(reviewState.segments, names);
        await window.eba.fs.writeTranscript(reviewState.target, text);
        if (reviewState.subtitleTarget) {
          await window.eba.fs.writeTranscript(
            reviewState.subtitleTarget,
            formatSubRip(reviewState.segments, names)
          );
        }
        await refreshRecent();
        notify("success", t("notify.namesUpdated"));
      } catch (err) {
        notify("error", (err as Error).message);
      } finally {
        setReviewState(null);
      }
    },
    [reviewState, refreshRecent, notify, t]
  );

  const openTranscript = useCallback(
    async (path: string) => {
      try {
        await window.eba.fs.openPath(path);
      } catch (err) {
        notify(
          "error",
          t("notify.openFileFailed", { msg: (err as Error).message })
        );
      }
    },
    [notify, t]
  );

  const revealTranscript = useCallback(
    async (path: string) => {
      try {
        await window.eba.fs.revealInFolder(path);
      } catch (err) {
        notify(
          "error",
          t("notify.revealFailed", { msg: (err as Error).message })
        );
      }
    },
    [notify, t]
  );

  const changeUiLanguage = useCallback(
    async (next: UiLanguage) => {
      if (!config || config.uiLanguage === next) return;
      try {
        await patchConfig({ uiLanguage: next });
      } catch (err) {
        notify("error", t("notify.saveFailed", { msg: (err as Error).message }));
      }
    },
    [config, patchConfig, notify, t]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (reviewState) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "t") {
        e.preventDefault();
        await startTranscription();
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        try {
          const p = await window.eba.fs.chooseAudioFile();
          if (p) {
            const bytes = await window.eba.fs.readFileAsBytes(p);
            setLoaded({
              blob: new Blob([bytes]),
              filename: p.split(/[/\\]/).pop() || "audio",
              isRecordedStereo: false,
              durationSec: 0,
              source: "imported",
            });
          }
        } catch (err) {
          notify(
            "error",
            t("notify.importFailed", { msg: (err as Error).message })
          );
        }
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === "Escape") {
        if (transcribing) cancelTx();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [startTranscription, transcribing, cancelTx, notify, reviewState, t]);

  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-fg-muted">{t("app.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        uiLanguage={config.uiLanguage}
        onChangeUiLanguage={changeUiLanguage}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-6 sm:px-7 sm:py-8">
        <div className="grid gap-5 md:grid-cols-5 md:gap-6">
          <div className="flex flex-col gap-4 md:col-span-3">
            <RecordingPanel
              config={config}
              projectName={projectName}
              onProjectNameChange={setProjectName}
              loaded={loaded}
              disabled={transcribing}
              onLoaded={setLoaded}
              onLog={(lvl, m) => window.eba.log(lvl, m)}
            />

            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                className="btn-primary py-2.5"
                disabled={!loaded || transcribing}
                onClick={startTranscription}
                title={t("app.action.transcribe.title")}
              >
                {transcribing
                  ? t("app.action.transcribing")
                  : t("app.action.transcribe")}
              </button>
              {loaded && !transcribing && (
                <p className="px-1 text-[11.5px] text-fg-subtle">
                  <span className="font-medium text-fg-muted">
                    {t("app.loaded.label")}
                  </span>{" "}
                  <span className="font-mono">{loaded.filename}</span>
                  {loaded.isRecordedStereo ? t("app.loaded.stereoSuffix") : ""}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 md:col-span-2">
            <ProgressPanel
              tx={txState}
              isActive={transcribing}
              onCancel={cancelTx}
            />
            <RecentList
              items={recent}
              onOpen={openTranscript}
              onReveal={revealTranscript}
            />
          </div>
        </div>
      </main>

      <footer className="border-t border-line bg-bg-footer">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-5 py-2 text-[11px] text-fg-muted sm:px-7">
          <span className="hidden flex-wrap items-center gap-x-3 gap-y-1 md:flex">
            <span className="flex items-center gap-1.5">
              <kbd>⌘T</kbd> {t("app.footer.transcribe")}
            </span>
            <span className="flex items-center gap-1.5">
              <kbd>⌘O</kbd> {t("app.footer.import")}
            </span>
            <span className="flex items-center gap-1.5">
              <kbd>⌘,</kbd> {t("app.footer.settings")}
            </span>
            <span className="flex items-center gap-1.5">
              <kbd>Esc</kbd> {t("app.footer.cancel")}
            </span>
          </span>
          <span className="text-fg-subtle ml-auto">v0.1.0</span>
        </div>
      </footer>

      {settingsOpen && (
        <SettingsPanel
          config={config}
          apiKey={apiKey}
          keytermProfiles={keytermProfiles}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
          onChangeUiLanguage={changeUiLanguage}
          onOpenGlossary={() => setGlossaryOpen(true)}
          notify={notify}
        />
      )}

      {glossaryOpen && (
        <GlossaryPanel
          profiles={keytermProfiles}
          activeProfile={config.keytermProfile || "default"}
          onActiveProfileChange={(name) => {
            void patchConfig({ keytermProfile: name });
          }}
          onClose={() => setGlossaryOpen(false)}
          onRefresh={refreshKeyterms}
          notify={notify}
        />
      )}

      {reviewState && (
        <TranscriptReviewPanel
          segments={reviewState.segments}
          transcriptPath={reviewState.target}
          initialNames={{}}
          onClose={() => setReviewState(null)}
          onSave={saveReview}
        />
      )}

      {toast && (
        <Toast
          kind={toast.kind}
          message={toast.message}
          onDismiss={dismissToast}
        />
      )}
    </div>
  );
}

function deriveProjectName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return base || "Besprechung";
}

function defaultProjectName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Besprechung_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
