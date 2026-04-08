---
name: legal-protocol
description: Use when the user asks to create a "legal protocol", "rechtliches Protokoll", "Wortprotokoll", "verbatim protocol", "legally binding protocol", "formal protocol", "formelles Protokoll", wants a formatted transcript for legal purposes, or mentions "rechtsverbindlich". Reads an EBA transcript file and formats it into a structured, legally bindable meeting record.
argument-hint: <transcript-file-path>
allowed-tools: [Read, Write, Glob, Bash]
---

# Legal Protocol (Rechtliches Wortprotokoll)

You are creating a **legally bindable meeting protocol** (Wortprotokoll) from an EBA transcript file. This document must faithfully represent what was said, by whom, and when — with no interpretation, summarization, or omission.

## Input Format

EBA transcripts can arrive in several formats. You must handle ALL of them:

### Format A — Timestamped with named speakers
```
[00:00:05] Herr Mueller: Guten Morgen zusammen.
[00:00:12] Frau Schmidt: Ja, guten Morgen.
```

### Format B — Timestamped with generic speakers (MOST COMMON)
```
[00:00:05] Sprecher 00: Guten Morgen zusammen.
[00:00:12] Sprecher 01: Ja, guten Morgen.
```
Also: `SPEAKER_00`, `Sprecher 1`, `Speaker 0`, etc.

### Format C — With "Ich" label (recording operator)
```
[00:00:05] Ich: Guten Morgen zusammen, fangen wir an.
[00:00:12] Sprecher 01: Ja, guten Morgen.
```

### Format D — Plain text, no speakers, no timestamps
```
Guten Morgen zusammen, fangen wir an.
Ja, guten Morgen. Ich habe die Unterlagen vorbereitet.
```

### Format E — Raw Whisper output (leading spaces, no structure)
```
 Guten Morgen zusammen, fangen wir an.
 Ja, guten Morgen. Ich habe die Unterlagen vorbereitet.
```

## Step-by-Step Process

### Step 1: Read the Transcript

Read the transcript file the user provides. If no path is given, search the `transkripte/` folder in the working directory or ask for the path.

### Step 2: Identify Speakers

**This step is critical.** Follow the full process in `references/speaker-identification.md`.

Scan the entire transcript for:

1. **Self-introductions**: "Mueller hier.", "Mein Name ist Schmidt.", "Hier spricht Dr. Weber."
2. **Direct address**: "Herr Mueller, was meinen Sie?", "Frau Schmidt, bitte." — the person addressed is the NEXT speaker to respond.
3. **Greetings by name**: "Guten Morgen Herr Mueller" — next response is Mueller.
4. **Third-person references**: "Wie Herr Mueller schon sagte..." — confirms who spoke earlier.
5. **Roll call**: "Mueller, Schmidt, Weber — sind alle da?" — lists participants.
6. **Role signals**: "Als Architekt...", "Aus Sicht der Statik..." — identifies speaker discipline.
7. **Company references**: "Wir bei Solartec..." — identifies affiliation.

Build a speaker map and **present it to the user for confirmation before proceeding**:

```
Sprecheridentifikation:

  Sprecher 00  →  Herr Mueller (Tragwerksplanung)
                   Evidenz: direkte Anrede bei [00:01:18], Selbstvorstellung bei [00:00:12]
  Sprecher 01  →  Frau Schmidt (Brandschutz)
                   Evidenz: "Frau Schmidt, bitte" bei [00:00:35]
  Ich          →  [Nicht identifiziert] (Protokollant / Aufnahme)
  Sprecher 02  →  [Nicht identifiziert]

Stimmt das? Moechten Sie Namen korrigieren oder ergaenzen?
```

**Rules for speaker resolution:**
- NEVER guess a name you're not confident about — keep the original label.
- NEVER assign the same name to two speakers.
- Every name assignment must have evidence from the transcript.
- For unresolved speakers: keep original label (e.g., "Sprecher 02") in the protocol.
- For Format D/E (no speakers): note that speaker attribution was not possible.

### Step 3: Extract Metadata

From the transcript content and filename, determine:
- **Date** — from filename pattern `Projektname_YYYY-MM-DD_HHMMSS.txt`, or ask user
- **Start time** — first timestamp, or "Nicht verfuegbar" if Format D/E
- **End time** — last timestamp, or "Nicht verfuegbar"
- **Participants** — all resolved speaker names + unresolved labels
- **Project name** — from filename or ask user

### Step 4: Format the Legal Protocol

Generate the protocol using the structure below. Use German throughout.

