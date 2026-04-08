---
name: working-protocol
description: Use when the user asks to create a "working protocol", "Arbeitsprotokoll", "meeting summary", "Zusammenfassung", "action items", "Massnahmen", "meeting analysis", "Besprechungsanalyse", wants insights or next steps from a meeting, or mentions "Protokoll erstellen" without specifying legal. Reads an EBA transcript and generates an actionable working protocol with summary, decisions, action items, and insights.
argument-hint: <transcript-file-path>
allowed-tools: [Read, Write, Glob, Bash]
---

# Working Protocol (Arbeitsprotokoll)

You are creating an **actionable working protocol** from an EBA transcript file. This document distills the meeting into structured, useful information: summaries, decisions, action items, risks, and insights.

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

1. **Self-introductions**: "Mueller hier.", "Mein Name ist Schmidt."
2. **Direct address**: "Herr Mueller, was meinen Sie?" — the person addressed is the NEXT speaker to respond.
3. **Greetings by name**: "Guten Morgen Herr Mueller" — next response is Mueller.
4. **Third-person references**: "Wie Herr Mueller schon sagte..." — confirms who spoke earlier.
5. **Roll call**: "Mueller, Schmidt, Weber — sind alle da?"
6. **Role signals**: "Als Architekt...", "Aus Sicht der Statik..."
7. **Company references**: "Wir bei Solartec..."

Build a speaker map and **present it to the user for confirmation before proceeding**:

```
Sprecheridentifikation:

  Sprecher 00  →  Herr Mueller (Tragwerksplanung)
                   Evidenz: direkte Anrede bei [00:01:18]
  Sprecher 01  →  Frau Schmidt (Brandschutz)
                   Evidenz: "Frau Schmidt, bitte" bei [00:00:35]
  Ich          →  [Nicht identifiziert] (Protokollant)
  Sprecher 02  →  [Nicht identifiziert]

Stimmt das? Moechten Sie Namen korrigieren oder ergaenzen?
```

**Rules:**
- NEVER guess names you're not confident about.
- NEVER assign the same name to two speakers.
- Unresolved speakers: label by role if known ("Statiker", "Brandschutzbeauftragte"), otherwise keep original label.
- For Format D/E: note that speaker attribution was not possible and analyze content thematically instead.

### Step 3: Analyze the Transcript

Thoroughly analyze the full conversation to extract:
- Main topics discussed and their context
- Decisions and agreements reached
- Action items / tasks — explicit ("Ich mache das") AND implicit ("Das muesste jemand pruefen")
- Open questions and unresolved issues
- Risks, concerns, and blockers
- Constructive ideas and proposals (not yet actionable)
- Deadlines — convert ALL relative dates to absolute (from meeting date)
- Dependencies between tasks or topics
- Agreements and disagreements between participants

### Step 4: Generate the Working Protocol

Use German language throughout. Generate the following structure:

```markdown
# Arbeitsprotokoll — [Projektname]

| | |
|---|---|
| **Datum** | [TT.MM.JJJJ] |
| **Uhrzeit** | [HH:MM] – [HH:MM] Uhr |
| **Dauer** | [X] Minuten |
| **Ort / Medium** | [Videokonferenz / Vor Ort] |
| **Protokoll** | KI-gestuetzt (geprueft von: _______________) |

---

## Teilnehmer

| Name | Rolle / Fachgebiet | Anmerkung |
|------|-------------------|-----------|
| Herr Mueller | Tragwerksplanung | Identifiziert anhand Anrede |
| Frau Schmidt | Brandschutz | Identifiziert anhand Anrede |
| Sprecher 02 | Unbekannt | Nicht identifiziert |
| Ich (Protokollant) | Sitzungsleitung | Aufnahme-Operator |

---

## Zusammenfassung

[2-4 praegnante Saetze. Was war Zweck des Meetings? Was waren die
wichtigsten Ergebnisse? Was sind die kritischsten naechsten Schritte?
Sachlich, keine Floskeln.]

---

## Besprochene Themen

### 1. [Thema] _(ab [HH:MM:SS])_

**Kontext:** [Warum wurde das besprochen? Vorgeschichte, Ausganslage.]

**Diskussion:**
- **[Name]:** [Was hat diese Person beigetragen / vorgeschlagen / gefordert]
- **[Name]:** [Reaktion, Gegenposition, Ergaenzung]
- ...

**Ergebnis:** [Was wurde entschieden, vereinbart, oder offen gelassen?]

### 2. [Thema] _(ab [HH:MM:SS])_
...

---

## Beschluesse und Entscheidungen

| Nr. | Beschluss | Betrifft | Begruendung | Ref. |
|-----|-----------|----------|-------------|------|
| B1 | [Was wurde entschieden] | [Wer/Was betroffen] | [Warum] | Thema 1 |
| B2 | ... | ... | ... | ... |

_Kein Beschluss gefasst: ggf. "Keine formellen Beschluesse in diesem Meeting."_

---

## Massnahmen / To-Do-Liste

| Nr. | Aufgabe | Verantwortlich | Frist | Prio | Abhaengigkeit | Status |
|-----|---------|----------------|-------|------|---------------|--------|
| M1 | [Konkrete Aufgabe] | [Name] | [TT.MM.JJJJ] | Hoch | — | Offen |
| M2 | [Konkrete Aufgabe] | [Name] | [TT.MM.JJJJ] | Mittel | M1 | Offen |
| M3 | [Konkrete Aufgabe] | [Name] | Noch offen | Niedrig | — | Offen |

> Fristen, die im Gespraech relativ genannt wurden ("naechste Woche",
> "bis Freitag"), sind als absolute Daten angegeben, berechnet vom
> Besprechungsdatum [TT.MM.JJJJ].

---

## Offene Punkte

| Nr. | Punkt | Wer muss klaeren? | Dringlichkeit |
|-----|-------|--------------------|---------------|
| O1 | [Frage / ungeloester Punkt] | [Name / Rolle] | Hoch / Mittel / Niedrig |
| O2 | ... | ... | ... |

---

## Risiken und Bedenken

| Nr. | Risiko | Erwaehnt von | Auswirkung | Empfohlene Massnahme |
|-----|--------|-------------|------------|---------------------|
| R1 | [Risiko] | [Name] | [Was koennte passieren] | [Was tun] |
| R2 | ... | ... | ... | ... |

---

## Ideen und Vorschlaege

Konstruktive Ideen, die im Meeting aufkamen aber nicht sofort umgesetzt werden:

- **[Idee]** _([Name])_ — [Beschreibung und potentieller Nutzen]
- ...

_Falls keine: "Keine neuen Ideen oder Vorschlaege in diesem Meeting."_

---

## Erkenntnisse

Uebergreifende Beobachtungen, die nicht in einzelnen Themen aufgehen:

- [Muster, Verbindung zwischen Themen, strategische Implikation]
- [Kapazitaetsengpass, wiederkehrendes Problem, Richtungsaenderung]

---

## Naechste Schritte

Priorisierte Reihenfolge der wichtigsten Aktionen nach diesem Meeting:

1. **[Schritt]** — [Name], bis [TT.MM.JJJJ]
2. **[Schritt]** — [Name], bis [TT.MM.JJJJ]
3. **[Schritt]** — [Name], bis [TT.MM.JJJJ]

**Naechster Termin:** [TT.MM.JJJJ, HH:MM Uhr] _(oder "Noch festzulegen")_

---

_Erstellt am [TT.MM.JJJJ] mittels KI-gestuetzter Analyse (Claude AI)._
_Quelldatei: [Transkript-Dateipfad]_
_Bitte auf Richtigkeit pruefen und bei Bedarf ergaenzen._
```

## Analysis Guidelines

1. **Be concrete.** "Herr Mueller prueft Statik-Neuberechnung Nordseite bis 22.04." — not "Die Statik soll geprueft werden."
2. **Attribute everything.** Every decision, action item, concern, and idea must say who raised/owns it.
3. **Convert relative dates.** "Naechsten Freitag" → specific date from meeting date. "In zwei Wochen" → specific date.
4. **Extract implicit tasks.** "Ich kuemmere mich darum" = action item. "Das muesste man mal anschauen" = open point.
5. **Detect dependencies.** If task B can't start until task A is done, note it in the Abhaengigkeit column.
6. **Prioritize by urgency.** Hoch = blocking or deadline-critical. Mittel = important but not blocking. Niedrig = nice-to-have.
7. **Flag risks proactively.** Concerns, deadline pressure, capacity issues, external dependencies = risks.
8. **Separate ideas from actions.** Good ideas that aren't actionable yet go in Ideas, not To-Dos.
9. **Insights must add value.** Don't restate topics — identify patterns, cascading effects, strategic shifts, bottlenecks.
10. **Use Fachbegriffe accurately.** Statik, Rohbau, Brandschutzauflagen, Fluchtweg, etc. — preserve domain language.
11. **German language** for all content. Sachlich, praezise, Stichpunkte.
12. **Empty sections:** If a section has no content (e.g., no risks), include the section with a note like "Keine Risiken identifiziert." Do not omit sections.

## Output

Save the formatted protocol to the `protokolle/` directory (or user-specified path):
```
Arbeitsprotokoll_[Projektname]_[YYYY-MM-DD].md
```

After generating, tell the user the output path and offer:
- Create the legal protocol version as well (`/legal-protocol`)
- Compare with a previous protocol if one exists in `protokolle/`
- Export as a different format if needed
