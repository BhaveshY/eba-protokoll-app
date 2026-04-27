import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { UiLanguage } from "@shared/ipc";

export const SUPPORTED_LANGUAGES: ReadonlyArray<{
  value: UiLanguage;
  labelNative: string;
  labelShort: string;
}> = [
  { value: "de", labelNative: "Deutsch", labelShort: "DE" },
  { value: "en", labelNative: "English", labelShort: "EN" },
];

type Vars = Record<string, string | number>;

const de = {
  // Header
  "app.name": "Transcriptor",
  "app.tagline": "Aufnehmen. Transkribieren. Pruefen.",
  "header.settings": "Einstellungen",
  "header.settings.title": "Einstellungen (Cmd/Ctrl + ,)",
  "header.language.title": "Sprache der Oberflaeche",

  // Recording panel
  "record.projectName": "Projektname",
  "record.projectName.placeholder": "Besprechung",
  "record.status.ready": "Bereit zur Aufnahme.",
  "record.status.opening": "Mikrofon wird geoeffnet …",
  "record.status.recordingLabel": "Aufnahme laeuft",
  "record.status.micPlusSystem": "Mikrofon + System-Audio",
  "record.status.micOnly": "Nur Mikrofon — kein System-Audio-Geraet",
  "record.status.finishing": "Aufnahme wird abgeschlossen …",
  "record.status.readyToTranscribeRec": "Aufnahme bereit fuer Transkription.",
  "record.status.readyToTranscribeFile": "Datei bereit zur Transkription.",
  "record.status.empty": "Die importierte Datei ist leer.",
  "record.status.unsupported":
    "Nicht unterstuetzte Datei. Bitte Audio oder Video importieren.",
  "record.status.multipleDropped":
    "Mehrere Dateien erkannt. Die erste Datei wurde geladen.",
  "record.status.micError": "Mikrofon-Fehler: {msg}",
  "record.status.stopError": "Fehler beim Stoppen: {msg}",
  "record.status.importError": "Import fehlgeschlagen: {msg}",
  "record.action.start": "Aufnahme starten",
  "record.action.stop": "Aufnahme stoppen",
  "record.action.import": "Datei importieren …",
  "record.import.title": "Cmd/Ctrl + O",
  "record.drop.idle": "Datei hierher ziehen oder oben auswaehlen",
  "record.drop.active": "Datei hier ablegen",
  "record.summary.imported": "Importiert · {filename} · {size}",
  "record.summary.recorded": "Aufnahme · {duration} · {size} · {mode}",
  "record.summary.modeStereo": "Stereo (Mic + System)",
  "record.summary.modeMono": "Mono (nur Mic)",

  // App main
  "app.loading": "Lade …",
  "app.action.transcribe": "Transkribieren",
  "app.action.transcribing": "Transkribiere …",
  "app.action.transcribe.title": "Cmd/Ctrl + T",
  "app.loaded.label": "Bereit:",
  "app.loaded.stereoSuffix": " · Stereo (Mic + System)",
  "app.footer.transcribe": "Transkribieren",
  "app.footer.import": "Import",
  "app.footer.settings": "Einstellungen",
  "app.footer.cancel": "Abbrechen",

  // Notifications
  "notify.welcome": "Willkommen. Deepgram API-Key unter Einstellungen hinterlegen.",
  "notify.apiKeyMissing": "API-Key fehlt. Siehe Einstellungen.",
  "notify.transcriptSavedReview":
    "Transkript gespeichert. Sprecher jetzt pruefen.",
  "notify.transcriptSaved": "Transkript gespeichert.",
  "notify.namesUpdated": "Sprechernamen aktualisiert.",
  "notify.openFileFailed": "Datei konnte nicht geoeffnet werden: {msg}",
  "notify.revealFailed": "Ordner konnte nicht angezeigt werden: {msg}",
  "notify.importFailed": "Import fehlgeschlagen: {msg}",
  "notify.settingsSaved": "Einstellungen gespeichert.",
  "notify.saveFailed": "Speichern fehlgeschlagen: {msg}",
  "notify.openFolderFailed": "Ordner konnte nicht geoeffnet werden: {msg}",
  "notify.loopbackFound": "Loopback-Geraet gefunden: {name}",
  "notify.loopbackMissing":
    "Kein Loopback-Geraet. macOS: BlackHole installieren.",

  // Progress panel
  "progress.title": "Fortschritt",
  "progress.cancel": "Abbrechen",
  "progress.working": "Arbeite …",
  "progress.ready": "Bereit.",

  // Stage progress
  "stage.audio": "Audio",
  "stage.upload": "Upload",
  "stage.deepgram": "Deepgram",
  "stage.save": "Speichern",

  // Recent list
  "recent.title": "Letzte Transkripte",
  "recent.empty": "Noch keine Transkripte.",
  "recent.reveal": "Im Ordner zeigen",
  "recent.hasSubtitles": "SRT-Untertitel",

  // Settings panel
  "settings.title": "Einstellungen",
  "settings.description": "API-Key, Aufnahme und Ausgabepfad.",
  "settings.close": "Schliessen",
  "settings.save": "Speichern",
  "settings.saving": "Speichert …",
  "settings.cancel": "Abbrechen",

  "settings.section.access": "Zugang",
  "settings.section.access.description":
    "Wird verschluesselt im Betriebssystem-Keychain gespeichert.",
  "settings.apiKey": "Deepgram API-Key",
  "settings.apiKey.placeholder": "dg_…",
  "settings.apiKey.show": "Anzeigen",
  "settings.apiKey.hide": "Verbergen",

  "settings.section.appearance": "Darstellung",
  "settings.appearance.description":
    "Sprache der App-Oberflaeche. Wirkt sofort.",
  "settings.appearance.language": "Sprache der Oberflaeche",

  "settings.section.recording": "Aufnahme",
  "settings.recording.transcriptLanguage": "Transkriptionssprache",
  "settings.recording.keytermProfile": "Glossar-Profil",
  "settings.recording.glossaryManage": "Glossar bearbeiten …",
  "settings.recording.glossaryCount": "{count} Begriffe",
  "settings.recording.hint":
    "System-Audio wird automatisch erkannt, wenn moeglich. Manuelle Auswahl und Endpoint unter „Erweitert“.",
  "settings.section.intelligence": "Transkript-Qualitaet",
  "settings.intelligence.description":
    "Zusaetzliche Deepgram-Funktionen. Wirken sofort beim naechsten Transkript.",
  "settings.intelligence.smartFormat": "Intelligente Formatierung",
  "settings.intelligence.smartFormat.hint":
    "Zahlen, Datum, Waehrung und Einheiten werden korrekt geschrieben.",
  "settings.intelligence.filterFillers": "Fuellwoerter entfernen",
  "settings.intelligence.filterFillers.hint":
    "„aeh“, „aehm“, „um“ und aehnliche Fuellwoerter werden herausgefiltert.",
  "settings.intelligence.paragraphs": "Absaetze",
  "settings.intelligence.paragraphs.hint":
    "Lange Redebeitraege werden in lesbare Absaetze zerlegt.",
  "settings.intelligence.summarize": "Zusammenfassung erzeugen",
  "settings.intelligence.summarize.hint":
    "Speichert eine kurze Zusammenfassung als .summary.txt neben dem Transkript.",
  "settings.intelligence.generateSubtitles": "SRT-Untertitel erzeugen",
  "settings.intelligence.generateSubtitles.hint":
    "Speichert eine synchronisierte .srt-Datei neben dem Transkript.",
  "settings.transcriptLanguage.multi": "Mehrsprachig (empfohlen)",
  "settings.transcriptLanguage.de": "Deutsch",
  "settings.transcriptLanguage.en": "Englisch",
  "settings.transcriptLanguage.fr": "Franzoesisch",
  "settings.transcriptLanguage.es": "Spanisch",
  "settings.transcriptLanguage.it": "Italienisch",

  "settings.section.storage": "Speicherort",
  "settings.storage.outputDir": "Ausgabe-Verzeichnis",
  "settings.storage.choose": "Waehlen",
  "settings.storage.open": "Oeffnen",

  "settings.advanced": "Erweitert",
  "settings.advanced.endpoint": "Endpoint",
  "settings.advanced.endpoint.hint": "Standard: https://api.eu.deepgram.com",
  "settings.advanced.sysDevice": "System-Audio-Geraet",
  "settings.advanced.sysDevice.hint":
    "Windows: meist automatisch. macOS: BlackHole + Multi-Output. Linux: Monitor of …",
  "settings.advanced.sysDevice.placeholder": "z.B. BlackHole 2ch",
  "settings.advanced.detect": "Erkennen",

  // Transcript review
  "review.title": "Transkript pruefen",
  "review.description":
    "Das Transkript ist gespeichert. Weise Sprechern Namen zu — nur die Namen im Export aendern sich.",
  "review.meta.speakers": "Sprecher",
  "review.meta.pending": "Offen",
  "review.speakers.title": "Sprecher",
  "review.speakers.subtitle": "Namen gelten nur fuer dieses Transkript.",
  "review.speakers.empty": "Keine umbenennbaren Sprecher erkannt.",
  "review.speakers.focus": "Fokus",
  "review.speakers.nameLabel": "Name im Export",
  "review.speakers.namePlaceholder": "z.B. Herr Mueller",
  "review.speakers.contributions":
    "{count} Beitraege · {duration} · ab {timestamp}",
  "review.preview.title": "Vorschau",
  "review.preview.all": "Alle Segmente",
  "review.preview.filtered": "{name} im Verlauf",
  "review.preview.showAll": "Alle anzeigen",
  "review.preview.note":
    "„Ich“ bleibt fix. Leere Felder lassen Originalnamen wie „Sprecher 1“ bestehen.",
  "review.preview.empty": "Keine Segmente fuer diese Auswahl.",
  "review.footer.allNamed": "Alle erkannten Sprecher haben einen Namen.",
  "review.footer.pending": "{count} Sprecher verwenden noch Platzhalter.",
  "review.action.reset": "Zuruecksetzen",
  "review.action.close": "Schliessen",
  "review.action.save": "Transkript aktualisieren",
  "review.action.saving": "Speichert …",

  // Glossary editor
  "glossary.title": "Glossar",
  "glossary.description":
    "Technische Begriffe, Eigennamen und Abkuerzungen — damit Deepgram sie korrekt erkennt.",
  "glossary.profile": "Profil",
  "glossary.profile.new": "Neues Profil …",
  "glossary.profile.newLabel": "Neues Profil",
  "glossary.profile.placeholder": "z.B. Projekt Nord",
  "glossary.profile.create": "Anlegen",
  "glossary.profile.delete": "Profil loeschen",
  "glossary.profile.deleteConfirm":
    "Profil „{name}“ wirklich loeschen?",
  "glossary.profile.protectedDefault":
    "Das Standard-Profil kann nicht geloescht werden.",
  "glossary.terms.count": "{count} Begriffe",
  "glossary.terms.empty":
    "Noch keine Begriffe. Einen Begriff eingeben und Enter druecken.",
  "glossary.terms.add": "Hinzufuegen",
  "glossary.terms.addPlaceholder": "Neuer Begriff …",
  "glossary.terms.search": "Suchen …",
  "glossary.terms.remove": "Entfernen",
  "glossary.terms.noMatches": "Keine Treffer.",
  "glossary.action.done": "Fertig",
  "glossary.action.cancel": "Abbrechen",
  "glossary.save.success": "Glossar gespeichert.",
  "glossary.save.failed": "Glossar speichern fehlgeschlagen: {msg}",
  "glossary.profile.createFailed": "Profil anlegen fehlgeschlagen: {msg}",
  "glossary.profile.deleteFailed": "Profil loeschen fehlgeschlagen: {msg}",

  // Toast
  "toast.close": "Schliessen",
};

