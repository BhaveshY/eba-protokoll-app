"""Create an EBA protocol DOCX by copying and filling official templates."""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import shutil
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}
ET.register_namespace("w", W_NS)

SKILL_ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = SKILL_ROOT / "assets"
MANIFEST_PATH = SKILL_ROOT / "references" / "template-manifest.json"


def q(name: str) -> str:
    return f"{{{W_NS}}}{name}"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest().upper()


def load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def register_template_namespaces(template: Path, part: str = "word/document.xml") -> dict[str, str]:
    namespaces: dict[str, str] = {}
    with zipfile.ZipFile(template) as z:
        data = z.read(part)
    for _, ns in ET.iterparse(io.BytesIO(data), events=("start-ns",)):
        prefix, uri = ns
        namespaces.setdefault(prefix or "", uri)
        ET.register_namespace(prefix or "", uri)
    return namespaces


def text_of(el: ET.Element) -> str:
    return "".join(t.text or "" for t in el.findall(".//w:t", NS)).strip()


def first_paragraph(el: ET.Element) -> ET.Element:
    p = el.find("./w:p", NS)
    if p is None:
        p = ET.SubElement(el, q("p"))
    return p


def set_paragraph_text(p: ET.Element, value: str) -> None:
    ppr = copy.deepcopy(p.find("./w:pPr", NS))
    first_run = p.find("./w:r", NS)
    rpr = copy.deepcopy(first_run.find("./w:rPr", NS)) if first_run is not None else None
    for child in list(p):
        p.remove(child)
    if ppr is not None:
        p.append(ppr)

    lines = str(value or "").splitlines() or [""]
    run = ET.SubElement(p, q("r"))
    if rpr is not None:
        run.append(rpr)
    for i, line in enumerate(lines):
        if i:
            ET.SubElement(run, q("br"))
        t = ET.SubElement(run, q("t"))
        if line.startswith(" ") or line.endswith(" "):
            t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        t.text = line


def set_cell_text(cell: ET.Element, value: str) -> None:
    paragraphs = cell.findall("./w:p", NS)
    if not paragraphs:
        paragraphs = [ET.SubElement(cell, q("p"))]
    for p in paragraphs[1:]:
        cell.remove(p)
    set_paragraph_text(paragraphs[0], value)


def set_cells(row: ET.Element, values: dict[int, str]) -> None:
    cells = row.findall("./w:tc", NS)
    for index, value in values.items():
        if index < len(cells):
            set_cell_text(cells[index], value)


def direct_rows(table: ET.Element) -> list[ET.Element]:
    return table.findall("./w:tr", NS)


def replace_rows(table: ET.Element, start: int, stop: int, new_rows: list[ET.Element]) -> None:
    rows = direct_rows(table)
    if start > len(rows) or stop > len(rows) or start > stop:
        raise ValueError("Invalid row replacement range")
    children = list(table)
    insert_at = children.index(rows[start]) if start < len(rows) else len(children)
    for row in rows[start:stop]:
        table.remove(row)
    for offset, row in enumerate(new_rows):
        table.insert(insert_at + offset, row)


def normalize_person(person: dict) -> dict:
    return {
        "first_name": person.get("first_name") or person.get("first") or "",
        "last_name": person.get("last_name") or person.get("last") or person.get("name") or "",
        "initials": person.get("initials") or person.get("kuerzel") or person.get("kürzel") or "",
        "company": person.get("company") or person.get("firma") or "",
        "company_code": person.get("company_code") or person.get("firmencode") or "",
        "attendance": person.get("attendance") or person.get("teilnahme") or "X",
        "distribution": person.get("distribution") or person.get("verteiler") or "X",
    }


def required(value: str, fallback: str = "nicht angegeben") -> str:
    value = str(value or "").strip()
    return value if value else fallback


def topic_title(topic: dict) -> str:
    number = str(topic.get("number") or "").strip()
    title = str(topic.get("title") or "").strip()
    if number and title and not title.startswith(number):
        return f"{number} {title}"
    return title or number or "Thema"


