import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppConfig } from "@shared/ipc";
import {
  filterLoopbackDevices,
  listInputDevices,
  type AudioInputDevice,
} from "../lib/devices";
import { DEFAULT_ENDPOINT } from "../lib/deepgram";
import { Card } from "./ui/Card";
import { Field } from "./ui/Field";

const LANGUAGES = [
  { label: "Mehrsprachig (empfohlen)", value: "multi" },
  { label: "Deutsch", value: "de" },
  { label: "Englisch", value: "en" },
  { label: "Franzoesisch", value: "fr" },
  { label: "Spanisch", value: "es" },
  { label: "Italienisch", value: "it" },
];

export function SettingsPanel({
  config,
  apiKey,
  keytermProfiles,
  onClose,
  onSave,
  notify,
}: {
  config: AppConfig;
  apiKey: string;
  keytermProfiles: string[];
  onClose: () => void;
  onSave: (args: {
    patch: Partial<AppConfig>;
    apiKey: string;
  }) => Promise<void>;
  notify: (kind: "info" | "success" | "warn" | "error", msg: string) => void;
}) {
  const [draftKey, setDraftKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [endpoint, setEndpoint] = useState(config.deepgramEndpoint || DEFAULT_ENDPOINT);
  const [language, setLanguage] = useState(config.language || "multi");
  const [keyterm, setKeyterm] = useState(config.keytermProfile || "default");
  const [sysDevice, setSysDevice] = useState(config.systemAudioDevice || "");
  const [outputDir, setOutputDir] = useState(config.outputDir);
  const [allDevices, setAllDevices] = useState<AudioInputDevice[]>([]);
  const [loopback, setLoopback] = useState<AudioInputDevice[]>([]);
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(
      config.systemAudioDevice ||
      (config.deepgramEndpoint || DEFAULT_ENDPOINT) !== DEFAULT_ENDPOINT
    )
  );

  const refreshDevices = useCallback(async () => {
    const all = await listInputDevices();
    const lb = filterLoopbackDevices(all);
    setAllDevices(all);
    setLoopback(lb);
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    setDraftKey(apiKey);
    setEndpoint(config.deepgramEndpoint || DEFAULT_ENDPOINT);
    setLanguage(config.language || "multi");
    setKeyterm(config.keytermProfile || "default");
    setSysDevice(config.systemAudioDevice || "");
    setOutputDir(config.outputDir);
    setAdvancedOpen(
      Boolean(
        config.systemAudioDevice ||
        (config.deepgramEndpoint || DEFAULT_ENDPOINT) !== DEFAULT_ENDPOINT
      )
    );
  }, [apiKey, config]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const deviceOptions = useMemo(() => {
    const seen = new Set<string>();
    const merged: AudioInputDevice[] = [];
    for (const d of [...loopback, ...allDevices]) {
      if (seen.has(d.label)) continue;
      seen.add(d.label);
      merged.push(d);
    }
    return merged;
  }, [loopback, allDevices]);

  const pickDirectory = async () => {
    const chosen = await window.eba.fs.chooseDirectory(outputDir);
    if (chosen) setOutputDir(chosen);
  };

  const detectLoopback = async () => {
    const all = await listInputDevices();
    const lb = filterLoopbackDevices(all);
    setAllDevices(all);
    if (lb.length) {
      setSysDevice(lb[0].label);
      setLoopback(lb);
      notify(
        "success",
        `Loopback-Geraet gefunden: ${lb[0].label}`
      );
    } else {
      setLoopback([]);
      notify(
        "warn",
        "Kein Loopback-Geraet. macOS: BlackHole installieren."
      );
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const nextOutputDir =
        outputDir.trim() || (await window.eba.fs.defaultOutputDir());
      setOutputDir(nextOutputDir);
      await onSave({
        apiKey: draftKey.trim(),
        patch: {
          language,
          keytermProfile: keyterm,
          deepgramEndpoint: endpoint.trim() || DEFAULT_ENDPOINT,
          systemAudioDevice: sysDevice.trim(),
          outputDir: nextOutputDir,
        },
      });
    } finally {
      setSaving(false);
    }
  };

  const openOutputDir = async () => {
    if (!outputDir.trim()) return;
    try {
      await window.eba.fs.openPath(outputDir);
    } catch (err) {
      notify("error", `Ordner konnte nicht geoeffnet werden: ${(err as Error).message}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-black/30 p-8"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl">
        <Card
          title="Einstellungen"
          right={
            <button type="button" className="btn-ghost" onClick={onClose}>
              Schliessen
            </button>
          }
        >
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-4">
              <SectionTitle>Zugang</SectionTitle>
              <Field label="API-Key (gespeichert im OS-Keychain)">
                <div className="flex gap-2">
                  <input
                    className="input"
                    type={showKey ? "text" : "password"}
                    value={draftKey}
                    onChange={(e) => setDraftKey(e.target.value)}
                    placeholder="dg_..."
                  />
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? "Verbergen" : "Anzeigen"}
                  </button>
                </div>
              </Field>
            </section>

            <section className="flex flex-col gap-4">
              <SectionTitle>Aufnahme</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Sprache">
                  <select
                    className="input"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label} ({l.value})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Keyterm-Profil (Glossar)">
                  <select
                    className="input"
                    value={keyterm}
                    onChange={(e) => setKeyterm(e.target.value)}
                  >
                    {keytermProfiles.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <p className="text-xs text-fg-muted">
                System-Audio wird automatisch erkannt, wenn moeglich. Manuelle
                Auswahl und Endpoint liegen unter "Erweitert".
              </p>
            </section>

            <section className="flex flex-col gap-4">
              <SectionTitle>Speicherort</SectionTitle>
              <Field label="Ausgabe-Verzeichnis">
                <div className="flex gap-2">
                  <input
                    className="input"
                    value={outputDir}
                    onChange={(e) => setOutputDir(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={pickDirectory}
                    disabled={saving}
                  >
                    ...
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={openOutputDir}
                    disabled={!outputDir.trim() || saving}
                  >
                    Oeffnen
                  </button>
                </div>
              </Field>
            </section>

            <details
              className="rounded-lg border border-line bg-bg-inset/70 px-4 py-3"
              open={advancedOpen}
              onToggle={(e) =>
                setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)
              }
            >
              <summary className="cursor-pointer list-none text-sm font-semibold text-fg">
                Erweitert
              </summary>
              <div className="mt-4 flex flex-col gap-4">
                <Field label="Endpoint" hint="Standard: https://api.eu.deepgram.com">
                  <input
                    className="input"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                  />
                </Field>
                <Field
                  label="System-Audio Geraet"
                  hint="Windows: meist automatisch. macOS: BlackHole + Multi-Output-Device. Linux: Monitor of …"
                >
                  <div className="flex gap-2">
                    <input
                      className="input"
                      list="sys-devices"
                      value={sysDevice}
                      onChange={(e) => setSysDevice(e.target.value)}
                      placeholder="z.B. BlackHole 2ch"
                    />
                    <datalist id="sys-devices">
                      {deviceOptions.map((d) => (
                        <option key={d.deviceId} value={d.label} />
                      ))}
                    </datalist>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={detectLoopback}
                    >
                      Erkennen
                    </button>
                  </div>
                </Field>
              </div>
            </details>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={onClose}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={save}
                disabled={saving}
              >
                {saving ? "Speichert..." : "Speichern"}
              </button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
      {children}
    </h3>
  );
}