type Dict = typeof de;
export type TranslationKey = keyof Dict;

const en: Dict = {
  // Header
  "app.name": "Transcriptor",
  "app.tagline": "Record. Transcribe. Review.",
  "header.settings": "Settings",
  "header.settings.title": "Settings (Cmd/Ctrl + ,)",
  "header.language.title": "Interface language",

  // Recording panel
  "record.projectName": "Project name",
  "record.projectName.placeholder": "Meeting",
  "record.status.ready": "Ready to record.",
  "record.status.opening": "Opening microphone …",
  "record.status.recordingLabel": "Recording",
  "record.status.micPlusSystem": "Microphone + system audio",
  "record.status.micOnly": "Microphone only — no system-audio device",
  "record.status.finishing": "Finishing recording …",
  "record.status.readyToTranscribeRec": "Recording ready to transcribe.",
  "record.status.readyToTranscribeFile": "File ready to transcribe.",
  "record.status.empty": "The imported file is empty.",
  "record.status.unsupported": "Unsupported file. Please import audio or video.",
  "record.status.multipleDropped": "Multiple files detected. The first was loaded.",
  "record.status.micError": "Microphone error: {msg}",
  "record.status.stopError": "Stop error: {msg}",
  "record.status.importError": "Import failed: {msg}",
  "record.action.start": "Start recording",
  "record.action.stop": "Stop recording",
  "record.action.import": "Import file …",
  "record.import.title": "Cmd/Ctrl + O",
  "record.drop.idle": "Drag a file here or pick one above",
  "record.drop.active": "Drop file here",
  "record.summary.imported": "Imported · {filename} · {size}",
  "record.summary.recorded": "Recording · {duration} · {size} · {mode}",
  "record.summary.modeStereo": "Stereo (mic + system)",
  "record.summary.modeMono": "Mono (mic only)",

  // App main
  "app.loading": "Loading …",
  "app.action.transcribe": "Transcribe",
  "app.action.transcribing": "Transcribing …",
  "app.action.transcribe.title": "Cmd/Ctrl + T",
  "app.loaded.label": "Ready:",
  "app.loaded.stereoSuffix": " · stereo (mic + system)",
  "app.footer.transcribe": "Transcribe",
  "app.footer.import": "Import",
  "app.footer.settings": "Settings",
  "app.footer.cancel": "Cancel",

  // Notifications
  "notify.welcome": "Welcome. Add your Deepgram API key in Settings.",
  "notify.apiKeyMissing": "API key is missing. See Settings.",
  "notify.transcriptSavedReview": "Transcript saved. Review speakers now.",
  "notify.transcriptSaved": "Transcript saved.",
  "notify.namesUpdated": "Speaker names updated.",
  "notify.openFileFailed": "Could not open file: {msg}",
  "notify.revealFailed": "Could not show folder: {msg}",
  "notify.importFailed": "Import failed: {msg}",
  "notify.settingsSaved": "Settings saved.",
  "notify.saveFailed": "Save failed: {msg}",
  "notify.openFolderFailed": "Could not open folder: {msg}",
  "notify.loopbackFound": "Loopback device found: {name}",
  "notify.loopbackMissing": "No loopback device. macOS: install BlackHole.",

  // Progress panel
  "progress.title": "Progress",
  "progress.cancel": "Cancel",
  "progress.working": "Working …",
  "progress.ready": "Ready.",

  // Stage progress
  "stage.audio": "Audio",
  "stage.upload": "Upload",
  "stage.deepgram": "Deepgram",
  "stage.save": "Save",

  // Recent list
  "recent.title": "Recent transcripts",
  "recent.empty": "No transcripts yet.",
  "recent.reveal": "Show in folder",
  "recent.hasSubtitles": "SRT subtitles",

  // Settings panel
  "settings.title": "Settings",
  "settings.description": "API key, recording, and output directory.",
  "settings.close": "Close",
  "settings.save": "Save",
  "settings.saving": "Saving …",
  "settings.cancel": "Cancel",

  "settings.section.access": "Access",
  "settings.section.access.description":
    "Stored encrypted in the OS keychain.",
  "settings.apiKey": "Deepgram API key",
  "settings.apiKey.placeholder": "dg_…",
  "settings.apiKey.show": "Show",
  "settings.apiKey.hide": "Hide",

  "settings.section.appearance": "Appearance",
  "settings.appearance.description":
    "Language of the app interface. Applies immediately.",
  "settings.appearance.language": "Interface language",

  "settings.section.recording": "Recording",
  "settings.recording.transcriptLanguage": "Transcription language",
  "settings.recording.keytermProfile": "Glossary profile",
  "settings.recording.glossaryManage": "Edit glossary …",
  "settings.recording.glossaryCount": "{count} terms",
  "settings.recording.hint":
    "System audio is auto-detected when possible. Manual selection and endpoint live under “Advanced”.",
  "settings.section.intelligence": "Transcript quality",
  "settings.intelligence.description":
    "Extra Deepgram features. Apply to your next transcript.",
  "settings.intelligence.smartFormat": "Smart formatting",
  "settings.intelligence.smartFormat.hint":
    "Numbers, dates, currency, and units are written correctly.",
  "settings.intelligence.filterFillers": "Remove filler words",
  "settings.intelligence.filterFillers.hint":
    "Drops “um”, “uh”, “ähm” and similar fillers from the transcript.",
  "settings.intelligence.paragraphs": "Paragraphs",
  "settings.intelligence.paragraphs.hint":
    "Long turns are broken into readable paragraphs.",
  "settings.intelligence.summarize": "Generate summary",
  "settings.intelligence.summarize.hint":
    "Saves a short summary as .summary.txt alongside the transcript.",
  "settings.intelligence.generateSubtitles": "Generate SRT subtitles",
  "settings.intelligence.generateSubtitles.hint":
    "Saves a synced .srt file alongside the transcript.",
  "settings.transcriptLanguage.multi": "Multilingual (recommended)",
  "settings.transcriptLanguage.de": "German",
  "settings.transcriptLanguage.en": "English",
  "settings.transcriptLanguage.fr": "French",
  "settings.transcriptLanguage.es": "Spanish",
  "settings.transcriptLanguage.it": "Italian",

  "settings.section.storage": "Storage",
  "settings.storage.outputDir": "Output directory",
  "settings.storage.choose": "Choose",
  "settings.storage.open": "Open",

  "settings.advanced": "Advanced",
  "settings.advanced.endpoint": "Endpoint",
  "settings.advanced.endpoint.hint": "Default: https://api.eu.deepgram.com",
  "settings.advanced.sysDevice": "System-audio device",
  "settings.advanced.sysDevice.hint":
    "Windows: usually automatic. macOS: BlackHole + Multi-Output. Linux: Monitor of …",
  "settings.advanced.sysDevice.placeholder": "e.g. BlackHole 2ch",
  "settings.advanced.detect": "Detect",

  // Transcript review
  "review.title": "Review transcript",
  "review.description":
    "The transcript is saved. Assign speaker names — only the export names change.",
  "review.meta.speakers": "Speakers",
  "review.meta.pending": "Pending",
  "review.speakers.title": "Speakers",
  "review.speakers.subtitle": "Names apply to this transcript only.",
  "review.speakers.empty": "No renameable speakers detected.",
  "review.speakers.focus": "Focus",
  "review.speakers.nameLabel": "Export name",
  "review.speakers.namePlaceholder": "e.g. Ms. Miller",
  "review.speakers.contributions":
    "{count} turns · {duration} · from {timestamp}",
  "review.preview.title": "Preview",
  "review.preview.all": "All segments",
  "review.preview.filtered": "{name} across the meeting",
  "review.preview.showAll": "Show all",
  "review.preview.note":
    "“Me” stays fixed. Empty fields leave original names like “Speaker 1” in place.",
  "review.preview.empty": "No segments for this selection.",
  "review.footer.allNamed": "All detected speakers have a name.",
  "review.footer.pending": "{count} speakers still use placeholders.",
  "review.action.reset": "Reset",
  "review.action.close": "Close",
  "review.action.save": "Update transcript",
  "review.action.saving": "Saving …",

  // Glossary editor
  "glossary.title": "Glossary",
  "glossary.description":
    "Technical terms, names, and abbreviations — so Deepgram recognizes them correctly.",
  "glossary.profile": "Profile",
  "glossary.profile.new": "New profile …",
  "glossary.profile.newLabel": "New profile",
  "glossary.profile.placeholder": "e.g. Project North",
  "glossary.profile.create": "Create",
  "glossary.profile.delete": "Delete profile",
  "glossary.profile.deleteConfirm": "Really delete profile “{name}”?",
  "glossary.profile.protectedDefault":
    "The default profile cannot be deleted.",
  "glossary.terms.count": "{count} terms",
  "glossary.terms.empty":
    "No terms yet. Type a term and press Enter.",
  "glossary.terms.add": "Add",
  "glossary.terms.addPlaceholder": "New term …",
  "glossary.terms.search": "Search …",
  "glossary.terms.remove": "Remove",
  "glossary.terms.noMatches": "No matches.",
  "glossary.action.done": "Done",
  "glossary.action.cancel": "Cancel",
  "glossary.save.success": "Glossary saved.",
  "glossary.save.failed": "Saving glossary failed: {msg}",
  "glossary.profile.createFailed": "Creating profile failed: {msg}",
  "glossary.profile.deleteFailed": "Deleting profile failed: {msg}",

  // Toast
  "toast.close": "Close",
};

const DICTIONARIES: Record<UiLanguage, Dict> = { de, en };

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    name in vars ? String(vars[name]) : `{${name}}`
  );
}

export type TranslateFn = (key: TranslationKey, vars?: Vars) => string;

interface I18nContextValue {
  lang: UiLanguage;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "de",
  t: (key) => key,
});

export function I18nProvider({
  lang,
  children,
}: {
  lang: UiLanguage;
  children: ReactNode;
}) {
  const dict = DICTIONARIES[lang] ?? DICTIONARIES.de;
  const t = useCallback<TranslateFn>(
    (key, vars) => interpolate(dict[key] ?? key, vars),
    [dict]
  );
  const value = useMemo(() => ({ lang, t }), [lang, t]);
  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function useT(): TranslateFn {
  return useContext(I18nContext).t;
}