def simple_responsibility(topic: dict) -> str:
    responsible = str(topic.get("responsible") or topic.get("owner") or "").strip()
    deadline = str(topic.get("deadline") or topic.get("due") or "").strip()
    return "\n".join(part for part in [responsible, deadline] if part)


def fill_simple(root: ET.Element, spec: dict) -> None:
    body = root.find("w:body", NS)
    if body is None:
        raise ValueError("DOCX body missing")
    tables = body.findall(".//w:tbl", NS)
    if len(tables) < 4:
        raise ValueError("Unexpected simple protocol template structure")

    metadata = spec.get("metadata", {})
    header_rows = direct_rows(tables[0])
    set_cell_text(header_rows[1].findall("./w:tc", NS)[0], required(metadata.get("description")))
    set_cells(header_rows[2], {2: required(metadata.get("project_name"))})
    set_cells(header_rows[3], {2: required(metadata.get("project_number"))})
    set_cells(header_rows[4], {2: required(metadata.get("project_description"))})
    set_cells(
        header_rows[7],
        {
            0: required(metadata.get("place")),
            2: required(metadata.get("meeting_date")),
            4: required(metadata.get("created_date")),
            6: required(metadata.get("author")),
        },
    )

    fill_simple_people_table(tables[1], spec.get("participants", []), minimum=1)
    fill_simple_people_table(tables[2], spec.get("distribution", []), minimum=1)
    fill_simple_topics_table(tables[3], spec.get("topics", []))


def fill_simple_people_table(table: ET.Element, people: list[dict], minimum: int) -> None:
    rows = direct_rows(table)
    sample = rows[2] if len(rows) > 2 else rows[-1]
    normalized = [normalize_person(p) for p in people]
    if not normalized:
        normalized = [{"first_name": "nicht angegeben", "last_name": "", "initials": "", "company": ""}]
    while len(normalized) < minimum:
        normalized.append({"first_name": "", "last_name": "", "initials": "", "company": ""})

    new_rows = []
    for person in normalized:
        row = copy.deepcopy(sample)
        set_cells(
            row,
            {
                0: person["first_name"],
                2: person["last_name"],
                4: person["initials"],
                6: person["company"],
            },
        )
        new_rows.append(row)
    replace_rows(table, 2, len(rows), new_rows)


def fill_simple_topics_table(table: ET.Element, topics: list[dict]) -> None:
    rows = direct_rows(table)
    main_sample = rows[1]
    sub_sample = rows[2] if len(rows) > 2 else rows[1]
    if not topics:
        topics = [{"title": "Kein Gesprächsinhalt angegeben", "body": "nicht angegeben"}]
    new_rows = []
    for topic in topics:
        level = str(topic.get("number") or "").count(".") + 1
        row = copy.deepcopy(sub_sample if level > 1 else main_sample)
        set_cells(
            row,
            {
                0: topic_title(topic),
                2: required(topic.get("body") or topic.get("summary")),
                4: simple_responsibility(topic),
            },
        )
        new_rows.append(row)
    replace_rows(table, 1, len(rows), new_rows)


def fill_lp5(root: ET.Element, spec: dict) -> None:
    body = root.find("w:body", NS)
    if body is None:
        raise ValueError("DOCX body missing")
    tables = body.findall(".//w:tbl", NS)
    if len(tables) < 4:
        raise ValueError("Unexpected LP5 protocol template structure")

    metadata = spec.get("metadata", {})
    cover = tables[0]
    cover_rows = direct_rows(cover)
    meeting_number = required(metadata.get("meeting_number"), "XX")
    set_cells(cover_rows[2], {0: f"zur Besprechung Nr. {meeting_number}"})
    set_cells(cover_rows[5], {1: required(metadata.get("meeting_title") or metadata.get("description"))})
    set_cells(cover_rows[6], {1: required(metadata.get("project_number"))})
    set_cells(cover_rows[7], {1: required(metadata.get("project_name"))})
    set_cells(cover_rows[9], {1: required(metadata.get("place")), 4: required(metadata.get("meeting_date"))})
    set_cells(cover_rows[10], {4: required(metadata.get("time"), "nicht angegeben")})
    fill_lp5_participants(cover, spec.get("participants", []))
    fill_lp5_documents(cover, spec.get("documents", []))
    fill_lp5_topics(tables[1], spec.get("topics", []), meeting_number)
    fill_lp5_appointments(tables[2], spec.get("appointments", []))
    fill_lp5_doc_info(tables[3], spec)


