import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppConfig, UiLanguage } from "@shared/ipc";
import {
  filterLoopbackDevices,
  listInputDevices,
  type AudioInputDevice,
} from "../lib/devices";
import { DEFAULT_ENDPOINT } from "../lib/deepgram";
import {
  SUPPORTED_LANGUAGES,
  useT,
  type TranslationKey,
} from "../lib/i18n";
import { Field } from "./ui/Field";
import { LanguageToggle } from "./ui/LanguageToggle";
import { Switch } from "./ui/Switch";

const TRANSCRIPT_LANGUAGES: Array<{ value: string; labelKey: TranslationKey }> = [
  { value: "multi", labelKey: "settings.transcriptLanguage.multi" },
  { value: "de", labelKey: "settings.transcriptLanguage.de" },
  { value: "en", labelKey: "settings.transcriptLanguage.en" },
  { value: "fr", labelKey: "settings.transcriptLanguage.fr" },
  { value: "es", labelKey: "settings.transcriptLanguage.es" },
  { value: "it", labelKey: "settings.transcriptLanguage.it" },
];

export function SettingsPanel({
  config,
  apiKey,
  keytermProfiles,
  onClose,
  onSave,
  onChangeUiLanguage,
  onOpenGlossary,
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
  onChangeUiLanguage: (next: UiLanguage) => void;
  onOpenGlossary: () => void;
  notify: (kind: "info" | "success" | "warn" | "error", msg: string) => void;
}) {
  const t = useT();
  const [draftKey, setDraftKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [endpoint, setEndpoint] = useState(config.deepgramEndpoint || DEFAULT_ENDPOINT);
  const [language, setLanguage] = useState(config.language || "multi");
  const [keyterm, setKeyterm] = useState(config.keytermProfile || "default");
  const [sysDevice, setSysDevice] = useState(config.systemAudioDevice || "");
  const [outputDir, setOutputDir] = useState(config.outputDir);
  const [smartFormat, setSmartFormat] = useState(config.smartFormat);
  const [filterFillers, setFilterFillers] = useState(config.filterFillers);
  const [paragraphs, setParagraphs] = useState(config.paragraphs);
  const [summarize, setSummarize] = useState(config.summarize);
  const [generateSrt, setGenerateSrt] = useState(config.generateSrt);
  const [keytermCount, setKeytermCount] = useState<number | null>(null);
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
    setSmartFormat(config.smartFormat);
    setFilterFillers(config.filterFillers);
    setParagraphs(config.paragraphs);
    setSummarize(config.summarize);
    setGenerateSrt(config.generateSrt);
    setAdvancedOpen(
      Boolean(
        config.systemAudioDevice ||
          (config.deepgramEndpoint || DEFAULT_ENDPOINT) !== DEFAULT_ENDPOINT
      )
    );
  }, [apiKey, config]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const terms = await window.eba.keyterms.load(keyterm);
        if (!cancelled) setKeytermCount(terms.length);
      } catch {
        if (!cancelled) setKeytermCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [keyterm, keytermProfiles]);

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
      notify("success", t("notify.loopbackFound", { name: lb[0].label }));
    } else {
      setLoopback([]);
      notify("warn", t("notify.loopbackMissing"));
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
          smartFormat,
          filterFillers,
          paragraphs,
          summarize,
          generateSrt,
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
      notify(
        "error",
        t("notify.openFolderFailed", { msg: (err as Error).message })
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center overflow-auto bg-fg/20 p-3 backdrop-blur-[2px] sm:p-6"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[min(90vh,780px)] w-full max-w-xl animate-fadeInUp flex-col overflow-hidden rounded-card border border-line bg-bg-card shadow-cardHover"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-fg">
              {t("settings.title")}
            </h2>
            <p className="mt-0.5 text-[11.5px] text-fg-muted">
              {t("settings.description")}
            </p>
          </div>
          <button
            type="button"
            className="btn-quiet -mr-2 px-2"
            onClick={onClose}
            aria-label={t("settings.close")}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M3.5 3.5l7 7M10.5 3.5l-7 7"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="flex flex-col gap-7 overflow-auto px-5 py-5 sm:gap-8 sm:px-6 sm:py-6">
          <Section
            title={t("settings.section.access")}
            description={t("settings.section.access.description")}
          >
            <Field label={t("settings.apiKey")}>
              <div className="flex gap-2">
                <input
                  className="input font-mono text-[12.5px]"
                  type={showKey ? "text" : "password"}
                  value={draftKey}
                  onChange={(e) => setDraftKey(e.target.value)}
                  placeholder={t("settings.apiKey.placeholder")}
                />
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? t("settings.apiKey.hide") : t("settings.apiKey.show")}
                </button>
              </div>
            </Field>
          </Section>

          <Section
            title={t("settings.section.appearance")}
            description={t("settings.appearance.description")}
          >
            <Field label={t("settings.appearance.language")}>
              <div className="flex items-center gap-3">
                <LanguageToggle
                  value={config.uiLanguage}
                  onChange={onChangeUiLanguage}
                />
                <span className="text-[12px] text-fg-muted">
                  {
                    SUPPORTED_LANGUAGES.find(
                      (l) => l.value === config.uiLanguage
                    )?.labelNative
                  }
                </span>
              </div>
            </Field>
          </Section>

          <Section title={t("settings.section.recording")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("settings.recording.transcriptLanguage")}>
                <select
                  className="input"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  {TRANSCRIPT_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {t(l.labelKey)} ({l.value})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("settings.recording.keytermProfile")}>
                <div className="flex gap-2">
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
                  <button
                    type="button"
                    className="btn-ghost whitespace-nowrap"
                    onClick={onOpenGlossary}
                  >
                    {t("settings.recording.glossaryManage")}
                  </button>
                </div>
                {keytermCount !== null && (
                  <span className="mt-1 text-[11px] text-fg-subtle">
                    {t("settings.recording.glossaryCount", {
                      count: keytermCount,
                    })}
                  </span>
                )}
              </Field>
            </div>
            <p className="text-[11.5px] leading-relaxed text-fg-subtle">
              {t("settings.recording.hint")}
            </p>
          </Section>

          <Section
            title={t("settings.section.intelligence")}
            description={t("settings.intelligence.description")}
          >
            <div className="divide-y divide-line rounded-lg border border-line bg-bg-subtle px-4">
              <Switch
                checked={smartFormat}
                onChange={setSmartFormat}
                label={t("settings.intelligence.smartFormat")}
                hint={t("settings.intelligence.smartFormat.hint")}
              />
              <Switch
                checked={paragraphs}
                onChange={setParagraphs}
                label={t("settings.intelligence.paragraphs")}
                hint={t("settings.intelligence.paragraphs.hint")}
              />
              <Switch
                checked={filterFillers}
                onChange={setFilterFillers}
                label={t("settings.intelligence.filterFillers")}
                hint={t("settings.intelligence.filterFillers.hint")}
              />
              <Switch
                checked={summarize}
                onChange={setSummarize}
                label={t("settings.intelligence.summarize")}
                hint={t("settings.intelligence.summarize.hint")}
              />
              <Switch
                checked={generateSrt}
                onChange={setGenerateSrt}
                label={t("settings.intelligence.srt")}
                hint={t("settings.intelligence.srt.hint")}
              />
            </div>
          </Section>

          <Section title={t("settings.section.storage")}>
            <Field label={t("settings.storage.outputDir")}>
              <div className="flex gap-2">
                <input
                  className="input font-mono text-[12.5px]"
                  value={outputDir}
                  onChange={(e) => setOutputDir(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={pickDirectory}
                  disabled={saving}
                >
                  {t("settings.storage.choose")}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={openOutputDir}
                  disabled={!outputDir.trim() || saving}
                >
                  {t("settings.storage.open")}
                </button>
              </div>
            </Field>
          </Section>

          <details
            className="group rounded-lg border border-line bg-bg-subtle px-4 py-3"
            open={advancedOpen}
            onToggle={(e) =>
              setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)
            }
          >
            <summary className="flex cursor-pointer list-none items-center justify-between text-[12.5px] font-semibold text-fg">
              <span>{t("settings.advanced")}</span>
              <span
                className="text-fg-subtle transition-transform duration-150 group-open:rotate-90"
                aria-hidden
              >
                ›
              </span>
            </summary>
            <div className="mt-4 flex flex-col gap-4">
              <Field
                label={t("settings.advanced.endpoint")}
                hint={t("settings.advanced.endpoint.hint")}
              >
                <input
                  className="input font-mono text-[12.5px]"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </Field>
              <Field
                label={t("settings.advanced.sysDevice")}
                hint={t("settings.advanced.sysDevice.hint")}
              >
                <div className="flex gap-2">
                  <input
                    className="input"
                    list="sys-devices"
                    value={sysDevice}
                    onChange={(e) => setSysDevice(e.target.value)}
                    placeholder={t("settings.advanced.sysDevice.placeholder")}
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
                    {t("settings.advanced.detect")}
                  </button>
                </div>
              </Field>
            </div>
          </details>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-bg-subtle px-5 py-3 sm:px-6">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t("settings.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={save}
            disabled={saving}
          >
            {saving ? t("settings.saving") : t("settings.save")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="section-label">{title}</h3>
        {description && (
          <p className="mt-1 text-[11.5px] leading-relaxed text-fg-subtle">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}
