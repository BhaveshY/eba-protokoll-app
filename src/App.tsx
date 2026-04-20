import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { ProgressPanel } from "./components/ProgressPanel";
import { RecentList } from "./components/RecentList";
import { RecordingPanel, type LoadedAudio } from "./components/RecordingPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SpeakerRenameDialog } from "./components/SpeakerRenameDialog";
import { Toast } from "./components/ui/Toast";
import { formatTranscript } from "./lib/transcript";
import type { Segment } from "./lib/types";
import { useAppStore } from "./state/useAppStore";
import { useTranscription } from "./state/useTranscription";

export function App() {
  const store = useAppStore();
  const tx = useTranscription();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loaded, setLoaded] = useState<LoadedAudio | null>(null);
  const [renameSegments, setRenameSegments] = useState<Segment[] | null>(null);
  const [renameTarget, setRenameTarget] = useState<string>("");

  const transcribing = tx.state.stage !== null &&
    !["done", "error", "cancelled"].includes(tx.state.stage);

  // Prompt for API key on first run
  const onboardedRef = useMemo(() => ({ done: false }), []);
  useEffect(() => {
    if (!store.config) return;
    if (!store.apiKey && !onboardedRef.done) {
      onboardedRef.done = true;
      store.notify(
        "info",
        "Willkommen. Deepgram API-Key unter Einstellungen hinterlegen."
      );
    }
  }, [store, onboardedRef]);

  // Show rename dialog when transcription succeeds
  useEffect(() => {
    if (tx.state.stage === "done" && tx.state.segments.length > 0) {
      setRenameSegments(tx.state.segments);
      setRenameTarget(tx.state.transcriptPath);
      store.refreshRecent();
      store.notify("success", `Transkript gespeichert.`);
    }
    if (tx.state.stage === "error" && tx.state.error) {
      store.notify("error", tx.state.error);
    }
  }, [tx.state.stage, tx.state.segments, tx.state.transcriptPath, tx.state.error, store]);

  const startTranscription = useCallback(async () => {
    if (!loaded || !store.config) return;
    if (!store.apiKey) {
      store.notify("warn", "API-Key fehlt. Siehe Einstellungen.");
      setSettingsOpen(true);
      return;
    }
    const keyterms = await window.eba.keyterms.load(
      store.config.keytermProfile || "default"
    );
    const project = deriveProjectName(loaded.filename);
    await tx.start({
      apiKey: store.apiKey,
      config: store.config,
      audioBlob: loaded.blob,
      filename: loaded.filename,
      isRecordedStereo: loaded.isRecordedStereo,
      keyterms,
      project,
    });
  }, [loaded, store, tx]);

  const saveSettings = useCallback(
    async ({
      apiKey,
      patch,
    }: {
      apiKey: string;
      patch: Parameters<typeof store.patchConfig>[0];
    }) => {
      try {
        await store.saveApiKey(apiKey);
        await store.patchConfig(patch);
        await window.eba.fs.ensureOutputDirs(
          patch.outputDir || store.config?.outputDir || ""
        );
        await store.refreshKeyterms();
        await store.refreshRecent();
        store.notify("success", "Einstellungen gespeichert.");
        setSettingsOpen(false);
      } catch (err) {
        store.notify("error", `Speichern fehlgeschlagen: ${(err as Error).message}`);
      }
    },
    [store]
  );

  const confirmRename = useCallback(
    async (names: Record<string, string>) => {
      if (!renameSegments || !renameTarget || !store.config) {
        setRenameSegments(null);
        return;
      }
      try {
        await store.patchConfig({ speakerNames: names });
        const text = formatTranscript(renameSegments, names);
        await window.eba.fs.writeTranscript(renameTarget, text);
        await store.refreshRecent();
        store.notify("success", "Sprechernamen aktualisiert.");
      } catch (err) {
        store.notify("error", (err as Error).message);
      } finally {
        setRenameSegments(null);
      }
    },
    [renameSegments, renameTarget, store]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "t") {
        e.preventDefault();
        await startTranscription();
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        const p = await window.eba.fs.chooseAudioFile();
        if (p) {
          const bytes = await window.eba.fs.readFileAsBytes(p);
          setLoaded({
            blob: new Blob([bytes]),
            filename: p.split(/[/\\]/).pop() || "audio",
            isRecordedStereo: false,
            durationSec: 0,
          });
        }
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === "Escape") {
        if (transcribing) tx.cancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [startTranscription, transcribing, tx]);

  const keytermCount = useMemo(() => {
    // Rough display in header — actual count is loaded lazily; show profile name here.
    return 0;
  }, []);

  if (!store.config) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-fg-muted">Lade...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        apiKeyPresent={Boolean(store.apiKey)}
        endpoint={store.config.deepgramEndpoint}
        glossary={store.config.keytermProfile || "default"}
        glossaryCount={keytermCount}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-7 py-6">
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="flex flex-col gap-5 lg:col-span-3">
            <RecordingPanel
              config={store.config}
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
              tx={tx.state}
              isActive={transcribing}
              onCancel={tx.cancel}
            />
            <RecentList
              items={store.recent}
              onOpen={(p) => window.eba.fs.openPath(p)}
              onReveal={(p) => window.eba.fs.revealInFolder(p)}
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
          config={store.config}
          apiKey={store.apiKey}
          keytermProfiles={store.keytermProfiles}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
          notify={store.notify}
        />
      )}

      {renameSegments && (
        <SpeakerRenameDialog
          segments={renameSegments}
          existing={store.config.speakerNames}
          onCancel={() => setRenameSegments(null)}
          onConfirm={confirmRename}
        />
      )}

      {store.toast && (
        <Toast
          kind={store.toast.kind}
          message={store.toast.message}
          onDismiss={store.dismissToast}
        />
      )}
    </div>
  );
}

function deriveProjectName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return base || "Besprechung";
}
