# EBA Protokoll -- Cowork Plugin Einrichtung

## Uebersicht

Dieses Dokument beschreibt die Einrichtung des Claude Cowork Plugins fuer die
automatische Protokollerstellung aus diarisierten Transkripten. Das Plugin
erkennt Sprecherbezeichnungen aus dem Transkript und erstellt keine freie
Markdown-Vorlage mehr. Stattdessen erzeugt es eine strukturierte JSON-Spezifikation,
die anschliessend mit `skills/eba-template-protocol` in die originalen
EBA-QMG-DOCX- oder XLSX-Vorlagen geschrieben wird.


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
Deine Aufgabe ist die strukturierte Inhaltsextraktion fuer die offiziellen
EBA-QMG-Protokollvorlagen. Du darfst das finale Layout nicht als Markdown
nachbauen.

EINGABEFORMAT:
Das Transkript hat folgendes Format:
[HH:MM:SS] Sprechername: Gesprochener Text...

Dabei gilt:
- "Ich" ist der Protokollersteller.
- "Sprecher 1", "Sprecher 2" usw. sind weitere Teilnehmer (sofern nicht umbenannt).
- Falls echte Namen eingetragen wurden, werden diese statt "Sprecher X" verwendet.

DEINE AUFGABEN:

1. Identifiziere alle Sprecher im Transkript und liste sie auf.
2. Erstelle eine JSON-Spezifikation nach dem unten stehenden Schema.
3. Ordne Aussagen, Beschluesse und Aufgaben den jeweiligen Sprechern zu.
4. Fasse Redebeitraege inhaltlich zusammen -- keine woertlichen Zitate, sondern
   praegnante Zusammenfassungen.
5. Erkenne Aufgaben, Zusagen und Termine und trage sie in die To-Do-Tabelle ein
   mit dem jeweils verantwortlichen Sprecher.
6. Bei unklarer Verantwortlichkeit den Protokollersteller ("Ich") als
   Verantwortlichen eintragen und mit "(klaeren)" markieren.
7. Gib ausschliesslich valides JSON aus. Keine Markdown-Ueberschriften, keine
   Markdown-Tabellen, keine erklaerenden Saetze ausserhalb des JSON.

TEMPLATE-AUSWAHL:

- `pk_lp1_4`: normales Arbeitsprotokoll / Standard.
- `gespraechsnotiz`: kurze Gespraechsnotiz.
- `pk_lp5`: Planungsbesprechung oder formelles LP5-Protokoll mit D/K, B, LN,
  Termin und Status.
- `pk_excel`: formelles Excel-Protokoll mit Deckblatt, Protokoll und Doku_Info.
- `pk_lp1_4_excel`: einfaches LP1-4-Excel-Protokoll.

JSON-SCHEMA:

{
  "template": "pk_lp1_4",
  "metadata": {
    "description": "[kurze Beschreibung / Besprechungstitel]",
    "project_name": "[Projektname oder nicht angegeben]",
    "project_number": "[Projektnummer oder nicht angegeben]",
    "project_description": "[Projektbeschreibung oder nicht angegeben]",
    "place": "[Ort / Medium]",
    "meeting_date": "[TT.MM.JJJJ]",
    "created_date": "[TT.MM.JJJJ]",
    "author": "[Kuerzel / Name des Protokollerstellers]",
    "meeting_number": "[bei LP5: Besprechungsnummer]",
    "meeting_title": "[bei LP5: Besprechungsthema]",
    "time": "[bei LP5: Uhrzeit]"
  },
  "participants": [
    {
      "first_name": "[Vorname oder Sprecherlabel]",
      "last_name": "[Nachname oder leer]",
      "initials": "[Kuerzel oder ---]",
      "company": "[Firma oder leer]",
      "company_code": "[bei LP5: Firmenkuerzel oder ---]",
      "attendance": "X",
      "distribution": "X"
    }
  ],
  "distribution": [
    {
      "first_name": "wie Teilnehmer",
      "last_name": "",
      "initials": "",
      "company": ""
    }
  ],
  "topics": [
    {
      "number": "1",
      "category": "01",
      "category_title": "Organisation",
      "meeting_no": "01",
      "running_no": "01",
      "title": "[Thema]",
      "body": "[sachliche Zusammenfassung]",
      "responsible": "[konkreter Sprecher / Rolle / nicht angegeben]",
      "deadline": "[TT.MM.JJJJ / Noch festzulegen / -]",
      "status": "O"
    }
  ],
  "documents": [],
  "appointments": [],
  "approval": {
    "creator": "[Ersteller]",
    "created_date": "[TT.MM.JJJJ]",
    "reviewer": "---",
    "reviewed_date": "---"
  },
  "attachments": []
}

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
- Die Felder `responsible`, `deadline` und `status` sind wichtig, weil sie in
  die EBA-Vorlage uebernommen werden.
