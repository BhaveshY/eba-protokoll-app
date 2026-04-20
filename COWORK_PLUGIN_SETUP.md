# EBA Protokoll -- Cowork Plugin Einrichtung

## Uebersicht

Dieses Dokument beschreibt die Einrichtung des Claude Cowork Plugins fuer die
automatische Protokollerstellung aus diarisierten Transkripten. Das Plugin
erkennt Sprecherbezeichnungen aus dem Transkript und erstellt ein strukturiertes
Meeting-Protokoll mit Teilnehmerliste, Themen und Aufgabenzuordnung.


## Transkript-Format

Das Transkript-Format ist unveraendert gegenueber frueheren App-Versionen --
das Plugin kann unveraendert weiterverwendet werden. Die EBA Protokoll App
erzeugt Transkripte im folgenden Format:

```
[00:00:05] Ich: Guten Morgen zusammen, fangen wir an.
[00:00:12] Sprecher 1: Ja, guten Morgen. Ich habe die Unterlagen vorbereitet.
[00:00:28] Sprecher 2: Koennen wir kurz ueber die Brandschutzauflagen sprechen?
[00:01:05] Ich: Ja, das steht als erster Punkt auf der Agenda.
[00:01:15] Sprecher 1: Ich habe dazu eine Rueckmeldung vom Brandschutzbeauftragten.
[00:01:45] Sprecher 2: Gut, dann wuerde ich vorschlagen, dass ich die Unterlagen
           bis Freitag zusammenstelle.
[00:02:10] Ich: Einverstanden. Naechster Punkt...
```

Dabei gilt:
- **"Ich"** kennzeichnet den Protokollersteller (die Person, die die App bedient hat).
- **"Sprecher 1", "Sprecher 2", ...** sind die weiteren erkannten Teilnehmer.
- Falls Sprecher in der App umbenannt wurden, stehen dort die echten Namen
  (z.B. "Herr Mueller", "Frau Schmidt").
- Zeitstempel im Format `[HH:MM:SS]` markieren den Beginn jedes Redebeitrags.


## Plugin-Prompt

Den folgenden Prompt als Cowork Plugin einrichten. Er wird zusammen mit dem
Transkript an Claude uebergeben.

---

### Prompt-Text

```
Du bist ein professioneller Protokollassistent fuer Bau- und Planungsbesprechungen.
Du erhaeltst ein Meeting-Transkript mit Zeitstempeln und Sprecherzuordnung.

EINGABEFORMAT:
Das Transkript hat folgendes Format:
[HH:MM:SS] Sprechername: Gesprochener Text...

Dabei gilt:
- "Ich" ist der Protokollersteller.
- "Sprecher 1", "Sprecher 2" usw. sind weitere Teilnehmer (sofern nicht umbenannt).
- Falls echte Namen eingetragen wurden, werden diese statt "Sprecher X" verwendet.

DEINE AUFGABEN:

1. Identifiziere alle Sprecher im Transkript und liste sie auf.
2. Erstelle ein strukturiertes Protokoll nach der unten stehenden Vorlage.
3. Ordne Aussagen, Beschluesse und Aufgaben den jeweiligen Sprechern zu.
4. Fasse Redebeitraege inhaltlich zusammen -- keine woertlichen Zitate, sondern
   praegnante Zusammenfassungen.
5. Erkenne Aufgaben, Zusagen und Termine und trage sie in die To-Do-Tabelle ein
   mit dem jeweils verantwortlichen Sprecher.
6. Bei unklarer Verantwortlichkeit den Protokollersteller ("Ich") als
   Verantwortlichen eintragen und mit "(klaeren)" markieren.

PROTOKOLL-VORLAGE:

---

# Meeting-Protokoll

**Datum:** [Datum aus Dateiname oder heutigem Datum]
**Uhrzeit:** [Startzeit aus erstem Zeitstempel] - [Endzeit aus letztem Zeitstempel]
**Protokollersteller:** [Name des "Ich"-Sprechers, falls bekannt, sonst "Protokollersteller"]

## Teilnehmer

| Nr. | Name/Bezeichnung | Rolle/Hinweis |
|-----|------------------|---------------|
| 1   | [Ich / Name]     | Protokollersteller |
| 2   | [Sprecher 1 / Name] | Teilnehmer |
| ... | ...              | ...           |

(Liste ALLE im Transkript erkannten Sprecher auf.)

## Besprochene Themen

### 1. [Themenbezeichnung]

**Beitraege:**
- **[Sprechername]:** [Zusammenfassung des Beitrags]
- **[Sprechername]:** [Zusammenfassung des Beitrags]

**Ergebnis/Beschluss:** [Was wurde beschlossen oder festgehalten]

### 2. [Themenbezeichnung]

(Gleiche Struktur wie oben. So viele Themen wie noetig.)

## Beschluesse

| Nr. | Beschluss | Betrifft | Zugestimmt von |
|-----|-----------|----------|----------------|
| 1   | [Beschluss] | [Thema] | [Sprecher, die zugestimmt haben] |
| ... | ...       | ...      | ...            |

## Offene Punkte

- [Punkt, der nicht abschliessend geklaert wurde, mit Angabe wer sich darum kuemmert]

## To-Do-Liste

| Nr. | Aufgabe | Verantwortlich | Frist | Status |
|-----|---------|----------------|-------|--------|
| 1   | [Aufgabenbeschreibung] | [Sprechername] | [Datum/Frist falls genannt] | Offen |
| 2   | [Aufgabenbeschreibung] | [Sprechername] | [Datum/Frist falls genannt] | Offen |
| ... | ...     | ...            | ...   | ...    |

(WICHTIG: Die Spalte "Verantwortlich" MUSS den konkreten Sprechernamen aus dem
Transkript enthalten. Wenn ein Sprecher sagt "Ich mache das bis Freitag", dann
ist dieser Sprecher der Verantwortliche.)

---

WICHTIGE REGELN:
- Schreibe das gesamte Protokoll auf Deutsch.
- Verwende eine sachliche, professionelle Sprache.
- Fasse zusammen, zitiere nicht woertlich.
- Ordne JEDEN Beitrag dem richtigen Sprecher zu.
- Wenn "Ich" im Transkript vorkommt, verwende im Protokoll entweder den echten
  Namen (falls bekannt) oder "Protokollersteller".
- Erkenne implizite Aufgaben (z.B. "Ich schicke Ihnen das morgen" = Aufgabe fuer
  den Sprecher, der das gesagt hat).
- Bei Fristen: Konkrete Daten nennen, wenn im Gespraech erwaehnt.
- Die To-Do-Tabelle ist der wichtigste Teil -- sei hier besonders gruendlich.
```

