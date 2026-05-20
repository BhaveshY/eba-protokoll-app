---
name: eba-template-protocol
description: Create EBA-branded protocol documents and workbooks from EBA meeting transcripts using the original QMG-024-141 protocol templates. Use this whenever the user asks for an EBA Protokoll, Gespraechsnotiz, Planungsbesprechung, LP1-4/LP5 protocol, Excel protocol workbook, Cowork protocol output, or asks whether protocol output follows EBA templates, brand guidelines, DOCX/XLSX/PDF formatting, tables, headers, footers, QM index, or official template structure. This skill must be used instead of creating Markdown protocol documents when an EBA template-compliant output is expected.
---

# EBA Template Protocol

Create protocol documents by copying the official EBA QMG templates and filling the copy. The template is the formatting authority; the AI only extracts and structures content.

## Non-Negotiable Template Rule

Always start from an original file in `assets/`. Do not recreate the layout in Markdown, HTML, LaTeX, a newly styled DOCX, or a newly styled XLSX. Do not imitate the brand manually. Copy the selected template and fill the copied file.

Use the bundled PDFs only as visual references. Generated DOCX and XLSX outputs must preserve the original template package structure, styles, theme colors, headers, footers, worksheet dimensions, table ranges, and print-area logic unless rows are added because content exceeds the template capacity.

## Supported DOCX Templates

- `gespraechsnotiz`: `QMG-024-141_ORG-GESPRAECHSNOTIZ_230202-D.docx`
- `pk_lp1_4`: `QMG-024-141_ORG-PK-LP1-4-MA_230227-A.docx`
- `pk_lp5`: `QMG-024-141_ORG-PK-LP5-MA_230202-B.docx`

Default to `pk_lp1_4` for a normal working protocol. Use `gespraechsnotiz` for short conversation notes. Use `pk_lp5` for formal LP5/Planungsbesprechung records with D/K, B, LN, Termin, and Status columns.

## Supported XLSX Templates

- `pk_excel`: `QMG-024-141_ORG-PK-EXCEL-MA_240926-C.xlsx`
- `pk_lp1_4_excel`: `QMG-024-141_ORG-PK-LP1-4-EXCEL-MA_240920-A.xlsx`

Use `pk_excel` when the intended output is the formal Excel protocol workbook with `Deckblatt`, `Protokoll`, and `Doku_Info` sheets. Use `pk_lp1_4_excel` for the simpler LP1-4 workbook. If the user asks for the appropriate format and references an Excel template or sample, generate XLSX rather than DOCX.

## Workflow

1. Read the transcript and identify speakers, project metadata, participants, topics, decisions, responsibilities, deadlines, appointments, referenced documents, and attachments.
2. Build a spec JSON using `references/protocol-spec-example.json` as the shape. If a fact is unknown, use formal placeholders such as `nicht angegeben`, `---`, `Noch festzulegen`, or `wird nachgetragen`; do not leave template placeholders such as `_Projektname einsetzen_`, `XXX`, or `TT.MM.JJ`.
3. Create the requested output from the copied official template.

   For DOCX:
   ```bash
   python <skill-root>/scripts/create_protocol_docx.py <spec.json> <output.docx>
   ```

   For XLSX:
   ```bash
   python <skill-root>/scripts/create_protocol_xlsx.py <spec.json> <output.xlsx>
   ```

4. Validate the generated file.

   For DOCX:
   ```bash
   python <skill-root>/scripts/validate_protocol_docx.py <output.docx> --template <template-key>
   ```

   For XLSX:
   ```bash
   python <skill-root>/scripts/validate_protocol_xlsx.py <output.xlsx> --template <template-key>
   ```

   Treat validation failure as a failed document or workbook. Fix the spec or script and rerun.
5. Export PDF when a distribution copy is needed:
   ```bash
   python <skill-root>/scripts/export_protocol_pdf.py <output.docx|output.xlsx> <output.pdf>
   ```

## Content Contract

Keep generated content practical and formal:

- German business language.
- Correct German spelling, including umlauts in generated documents.
- No Markdown headings or Markdown tables in the final DOCX or XLSX.
- Every task must include a responsible person or `nicht angegeben`.
- Every deadline must be an absolute date when it can be inferred from the meeting date; otherwise use `Noch festzulegen`.
- For LP5 and formal Excel protocols, preserve the protocol table logic: `D/K`, `B`, `LN`, `Besprechungsthemen`, `zustaendig`, `Termin`, `Status`.
- For unresolved speaker names, keep the original speaker label or role and mark it clearly in the participant list.

## Output

Return the DOCX or XLSX path and, if exported, the PDF path. State that validation passed. List unresolved decisions outside the document in the final response.