```
================================================================================
                    WORTPROTOKOLL — RECHTLICHE FASSUNG
================================================================================

Projekt:            [Projektname]
Datum:              [TT.MM.JJJJ]
Beginn:             [HH:MM] Uhr
Ende:               [HH:MM] Uhr
Ort / Medium:       [Videokonferenz / Vor Ort — ask user if unknown]
Protokollart:       Woertliches Verlaufsprotokoll (KI-gestuetzte Transkription)

--------------------------------------------------------------------------------
TEILNEHMER
--------------------------------------------------------------------------------

  Nr.  | Name / Kennung           | Funktion / Rolle     | Identifikation
  -----|--------------------------|----------------------|-----------------------
  1    | Herr Mueller             | Tragwerksplanung     | Namentlich identifiziert
  2    | Frau Schmidt             | Brandschutz          | Namentlich identifiziert
  3    | Sprecher 02              | —                    | Nicht identifiziert
  4    | Ich (Protokollant)       | Sitzungsleitung      | Aufnahme-Operator

  Gesamtzahl Teilnehmer: [X]

  Hinweis zur Sprecheridentifikation:
  Die Zuordnung der Sprecherkennungen zu realen Namen erfolgte anhand von
  Namensnennung, direkter Anrede und Kontextinformationen im Gespraech.
  Nicht identifizierte Sprecher sind mit ihrer technischen Kennung
  aufgefuehrt. Die Richtigkeit der Zuordnung ist vom Protokollpruefer
  zu bestaetigen.

--------------------------------------------------------------------------------
HINWEIS ZUR ERSTELLUNG
--------------------------------------------------------------------------------

Dieses Protokoll wurde mittels KI-gestuetzter Spracherkennung erstellt
(Transkription: Whisper / faster-whisper, Formatierung: Claude AI).
Die Transkription erfolgte automatisch und wurde maschinell formatiert.
Inhaltliche Aenderungen gegenueber dem gesprochenen Wort wurden NICHT
vorgenommen. Technisch bedingte Ungenauigkeiten — insbesondere bei
Fachbegriffen, Eigennamen, Zahlenangaben und fremdsprachlichen Ausdruecken —
koennen nicht ausgeschlossen werden.

Dieses Dokument ist erst nach Pruefung und Unterschrift der Teilnehmer
als rechtsverbindlich anzusehen.

================================================================================
                         GESPRAECHSVERLAUF
================================================================================

Die Gespraechsbeitraege sind chronologisch geordnet und nach Themen-
abschnitten gegliedert. Die Themenueberschriften dienen der Orientierung
und sind nicht Bestandteil des gesprochenen Wortes.

--------------------------------------------------------------------------------
Thema 1: [Themenueberschrift]  (ab [HH:MM:SS])
--------------------------------------------------------------------------------

[HH:MM:SS]  HERR MUELLER:
            [Vollstaendiger gesprochener Text, zeilenumbrochen bei ~78 Zeichen.
            Exakter Wortlaut aus dem Transkript — nichts weglassen, nichts
            hinzufuegen, nichts umformulieren.]

[HH:MM:SS]  FRAU SCHMIDT:
            [Vollstaendiger gesprochener Text...]

[HH:MM:SS]  ICH (PROTOKOLLANT):
            [Vollstaendiger gesprochener Text...]

--------------------------------------------------------------------------------
Thema 2: [Themenueberschrift]  (ab [HH:MM:SS])
--------------------------------------------------------------------------------

[HH:MM:SS]  SPRECHER 02:
            [Vollstaendiger gesprochener Text...]

...

================================================================================
                           ABSCHLUSSVERMERKE
================================================================================

Gesamtdauer:        [X] Minuten
Gespraechsbeitraege: [Y] (Gesamtzahl aller Wortmeldungen)
Themenabschnitte:   [Z]

Erstellt am:        [Aktuelles Datum, TT.MM.JJJJ]
Erstellt durch:     KI-gestuetzte Transkription (Claude AI)
Quelldatei:         [Originaltranskript-Dateipfad]

Geprueft durch:     _______________________________ (Unterschrift)
Datum:              _______________________________

Genehmigt durch:    _______________________________ (Unterschrift)
Datum:              _______________________________

================================================================================
                         UNTERSCHRIFTENSEITE
================================================================================

Mit ihrer Unterschrift bestaetigen die Teilnehmer die inhaltliche
Richtigkeit dieses Protokolls.

Name                          Unterschrift                 Datum
__________________________    __________________________   ______________
__________________________    __________________________   ______________
__________________________    __________________________   ______________
__________________________    __________________________   ______________
__________________________    __________________________   ______________
```

## Critical Rules

1. **NEVER omit, summarize, or paraphrase** any spoken content. Every word from the transcript must appear.
2. **NEVER add content** that was not in the original transcript. Topic headings and structural elements are the only additions.
3. **Preserve all technical terms** (Fachbegriffe) exactly as transcribed.
4. **Preserve speaker attributions** exactly — do not reassign speech to a different person.
5. **Speaker names in UPPERCASE** in the dialogue section for visual clarity.
6. **Maintain strict chronological order** — never reorder statements.
7. **Mark unclear passages** with `[unverstaendlich]` if the transcript contains garbled or incoherent text.
8. **Mark overlapping speech** with `[Ueberlappung]` if detectable from timestamps.
9. **Format consistently**: dates as TT.MM.JJJJ, times as HH:MM Uhr, numbers written out if spoken ("zweiundzwanzigsten April" stays as-is, but the date annotation uses 22.04.JJJJ).
10. **For Format D/E transcripts** (no speakers/timestamps): state clearly in the header that speaker attribution and timestamps are not available. Format as sequential numbered paragraphs.
11. **German language** for all structural elements.
12. **Line width ~78 characters** for dialogue text to ensure readability in any text viewer.

## Output

Save the formatted protocol to the `protokolle/` directory (or the path the user specifies):
```
Wortprotokoll_[Projektname]_[YYYY-MM-DD].txt
```

Tell the user the output path and remind them:
- The document requires review and signatures before it is legally binding
- Speaker identifications should be verified by participants
- Technical terms and proper nouns should be checked for transcription accuracy