def fill_lp5_participants(table: ET.Element, people: list[dict]) -> None:
    rows = direct_rows(table)
    sample = rows[14]
    normalized = [normalize_person(p) for p in people] or [normalize_person({"first_name": "nicht angegeben"})]
    new_rows = []
    for person in normalized:
        row = copy.deepcopy(sample)
        set_cells(
            row,
            {
                0: person["first_name"],
                1: person["last_name"],
                2: person["initials"] or "---",
                3: person["company"],
                4: person["company_code"] or "---",
                5: person["attendance"] or "X",
                6: person["distribution"] or "X",
            },
        )
        new_rows.append(row)
    replace_rows(table, 14, 24, new_rows)


def fill_lp5_documents(table: ET.Element, documents: list[dict]) -> None:
    rows = direct_rows(table)
    start_index = next((i for i, row in enumerate(rows) if "_ Dokument/e, Plan/Pläne _" in text_of(row)), None)
    if start_index is None:
        raise ValueError("LP5 document rows not found")
    marker_index = next((i for i, row in enumerate(rows) if text_of(row).startswith("V = Version")), len(rows))
    sample = rows[start_index]
    documents = documents or [{"title": "-", "date": "---", "version": "-", "from": "---", "to": "---"}]
    new_rows = []
    for doc in documents:
        row = copy.deepcopy(sample)
        set_cells(
            row,
            {
                0: required(doc.get("title"), "-"),
                1: required(doc.get("date"), "---"),
                2: required(doc.get("version") or doc.get("vi"), "-"),
                3: required(doc.get("from"), "---"),
                4: required(doc.get("to"), "---"),
            },
        )
        new_rows.append(row)
    replace_rows(table, start_index, marker_index, new_rows)


def fill_lp5_topics(table: ET.Element, topics: list[dict], meeting_number: str) -> None:
    rows = direct_rows(table)
    category_sample = rows[3]
    item_sample = rows[4]
    topics = topics or [{"category": "01", "category_title": "Allgemein", "running_no": "01", "body": "nicht angegeben"}]
    new_rows = []
    current_category = None
    for topic in topics:
        category = required(topic.get("category") or topic.get("dk"), "01")
        category_title = required(topic.get("category_title"), "Disziplin oder Kategorie")
        if category != current_category:
            row = copy.deepcopy(category_sample)
            set_cells(row, {0: category, 1: category_title})
            new_rows.append(row)
            current_category = category

        body_parts = [str(topic.get("title") or "").strip(), str(topic.get("body") or topic.get("summary") or "").strip()]
        body = "\n".join(part for part in body_parts if part) or "nicht angegeben"
        row = copy.deepcopy(item_sample)
        set_cells(
            row,
            {
                0: category,
                1: required(topic.get("meeting_no") or topic.get("meeting_number"), meeting_number),
                2: required(topic.get("running_no") or topic.get("number"), "01"),
                3: body,
                4: required(topic.get("responsible") or topic.get("owner"), "-"),
                5: required(topic.get("deadline") or topic.get("due"), "-"),
                6: required(topic.get("status"), "O"),
            },
        )
        new_rows.append(row)
    replace_rows(table, 3, len(rows), new_rows)