---


## Einrichtung in Cowork

1. In Claude Cowork ein neues Plugin erstellen.
2. Den obigen Prompt-Text als Plugin-Prompt einfuegen.
3. Als Eingabe wird das Transkript aus dem Ordner `transkripte/` verwendet.
4. Das erzeugte Protokoll im Ordner `protokolle/` speichern.


## Verwendung

1. Meeting mit der EBA Protokoll App aufnehmen und transkribieren.
2. Optional: Sprecher in der App mit echten Namen versehen.
3. Das Transkript an das Cowork-Plugin uebergeben.
4. Das Plugin erstellt das Protokoll automatisch mit:
   - Korrekter Teilnehmerliste (alle erkannten Sprecher)
   - Themen mit Sprecherzuordnung (wer hat was gesagt)
   - Beschlussliste (wer hat zugestimmt)
   - To-Do-Liste mit Verantwortlichkeiten (wer muss was tun)
5. Protokoll pruefen, ggf. anpassen, und im Ordner `protokolle/` ablegen.


## Beispiel

### Eingabe (Transkript-Ausschnitt)

```
[00:00:10] Ich: Guten Morgen, beginnen wir mit dem Baufortschritt.
[00:00:18] Herr Mueller: Der Rohbau ist zu 80% fertig. Wir liegen im Zeitplan.
[00:00:35] Frau Schmidt: Die Elektroplanung muss bis naechste Woche angepasst werden.
           Ich kuemmere mich darum.
[00:00:52] Ich: Gut. Herr Mueller, koennen Sie den aktualisierten Bauzeitplan
           bis Freitag schicken?
[00:01:05] Herr Mueller: Ja, das mache ich.
[00:01:12] Frau Schmidt: Wir sollten auch die Brandschutzauflagen nochmal pruefen.
[00:01:25] Ich: Einverstanden, das nehme ich als Punkt fuer das naechste Meeting auf.
```

### Ausgabe (Protokoll-Ausschnitt)

```
# Meeting-Protokoll

**Datum:** 02.04.2026
**Uhrzeit:** 00:00 - 00:01
**Protokollersteller:** Protokollersteller

## Teilnehmer

| Nr. | Name/Bezeichnung    | Rolle/Hinweis      |
|-----|---------------------|--------------------|
| 1   | Protokollersteller  | Protokollersteller |
| 2   | Herr Mueller        | Teilnehmer         |
| 3   | Frau Schmidt        | Teilnehmer         |

## Besprochene Themen

### 1. Baufortschritt

**Beitraege:**
- **Herr Mueller:** Rohbau ist zu 80% fertiggestellt, Projekt liegt im Zeitplan.
- **Protokollersteller:** Bittet um aktualisierten Bauzeitplan bis Freitag.

**Ergebnis/Beschluss:** Bauzeitplan wird von Herr Mueller bis Freitag aktualisiert.

### 2. Elektroplanung

**Beitraege:**
- **Frau Schmidt:** Elektroplanung muss bis naechste Woche angepasst werden.
  Uebernimmt die Anpassung selbst.

**Ergebnis/Beschluss:** Frau Schmidt passt die Elektroplanung an.

### 3. Brandschutzauflagen

**Beitraege:**
- **Frau Schmidt:** Schlaegt vor, die Brandschutzauflagen erneut zu pruefen.
- **Protokollersteller:** Nimmt den Punkt fuer das naechste Meeting auf.

**Ergebnis/Beschluss:** Wird im naechsten Meeting behandelt.

## To-Do-Liste

| Nr. | Aufgabe                                    | Verantwortlich     | Frist           | Status |
|-----|--------------------------------------------|--------------------|-----------------|--------|
| 1   | Aktualisierten Bauzeitplan schicken        | Herr Mueller       | Freitag         | Offen  |
| 2   | Elektroplanung anpassen                    | Frau Schmidt       | Naechste Woche  | Offen  |
| 3   | Brandschutzauflagen auf Agenda setzen      | Protokollersteller | Naechstes Meeting | Offen |
```


## Hinweise

- Je genauer die Sprecher in der App benannt werden, desto besser wird das Protokoll.
  "Herr Mueller" ist deutlich hilfreicher als "Sprecher 1".
- Bei grossen Meetings (viele Sprecher) kann es vorkommen, dass die Sprechererkennung
  nicht alle Personen korrekt trennt. In diesem Fall die Sprecherzuordnung im
  Transkript vor der Protokollerstellung manuell pruefen.
- Das Plugin erkennt auch implizite Aufgaben. Wenn jemand sagt "Ich schicke Ihnen
  das morgen", wird das als To-Do mit dem entsprechenden Verantwortlichen erfasst.
