# EBA Protokoll App

## Was ist das?

Die EBA Protokoll App ist eine lokale Meeting-Aufnahme- und Transkriptions-Anwendung
fuer Windows 11. Sie nimmt Meetings auf (Mikrofon + System-Audio), transkribiert das
Gesprochene automatisch und erkennt dabei, welcher Sprecher was gesagt hat
(Speaker Diarization). So entsteht aus jedem Meeting ein strukturiertes Transkript
mit Zeitstempeln und Sprecherzuordnung -- die perfekte Grundlage fuer ein
Meeting-Protokoll.

Alle Daten bleiben lokal auf dem Rechner. Es werden keine Audio- oder Textdaten
ins Internet uebertragen. Die Transkription laeuft GPU-beschleunigt ueber
NVIDIA Parakeet TDT v3 mit CUDA.


## Voraussetzungen

| Komponente        | Anforderung                                                  |
|-------------------|--------------------------------------------------------------|
| Betriebssystem    | Windows 11                                                   |
| Python            | 3.10 oder neuer (empfohlen: 3.12)                           |
| GPU               | NVIDIA GTX 10xx/16xx oder neuer, mindestens 4 GB VRAM       |
| FFmpeg            | Muss installiert und im PATH sein (siehe unten)              |
| HuggingFace-Konto | Kostenloses Konto fuer die Sprechererkennung (siehe unten)  |


## Installation

### Schritt 1: Python installieren

1. Python von https://www.python.org/downloads/ herunterladen (Version 3.12 empfohlen).
2. Beim Installer UNBEDINGT den Haken bei **"Add Python to PATH"** setzen.
3. Installation durchfuehren.
4. Pruefen: Eingabeaufforderung oeffnen und eingeben:
   ```
   python --version
   ```
   Es sollte z.B. `Python 3.12.x` angezeigt werden.

### Schritt 2: FFmpeg installieren

1. FFmpeg herunterladen von: https://www.gyan.dev/ffmpeg/builds/
   - Empfohlen: "ffmpeg-release-essentials.zip" herunterladen.
2. Die ZIP-Datei entpacken, z.B. nach `C:\ffmpeg`.
3. Den Ordner `C:\ffmpeg\bin` zum System-PATH hinzufuegen:
   - Windows-Taste druecken, "Umgebungsvariablen" eingeben.
   - "Systemumgebungsvariablen bearbeiten" oeffnen.
   - Unter "Systemvariablen" die Variable `Path` auswaehlen und "Bearbeiten" klicken.
   - "Neu" klicken und `C:\ffmpeg\bin` eingeben.
   - Alle Dialoge mit "OK" bestaetigen.
4. Pruefen: Neue Eingabeaufforderung oeffnen und eingeben:
   ```
   ffmpeg -version
   ```
   Es sollte die FFmpeg-Version angezeigt werden.

### Schritt 3: HuggingFace einrichten

Die Sprechererkennung nutzt pyannote-audio Community-Modelle von HuggingFace.
Dafuer ist ein kostenloses Konto noetig, und die Nutzungslizenzen muessen
akzeptiert werden.

1. Kostenloses Konto erstellen auf https://huggingface.co/join
2. Lizenzbedingungen auf BEIDEN Seiten akzeptieren (eingeloggt sein!):
   - https://huggingface.co/pyannote/speaker-diarization-community-1
   - https://huggingface.co/pyannote/segmentation-3.0
   - Auf beiden Seiten ganz unten auf "Agree and access repository" klicken.
3. Zugangs-Token erstellen:
   - https://huggingface.co/settings/tokens oeffnen.
   - "New token" klicken, Namen vergeben (z.B. "eba-protokoll"), Typ "Read".
   - Token kopieren und sicher aufbewahren. Diesen Token braucht die App spaeter.

### Schritt 4: install.bat ausfuehren

1. Die Datei `install.bat` im Projektordner doppelklicken.
2. Die Installation dauert ca. 5-15 Minuten (abhaengig von der Internetverbindung).
3. Es werden automatisch installiert:
   - PyTorch mit CUDA-Unterstuetzung
   - onnx-asr (Parakeet TDT) und alle Abhaengigkeiten
   - Weitere benoetigte Pakete

Hinweis: PyTorch mit CUDA wird separat VOR den anderen Paketen installiert.
Die Datei `requirements.txt` enthaelt die restlichen Abhaengigkeiten.


## Verwendung

### Schritt 1: App starten

Die App ueber die Desktop-Verknuepfung starten (wird bei der Installation angelegt).

### Schritt 2: Einstellungen pruefen

Beim ersten Start die Einstellungen oeffnen und konfigurieren:
- **HuggingFace Token**: Den in Schritt 3 der Installation erstellten Token eingeben.
- **Modell**: Transkriptionsmodell auswaehlen (Standard: `small` fuer schnelle Verarbeitung,
  `medium` oder `large-v3` fuer bessere Qualitaet bei mehr VRAM).