- Wenn als Zielformat Excel oder eine Excel-Vorlage genannt wird, waehle
  `pk_excel` oder `pk_lp1_4_excel` und nicht eine DOCX-Vorlage.
- Wenn etwas unbekannt ist, verwende `nicht angegeben`, `---` oder
  `Noch festzulegen`; lasse keine QMG-Vorlagen-Platzhalter stehen.
```

---


## Einrichtung in Cowork

1. In Claude Cowork ein neues Plugin erstellen.
2. Den obigen Prompt-Text als Plugin-Prompt einfuegen.
3. Als Eingabe wird das Transkript aus dem Ordner `transkripte/` verwendet.
4. Das erzeugte JSON als Spezifikation speichern.
5. Mit `skills/eba-template-protocol/scripts/create_protocol_docx.py` oder
   `create_protocol_xlsx.py` die passende offizielle Vorlage kopieren und
   fuellen.
6. Mit `validate_protocol_docx.py` oder `validate_protocol_xlsx.py` pruefen.
7. Bei Bedarf mit `export_protocol_pdf.py` als PDF ausgeben.


## Verwendung

1. Meeting mit der EBA Protokoll App aufnehmen und transkribieren.
2. Optional: Sprecher in der App mit echten Namen versehen.
3. Das Transkript an das Cowork-Plugin uebergeben.
4. Das Plugin erstellt eine JSON-Spezifikation mit Teilnehmern, Themen,
   Verantwortlichkeiten, Fristen und Status.
5. Der Template-Generator erstellt daraus DOCX/XLSX/PDF im originalen
   EBA-QMG-Layout.
6. Protokoll pruefen, ggf. anpassen, und im Ordner `protokolle/` ablegen.


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

### Ausgabe (JSON-Ausschnitt)

```
{
  "template": "pk_lp1_4",
  "metadata": {
    "description": "Baufortschritt und offene Planungsaufgaben",
    "project_name": "nicht angegeben",
    "project_number": "nicht angegeben",
    "project_description": "nicht angegeben",
    "place": "nicht angegeben",
    "meeting_date": "02.04.2026",
    "created_date": "02.04.2026",
    "author": "Protokollersteller"
  },
  "participants": [
    {"first_name": "Protokollersteller", "last_name": "", "initials": "", "company": ""},
    {"first_name": "Herr", "last_name": "Mueller", "initials": "", "company": ""},
    {"first_name": "Frau", "last_name": "Schmidt", "initials": "", "company": ""}
  ],
  "distribution": [{"first_name": "wie Teilnehmer", "last_name": "", "initials": "", "company": ""}],
  "topics": [
    {
      "number": "1",
      "title": "Baufortschritt",
      "body": "Der Rohbau ist zu 80 Prozent fertiggestellt. Herr Mueller bestaetigt, dass das Projekt im Zeitplan liegt. Der aktualisierte Bauzeitplan soll bis 03.04.2026 geschickt werden.",
      "responsible": "Herr Mueller",
      "deadline": "03.04.2026",
      "status": "O"
    }
  ]
}
```


## Hinweise

- Je genauer die Sprecher in der App benannt werden, desto besser wird das Protokoll.
  "Herr Mueller" ist deutlich hilfreicher als "Sprecher 1".
- Bei grossen Meetings (viele Sprecher) kann es vorkommen, dass die Sprechererkennung
  nicht alle Personen korrekt trennt. In diesem Fall die Sprecherzuordnung im
  Transkript vor der Protokollerstellung manuell pruefen.
- Das Plugin erkennt auch implizite Aufgaben. Wenn jemand sagt "Ich schicke Ihnen
  das morgen", wird das als To-Do mit dem entsprechenden Verantwortlichen erfasst.