def fill_lp5_appointments(table: ET.Element, appointments: list[dict]) -> None:
    rows = direct_rows(table)
    sample = rows[2]
    appointments = appointments or [{"topic": "-", "participants": "-", "place": "-", "date": "---", "time": "---"}]
    new_rows = []
    for item in appointments:
        row = copy.deepcopy(sample)
        set_cells(
            row,
            {
                0: required(item.get("topic"), "-"),
                1: required(item.get("participants"), "-"),
                3: required(item.get("place"), "-"),
                4: required(item.get("date"), "---"),
                5: required(item.get("time"), "---"),
            },
        )
        new_rows.append(row)
    replace_rows(table, 2, 5, new_rows)


def fill_lp5_doc_info(table: ET.Element, spec: dict) -> None:
    rows = direct_rows(table)
    metadata = spec.get("metadata", {})
    approval = spec.get("approval", {})
    set_cells(rows[2], {1: required(approval.get("creator") or metadata.get("author")), 5: required(approval.get("created_date") or metadata.get("created_date"))})
    set_cells(rows[3], {1: required(approval.get("reviewer"), "---"), 5: required(approval.get("reviewed_date"), "---")})

    attachments = spec.get("attachments", []) or [{"title": "-", "version": "-", "date": "---", "format": "---"}]
    sample = rows[11]
    new_rows = []
    for item in attachments:
        row = copy.deepcopy(sample)
        set_cells(
            row,
            {
                0: required(item.get("title"), "-"),
                1: required(item.get("version") or item.get("vi"), "-"),
                2: required(item.get("date"), "---"),
                4: required(item.get("format"), "---"),
            },
        )
        new_rows.append(row)
    replace_rows(table, 11, 14, new_rows)


def inject_missing_namespaces(xml: bytes, namespaces: dict[str, str]) -> bytes:
    text = xml.decode("utf-8")
    root_start = text.find("<w:document")
    if root_start == -1:
        return xml
    root_end = text.find(">", root_start)
    if root_end == -1:
        return xml
    root_tag = text[root_start:root_end]
    additions = []
    for prefix, uri in namespaces.items():
        if not prefix:
            continue
        needle = f"xmlns:{prefix}="
        if needle not in root_tag:
            additions.append(f' xmlns:{prefix}="{uri}"')
    if not additions:
        return xml
    return (text[:root_end] + "".join(additions) + text[root_end:]).encode("utf-8")


def write_docx(template: Path, output: Path, root: ET.Element, namespaces: dict[str, str]) -> None:
    document_xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    document_xml = inject_missing_namespaces(document_xml, namespaces)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "out.docx"
        shutil.copy2(template, tmp)
        with zipfile.ZipFile(tmp, "r") as zin:
            entries = {info.filename: (info, zin.read(info.filename)) for info in zin.infolist()}
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for name, (info, data) in entries.items():
                zout.writestr(info, document_xml if name == "word/document.xml" else data)


def create_docx(spec_path: Path, output_path: Path) -> None:
    spec = json.loads(spec_path.read_text(encoding="utf-8-sig"))
    manifest = load_manifest()
    template_key = spec.get("template", "pk_lp1_4")
    if template_key not in manifest:
        raise ValueError(f"Unknown template {template_key!r}. Choose one of: {', '.join(manifest)}")
    entry = manifest[template_key]
    if "docx" not in entry:
        raise ValueError(f"Template {template_key!r} is not a DOCX template")
    template = ASSET_DIR / entry["docx"]
    if not template.exists():
        raise FileNotFoundError(template)
    actual_hash = sha256(template)
    if actual_hash != entry["sha256"]:
        raise ValueError(f"Template hash mismatch for {template.name}: {actual_hash}")

    namespaces = register_template_namespaces(template)
    with zipfile.ZipFile(template) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    family = entry["family"]
    if family == "simple":
        fill_simple(root, spec)
    elif family == "lp5":
        fill_lp5(root, spec)
    else:
        raise ValueError(f"Unsupported DOCX template family: {family}")
    write_docx(template, output_path, root, namespaces)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create an EBA protocol DOCX from an official template.")
    parser.add_argument("spec_json", type=Path)
    parser.add_argument("output_docx", type=Path)
    args = parser.parse_args()
    create_docx(args.spec_json, args.output_docx)
    print(args.output_docx)


if __name__ == "__main__":
    main()