### Schritt 3: Meeting aufnehmen

1. **AUFNAHME STARTEN** klicken.
2. Das Meeting ganz normal fuehren -- die App nimmt Mikrofon und System-Audio
   (z.B. aus Teams/Zoom) gleichzeitig auf.
3. Nach dem Meeting **STOPPEN** klicken.
4. Die Aufnahme wird automatisch als WAV-Datei im Ordner `aufnahmen/` gespeichert.

### Schritt 4: Transkribieren

1. **TRANSKRIBIEREN** klicken.
2. Die Verarbeitung dauert einige Minuten, abhaengig von der Laenge der Aufnahme
   und dem gewaehlten Modell.
3. Waehrend der Transkription werden folgende Schritte ausgefuehrt:
   - Spracherkennung (Speech-to-Text via NVIDIA Parakeet TDT v3)
   - Wort-Alignment (genaue Zeitstempel pro Wort)
   - Sprechererkennung (wer hat wann gesprochen)

### Schritt 5: Sprecher benennen

Nach der Transkription werden die erkannten Sprecher angezeigt (z.B. "Sprecher 1",
"Sprecher 2"). Die eigene Stimme wird als "Ich" markiert. Die Sprecher koennen
mit echten Namen versehen werden, damit das Protokoll die richtigen Namen enthaelt.

### Schritt 6: Protokoll erstellen mit Claude Cowork

Das fertige Transkript mit Sprecherzuordnung kann direkt an Claude Cowork
uebergeben werden. Das Cowork-Plugin erstellt daraus ein strukturiertes
Meeting-Protokoll mit:
- Teilnehmerliste
- Besprochene Themen mit Sprecherbeitraegen
- Beschluesse und offene Punkte
- To-Do-Liste mit Verantwortlichkeiten

Siehe `COWORK_PLUGIN_SETUP.md` fuer die Einrichtung des Cowork-Plugins.


## Dateien und Ordner

| Ordner/Datei     | Beschreibung                                                  |
|------------------|---------------------------------------------------------------|
| `aufnahmen/`     | Audio-Dateien im WAV-Format (Mikrofon + System-Audio separat) |
| `transkripte/`   | Transkripte mit Zeitstempeln und Sprecherzuordnung            |
| `protokolle/`    | Fertige Protokolle (erstellt mit Cowork)                      |
| `install.bat`    | Installationsskript                                           |
| `requirements.txt` | Python-Abhaengigkeiten                                      |


## Fehlerbehebung

| Problem                          | Loesung                                                                                       |
|----------------------------------|-----------------------------------------------------------------------------------------------|
| Nur 1 Sprecher erkannt           | HuggingFace Token pruefen. Lizenzen auf BEIDEN Seiten akzeptiert? (speaker-diarization-community-1 UND segmentation-3.0) |
| "CUDA nicht verfuegbar"          | NVIDIA GPU-Treiber aktualisieren. Danach `install.bat` erneut ausfuehren.                     |
| "FFmpeg nicht gefunden"          | FFmpeg installieren und `C:\ffmpeg\bin` zum System-PATH hinzufuegen (siehe Installation).      |
| "TorchCodec DLL Fehler"         | FFmpeg-Installation pruefen. FFmpeg muss korrekt im PATH sein.                                 |
| App startet nicht                | Python installiert? "Add to PATH" aktiviert? In neuer Eingabeaufforderung `python --version` pruefen. |
| Transkription sehr langsam       | GPU wird vermutlich nicht genutzt. CUDA-Installation pruefen: `python -c "import torch; print(torch.cuda.is_available())"` sollte `True` ausgeben. |
| Token wird nicht akzeptiert      | Neuen Token auf https://huggingface.co/settings/tokens erstellen. Typ "Read" auswaehlen.       |
| Kein System-Audio aufgenommen    | WASAPI Loopback pruefen. Audioausgabegeraet in den Windows-Einstellungen kontrollieren.        |


## Technische Details

- **Transkription**: NVIDIA Parakeet TDT v3 (600M Parameter, 25 europaeische Sprachen)
- **Sprechererkennung**: pyannote-audio v4, Modell: speaker-diarization-community-1
- **Audio-Aufnahme**: Mikrofon (Standard-Eingabegeraet) + WASAPI Loopback (System-Audio)
- **Datenschutz**: Laeuft komplett lokal -- keine Audio- oder Textdaten werden ins Internet uebertragen
- **GPU-Beschleunigung**: NVIDIA CUDA fuer schnelle Transkription
- **Ausgabeformat**: Zeitgestempelte Transkripte mit Sprecherzuordnung im Textformat
