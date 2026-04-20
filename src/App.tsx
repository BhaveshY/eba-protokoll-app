import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./components/Header";
import { ProgressPanel } from "./components/ProgressPanel";
import { RecentList } from "./components/RecentList";
import { RecordingPanel, type LoadedAudio } from "./components/RecordingPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { TranscriptReviewPanel } from "./components/TranscriptReviewPanel";
import { Toast } from "./components/ui/Toast";
import { formatTranscript, sampleQuotes } from "./lib/transcript";
import type { Segment } from "./lib/types";
import { useAppStore } from "./state/useAppStore";
import { useTranscription } from "./state/useTranscription";

export function App() {
  const {
    config,
    apiKey,
    keytermProfiles,
    keytermCounts,
    recent,
    toast,
    patchConfig,
    saveApiKey,
    refreshKeyterms,
    refreshRecent,
    notify,
    dismissToast,
  } = useAppStore();
  const { state: txState, start: startTx, cancel: cancelTx } = useTranscription();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loaded, setLoaded] = useState<LoadedAudio | null>(null);
  const [projectName, setProjectName] = useState(() => defaultProjectName());
  const [reviewState, setReviewState] = useState<{
    segments: Segment[];
    target: string;
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
      notify(
        "info",
        "Willkommen. Deepgram API-Key unter Einstellungen hinterlegen."
      );
    }
  }, [apiKey, config, notify]);

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
        });
      }
      void refreshRecent();
      notify(
        "success",
        reviewableSpeakerCount > 0
          ? "Transkript gespeichert. Sprecher jetzt pruefen."
          : "Transkript gespeichert."
      );
    }
  }, [
    txState.stage,
    txState.segments,
    txState.transcriptPath,
    refreshRecent,
    notify,
  ]);

  useEffect(() => {
    if (txState.stage === "error" && txState.error) {
      notify("error", txState.error);
    }
  }, [txState.stage, txState.error, notify]);

  const startTranscription = useCallback(async () => {
    if (!loaded || !config) return;
    if (!apiKey) {
      notify("warn", "API-Key fehlt. Siehe Einstellungen.");
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
  }, [loaded, config, apiKey, notify, projectName, startTx]);

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
        notify("success", "Einstellungen gespeichert.");
        setSettingsOpen(false);
      } catch (err) {
        notify("error", `Speichern fehlgeschlagen: ${(err as Error).message}`);
      }
    },
    [patchConfig, refreshKeyterms, refreshRecent, saveApiKey, notify]
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
        await refreshRecent();
        notify("success", "Sprechernamen aktualisiert.");
      } catch (err) {
        notify("error", (err as Error).message);
      } finally {
        setReviewState(null);
      }
    },
    [reviewState, refreshRecent, notify]
  );

  const openTranscript = useCallback(
    async (path: string) => {
      try {
        await window.eba.fs.openPath(path);
      } catch (err) {
        notify("error", `Datei konnte nicht geoeffnet werden: ${(err as Error).message}`);
      }
    },
    [notify]
  );

  const revealTranscript = useCallback(
    async (path: string) => {
      try {
        await window.eba.fs.revealInFolder(path);
      } catch (err) {
        notify("error", `Ordner konnte nicht angezeigt werden: ${(err as Error).message}`);
      }
    },
    [notify]
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
          notify("error", `Import fehlgeschlagen: ${(err as Error).message}`);
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
  }, [startTranscription, transcribing, cancelTx, notify, reviewState]);

  const keytermCount = useMemo(() => {
    if (!config) return 0;
    return keytermCounts[config.keytermProfile || "default"] ?? 0;
  }, [config, keytermCounts]);

  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-fg-muted">Lade...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        apiKeyPresent={Boolean(apiKey)}
        endpoint={config.deepgramEndpoint}
        glossary={config.keytermProfile || "default"}
        glossaryCount={keytermCount}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-7 py-6">
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="flex flex-col gap-5 lg:col-span-3">
            <RecordingPanel
              config={config}
              projectName={projectName}
              onProjectNameChange={setProjectName}
              loaded={loaded}
              disabled={transcribing}
              onLoaded={setLoaded}
              onLog={(lvl, m) => window.eba.log(lvl, m)}
            />

            <div className="grid gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={!loaded || transcribing}
                onClick={startTranscription}
                title="Cmd/Ctrl + T"
              >
                {transcribing ? "Laeuft..." : "Transkribieren"}
              </button>
              {loaded && (
                <p className="text-xs text-fg-muted">
                  Bereit: {loaded.filename}
                  {loaded.isRecordedStereo
                    ? " (aufgenommene Stereo-Datei)"
                    : ""}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-5 lg:col-span-2">
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
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-7 py-2 text-xs text-fg-muted">
          <span>
            Shortcuts: <kbd>⌘T</kbd> Transkribieren · <kbd>⌘O</kbd> Import ·
            <kbd>⌘,</kbd> Einstellungen · <kbd>Esc</kbd> Abbrechen
          </span>
          <span>Version 0.1.0</span>
        </div>
      </footer>

      {settingsOpen && (
        <SettingsPanel
          config={config}
          apiKey={apiKey}
          keytermProfiles={keytermProfiles}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
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
