# Speaker Identification Guide

When transcripts contain generic labels (Sprecher 00, Sprecher 01, SPEAKER_00, etc.) instead of real names, you MUST attempt to resolve them before generating the protocol.

## Transcript Variants You Will Encounter

The EBA app can produce several transcript formats depending on configuration:

### Format A — Timestamped with speaker diarization (best case)
```
[00:00:05] Herr Mueller: Guten Morgen zusammen.
[00:00:12] Frau Schmidt: Ja, guten Morgen.
```

### Format B — Timestamped with generic speakers (most common)
```
[00:00:05] Sprecher 00: Guten Morgen zusammen.
[00:00:12] Sprecher 01: Ja, guten Morgen.
```
or
```
[00:00:05] SPEAKER_00: Guten Morgen zusammen.
[00:00:12] SPEAKER_01: Ja, guten Morgen.
```

### Format C — Timestamped with "Ich" (recording operator identified)
```
[00:00:05] Ich: Guten Morgen zusammen, fangen wir an.
[00:00:12] Sprecher 01: Ja, guten Morgen.
```

### Format D — Plain text without speakers (no diarization)
```
Guten Morgen zusammen, fangen wir an.
Ja, guten Morgen. Ich habe die Unterlagen vorbereitet.
Koennen wir kurz ueber die Brandschutzauflagen sprechen?
```

### Format E — Whisper segments (raw output, no formatting)
```
 Guten Morgen zusammen, fangen wir an.
 Ja, guten Morgen. Ich habe die Unterlagen vorbereitet.
 Können wir kurz über die Brandschutzauflagen sprechen?
```

## Speaker Resolution Process

### Step 1: Scan for Direct Names

Search the entire transcript for these patterns (German meeting conventions):

| Pattern | Example | What it reveals |
|---------|---------|-----------------|
| Self-introduction | "Mueller hier.", "Mein Name ist Schmidt.", "Hier spricht Dr. Weber." | Speaker's own name |
| Greeting with name | "Guten Morgen, Mueller.", "Hallo Frau Schmidt." | The greeted person is the NEXT speaker to respond |
| Direct address | "Herr Mueller, was meinen Sie?", "Frau Schmidt, bitte." | The addressed person is the NEXT speaker to respond |
| Thanks by name | "Danke, Herr Braun." | Herr Braun just spoke (or is being acknowledged) |
| Third-person reference | "Wie Herr Mueller schon sagte...", "Frau Schmidt hat recht." | Confirms a previous speaker's identity |
| Roll call / attendance | "Sind alle da? Mueller, Schmidt, Weber — gut." | Lists all participants |
| Farewell | "Tschuess Herr Mueller.", "Auf Wiedersehen, Frau Schmidt." | Confirms participant identity |

### Step 2: Scan for Role Clues

| Pattern | Example | What it reveals |
|---------|---------|-----------------|
| Professional role | "Als Architekt...", "Von der Statik her...", "Aus brandschutztechnischer Sicht..." | Speaker's discipline |
| Company reference | "Wir bei Solartec...", "Unser Buero hat..." | Speaker's affiliation |
| Responsibility claim | "Das faellt in meinen Bereich.", "Ich kuemmere mich um die Elektrik." | Speaker's domain |
| Expertise signal | "In meiner Erfahrung als Bauleiter..." | Speaker's role/seniority |

### Step 3: Cross-Reference Dialogue Flow

- When person A says "Herr Mueller, koennen Sie die Statik pruefen?" and the next speaker (Sprecher 02) responds about structural analysis → Sprecher 02 = Herr Mueller
- When person A says "Frau Schmidt, bitte" and Sprecher 01 starts speaking → Sprecher 01 = Frau Schmidt
- When someone says "Wie [Sprecher X] gerade erwaehnt hat..." → confirms the referenced content belongs to that speaker

### Step 4: Contextual Deduction

- The person who opens/closes the meeting and sets the agenda is typically the Sitzungsleiter (meeting chair)
- "Ich" (if present) is always the recording operator — their real name may be revealed when others address them
- The person who says "Ich habe das Protokoll..." or "Ich schicke das Protokoll rum" is typically the Protokollant
- Construction meetings: the person discussing Statik is the Tragwerksplaner, the person discussing Brandschutz is the Brandschutzbeauftragte, etc.

### Step 5: Build the Speaker Map

Create a mapping table:

```
SPEAKER IDENTIFICATION
======================
Original Label → Resolved Name    | Confidence | Evidence
Sprecher 00    → Herr Mueller     | Hoch       | Addressed by name at [00:01:18], self-identified at [00:00:12]
Sprecher 01    → Frau Schmidt     | Hoch       | "Frau Schmidt, bitte" at [00:00:35], discusses Brandschutz throughout
Ich            → [Unbekannt]      | —          | Recording operator, not addressed by name
Sprecher 02    → [Unbekannt]      | —          | No identifying information found
```

Confidence levels:
- **Hoch**: Directly named (self-intro, addressed by name, greeted by name)
- **Mittel**: Inferred from role + context (only person discussing Statik, addressed by role)
- **Niedrig**: Speculative (based on speech patterns, expertise level)

### Step 6: Present to User for Confirmation

BEFORE generating the final protocol, present the speaker map and ask the user:

```
Ich habe folgende Sprecher identifiziert:

  Sprecher 00 → Herr Mueller (Statik) — Evidenz: direkte Anrede bei [00:01:18]
  Sprecher 01 → Frau Schmidt (Brandschutz) — Evidenz: "Frau Schmidt, bitte" bei [00:00:35]
  Sprecher 02 → [Nicht identifiziert]
  Ich         → [Nicht identifiziert] (Protokollant/Aufnahme)

Stimmt das? Moechten Sie Namen korrigieren oder ergaenzen?
```

Only proceed after user confirms or corrects.

## Rules

1. **NEVER guess a name you're not confident about.** Use "[Sprecher XX]" or "[Teilnehmer X]" for unresolved speakers.
2. **NEVER assign the same name to two speakers.**
3. **Track evidence** — every name assignment must have a transcript reference.
4. **Ask the user** when uncertain — it's better to ask than to misattribute.
5. For the **legal protocol**: unresolved speakers stay as their original labels with a note in the participant table.
6. For the **working protocol**: unresolved speakers can be labeled by role if known (e.g., "Statiker", "Brandschutzbeauftragte").
