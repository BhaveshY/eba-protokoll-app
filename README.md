# EBA Protokoll

Electron-basierte Desktop-App zum Aufnehmen, Transkribieren und
Protokollieren von Meetings. Transkription via Deepgram (Nova-3,
mehrsprachig, Diarisierung). Exportformat bleibt Cowork-kompatibel:
`[HH:MM:SS] Sprechername: Text`. Optional erzeugt die App daneben eine
synchronisierte `.srt`-Untertiteldatei fuer Video-Workflows.


## End-User Installation

### Windows

1. `EBA-Protokoll-Setup-<version>.exe` aus den Releases herunterladen.
2. Doppelklick. Dem Wizard folgen. Start-Menü- und Desktop-Verknüpfung
   werden automatisch angelegt.
3. App starten, unter **Einstellungen** den Deepgram API-Key eintragen.

Hinweis: Der Installer ist nicht kommerziell code-signiert. Windows
SmartScreen zeigt beim ersten Start einmalig eine Warnung.
„Weitere Informationen -> Trotzdem ausführen”.

### macOS

1. `EBA-Protokoll-<version>-arm64-mac.zip` (M1/M2/M3) oder
   `EBA-Protokoll-<version>-x64-mac.zip` (Intel) herunterladen.
2. ZIP entpacken. `EBA Protokoll.app` in **Programme** ziehen.
3. **Erster Start**: Rechtsklick auf die App -> **Öffnen**. macOS fragt
   einmalig nach. Danach startet die App per Doppelklick.
4. Für System-Audio: BlackHole installieren
   (https://existential.audio/blackhole/) und in Audio-MIDI-Setup ein
   Multi-Output-Device anlegen.

Die App ist nicht notarisiert (Apple Developer ID kostet 99 USD/Jahr).
Der Rechtsklick-Öffnen-Schritt ist einmalig pro Rechner.

### Linux

`EBA-Protokoll-<version>-x64.AppImage` herunterladen, ausführbar machen,
doppelklicken. Für System-Audio: PulseAudio/PipeWire „Monitor of …“-Quelle
in den Einstellungen auswählen.


## Benutzung

1. **Deepgram API-Key** unter Einstellungen eintragen (Keychain).
2. **Aufnehmen** klicken. Die App nimmt Mikrofon + System-Audio parallel auf
   und zeigt eine Live-Aufnahmeleiste mit Timer und Pegeln.
3. **Stoppen** in der Aufnahmeleiste -> Audio wird als kanalgetreue WAV-Datei
   unter `aufnahmen/` gespeichert und die Transkription startet automatisch.
4. Bei importierten Dateien **Datei transkribieren** klicken. Stages: Audio ->
   Upload -> Deepgram -> Speichern.
5. **Sprecher zuordnen**: echte Namen eintragen. Deepgram-Diarisierung wird
   kanalbewusst uebernommen, damit Sprecher nicht zusammenfallen.
6. Das Transkript landet unter `transkripte/` im Ausgabe-Verzeichnis.
   Format ist Cowork-kompatibel. Wenn Untertitel aktiviert sind, wird daneben
   eine gleichnamige `.srt`-Datei fuer Video-Player und Video-Editoren erzeugt.

### Weitere Funktionen

- **Oberflächensprache** wechseln: DE / EN im Header.
- **Glossar-Editor** (Einstellungen → Glossar): Profile mit Fachbegriffen
  pflegen, die an Deepgram als `keyterm` mitgegeben werden.
- **Deepgram-Qualität**: Modell-/Genauigkeits-Einstellungen unter
  Einstellungen.
- **Tastenkürzel**: `⌘/Ctrl + T` Transkribieren, `⌘/Ctrl + O` Datei
  importieren, `⌘/Ctrl + ,` Einstellungen, `Esc` laufende Transkription
  abbrechen.


## Keyterms / Glossar

`keyterms.json` enthält Profile mit Fachbegriffen, die beim Upload als
`keyterm`-Parameter an Deepgram gesendet werden und die Erkennungsgenauigkeit
für domänenspezifisches Vokabular verbessern.


## Entwicklung

```bash
npm install
npm run dev        # Vite + Electron im Dev-Modus
npm run typecheck
npm test
```

Build-Installer selbst erzeugen: siehe [BUILDING.md](BUILDING.md).


## Ordnerstruktur

```
electron/          Electron main + preload (TypeScript)
src/               React renderer (TypeScript)
  components/      UI components
  lib/             Deepgram client, recorder, transcript logic
  state/           React hooks für State
shared/            Typen, die Main + Renderer teilen (IPC)
tests/             Vitest
keyterms.json      Glossar-Profile
```
