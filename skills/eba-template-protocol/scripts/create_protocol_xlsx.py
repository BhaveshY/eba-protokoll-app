"""Create an EBA protocol XLSX by copying and filling official workbook templates."""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

S_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"s": S_NS, "r": R_NS, "rel": PKG_REL_NS}

SKILL_ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = SKILL_ROOT / "assets"
MANIFEST_PATH = SKILL_ROOT / "references" / "template-manifest.json"

CELL_RE = re.compile(r"(\$?[A-Z]{1,3})(\$?\d+)")
RANGE_RE = re.compile(r"(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?")


def q(name: str) -> str:
    return f"{{{S_NS}}}{name}"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest().upper()


def load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def register_namespaces(data: bytes) -> dict[str, str]:
    namespaces: dict[str, str] = {}
    for _, ns in ET.iterparse(io.BytesIO(data), events=("start-ns",)):
        prefix, uri = ns
        namespaces.setdefault(prefix or "", uri)
        ET.register_namespace(prefix or "", uri)
    return namespaces


def inject_missing_namespaces(xml: bytes, namespaces: dict[str, str], root_name: str = "worksheet") -> bytes:
    text = xml.decode("utf-8")
    root_start = text.find(f"<{root_name}")
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


def col_row(cell_ref: str) -> tuple[str, int]:
    match = CELL_RE.fullmatch(cell_ref.replace("$", ""))
    if not match:
        raise ValueError(f"Invalid cell reference: {cell_ref}")
    return match.group(1), int(match.group(2))


def cell_ref(col: str, row: int) -> str:
    return f"{col}{row}"


def shift_cell_ref(ref: str, start: int, delta: int) -> str:
    col, row = col_row(ref)
    return f"{col}{row + delta}" if row >= start else ref


def shift_range_token(token: str, start: int, delta: int) -> str:
    match = RANGE_RE.fullmatch(token)
    if not match:
        return token
    left = match.group(1)
    right = match.group(2)
    if not right:
        return shift_cell_ref(left, start, delta)
    left_col, left_row = col_row(left)
    right_col, right_row = col_row(right)
    if right_row < start:
        return token
    if left_row >= start:
        left_row += delta
        right_row += delta
    else:
        right_row += delta
    if right_row < left_row:
        left_row, right_row = right_row, left_row
    return f"{left_col}{left_row}:{right_col}{right_row}"


def shift_ref_string(value: str, start: int, delta: int) -> str:
    parts = []
    for token in value.split():
        if "!" in token:
            sheet, ref = token.rsplit("!", 1)
            parts.append(f"{sheet}!{shift_range_token(ref, start, delta)}")
        else:
            parts.append(shift_range_token(token, start, delta))
    return " ".join(parts)


def shift_non_cell_refs(root: ET.Element, start: int, delta: int) -> None:
    for el in root.iter():
        if el.tag in {q("row"), q("c")}:
            continue
        for attr in ("ref", "sqref"):
            if attr in el.attrib:
                el.set(attr, shift_ref_string(el.attrib[attr], start, delta))


def rows(root: ET.Element) -> list[ET.Element]:
    sheet_data = root.find("s:sheetData", NS)
    if sheet_data is None:
        raise ValueError("Worksheet has no sheetData")
    return sheet_data.findall("s:row", NS)


def row_number(row: ET.Element) -> int:
    return int(row.get("r", "0"))


def set_row_number(row: ET.Element, new_row: int) -> None:
    old_row = row_number(row)
    row.set("r", str(new_row))
    for cell in row.findall("s:c", NS):
        ref = cell.get("r")
        if ref:
            col, _ = col_row(ref)
            cell.set("r", cell_ref(col, new_row))
        for formula in cell.findall("s:f", NS):
            if formula.text:
                formula.text = re.sub(rf"(?<![A-Z]){old_row}(?!\d)", str(new_row), formula.text)


def shift_existing_rows(root: ET.Element, start: int, delta: int) -> None:
    if delta == 0:
        return
    iterable = sorted(rows(root), key=row_number, reverse=delta > 0)
    for row in iterable:
        if row_number(row) >= start:
            set_row_number(row, row_number(row) + delta)
    shift_non_cell_refs(root, start, delta)


def blank_row_values(row: ET.Element) -> None:
    for cell in row.findall("s:c", NS):
        ref = cell.get("r")
        style = cell.get("s")
        cell.attrib.clear()
        if ref:
            cell.set("r", ref)
        if style:
            cell.set("s", style)
        for child in list(cell):
            cell.remove(child)


def replace_row_block(root: ET.Element, start: int, stop: int, new_rows: list[ET.Element]) -> int:
    sheet_data = root.find("s:sheetData", NS)
    if sheet_data is None:
        raise ValueError("Worksheet has no sheetData")
    current_rows = rows(root)
    capacity = stop - start
    remove = [row for row in current_rows if start <= row_number(row) < stop]
    originals = {row_number(row): copy.deepcopy(row) for row in remove}
    if remove:
        insert_index = min(list(sheet_data).index(row) for row in remove)
    else:
        insert_index = next(
            (i for i, row in enumerate(list(sheet_data)) if row_number(row) >= stop),
            len(list(sheet_data)),
        )
    for row in remove:
        sheet_data.remove(row)

    if len(new_rows) <= capacity:
        padded_rows = [copy.deepcopy(row) for row in new_rows]
        fallback = originals.get(start)
        if fallback is None and new_rows:
            fallback = new_rows[-1]
        if fallback is None:
            fallback = ET.Element(q("row"))
        for offset in range(len(padded_rows), capacity):
            row = copy.deepcopy(originals.get(start + offset, fallback))
            blank_row_values(row)
            padded_rows.append(row)
        for offset, row in enumerate(padded_rows):
            set_row_number(row, start + offset)
            sheet_data.insert(insert_index + offset, row)
        return 0

    delta = len(new_rows) - capacity
    shift_existing_rows(root, stop, delta)
    for offset, row in enumerate(new_rows):
        set_row_number(row, start + offset)
        sheet_data.insert(insert_index + offset, row)
    return delta


def get_cell(row: ET.Element, col: str) -> ET.Element:
    for cell in row.findall("s:c", NS):
        ref = cell.get("r", "")
        if ref and col_row(ref)[0] == col:
            return cell
    cell = ET.Element(q("c"), {"r": cell_ref(col, row_number(row))})
    row.append(cell)
    return cell


def set_cell_value(cell: ET.Element, value: object) -> None:
    ref = cell.get("r")
    style = cell.get("s")
    cell.attrib.clear()
    if ref:
        cell.set("r", ref)
    if style:
        cell.set("s", style)
    cell.set("t", "inlineStr")
    for child in list(cell):
        cell.remove(child)
    is_el = ET.SubElement(cell, q("is"))
    text_el = ET.SubElement(is_el, q("t"))
    text = "" if value is None else str(value)
    if text.startswith(" ") or text.endswith(" ") or "\n" in text:
        text_el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    text_el.text = text


def set_row_cells(row: ET.Element, values: dict[str, object]) -> None:
    for col, value in values.items():
        set_cell_value(get_cell(row, col), value)


def required(value: object, fallback: str = "nicht angegeben") -> str:
    text = "" if value is None else str(value).strip()
    return text or fallback


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


def topic_text(topic: dict) -> str:
    parts = [str(topic.get("title") or "").strip(), str(topic.get("body") or topic.get("summary") or "").strip()]
    return "\n".join(part for part in parts if part) or "nicht angegeben"


def row_by_number(root: ET.Element, number: int) -> ET.Element:
    for row in rows(root):
        if row_number(row) == number:
            return row
    raise ValueError(f"Row {number} not found")


def sheet_part_paths(template: Path) -> dict[str, str]:
    with zipfile.ZipFile(template) as z:
        workbook = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rel_targets = {
        rel.get("Id"): rel.get("Target", "")
        for rel in rels.findall("rel:Relationship", NS)
    }
    result = {}
    for sheet in workbook.findall("s:sheets/s:sheet", NS):
        name = sheet.get("name")
        rid = sheet.get(f"{{{R_NS}}}id")
        target = rel_targets.get(rid, "")
        if target.startswith("/"):
            part = target.lstrip("/")
        else:
            part = f"xl/{target}"
        if name:
            result[name] = part
    return result


def load_sheet_roots(template: Path, names: list[str]) -> tuple[dict[str, ET.Element], dict[str, dict[str, str]], dict[str, str]]:
    part_paths = sheet_part_paths(template)
    roots = {}
    namespaces = {}
    with zipfile.ZipFile(template) as z:
        for name in names:
            part = part_paths[name]
            data = z.read(part)
            namespaces[part] = register_namespaces(data)
            roots[part] = ET.fromstring(data)
    return roots, namespaces, part_paths


def load_shared_strings(template: Path) -> list[str]:
    with zipfile.ZipFile(template) as z:
        if "xl/sharedStrings.xml" not in z.namelist():
            return []
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    return ["".join(t.text or "" for t in si.findall(".//s:t", NS)) for si in root.findall("s:si", NS)]


def fill_deckblatt_formal(root: ET.Element, spec: dict, shared: list[str]) -> None:
    metadata = spec.get("metadata", {})
    set_row_cells(row_by_number(root, 3), {"A": required(metadata.get("meeting_number"), "XX")})
    set_row_cells(row_by_number(root, 6), {"B": required(metadata.get("meeting_title") or metadata.get("description"))})
    set_row_cells(row_by_number(root, 7), {"B": required(metadata.get("project_number"))})
    set_row_cells(row_by_number(root, 8), {"B": required(metadata.get("project_name"))})
    set_row_cells(row_by_number(root, 10), {"B": required(metadata.get("place")), "E": required(metadata.get("meeting_date"))})
    set_row_cells(row_by_number(root, 11), {"E": required(metadata.get("time"), "nicht angegeben")})
    fill_formal_people(root, 15, 25, spec.get("participants", []))
    fill_formal_documents(root, spec.get("documents", []), shared)


def fill_deckblatt_simple(root: ET.Element, spec: dict) -> None:
    metadata = spec.get("metadata", {})
    set_row_cells(row_by_number(root, 3), {"A": f"zur Besprechung Nr. {required(metadata.get('meeting_number'), 'XX')}"})
    set_row_cells(row_by_number(root, 6), {"B": required(metadata.get("meeting_title") or metadata.get("description"))})
    set_row_cells(row_by_number(root, 7), {"B": required(metadata.get("project_number"))})
    set_row_cells(row_by_number(root, 8), {"B": required(metadata.get("project_name"))})
    set_row_cells(
        row_by_number(root, 12),
        {
            "A": required(metadata.get("place")),
            "B": required(metadata.get("meeting_date")),
            "C": required(metadata.get("created_date")),
            "D": required(metadata.get("author")),
        },
    )
    fill_simple_people(root, 16, 26, spec.get("participants", []))
    fill_simple_distribution(root, spec.get("distribution", []))


def fill_formal_people(root: ET.Element, start: int, stop: int, people: list[dict]) -> None:
    sample = row_by_number(root, start)
    normalized = [normalize_person(p) for p in people] or [normalize_person({"first_name": "nicht angegeben"})]
    new_rows = []
    for person in normalized:
        row = copy.deepcopy(sample)
        set_row_cells(
            row,
            {
                "A": person["first_name"],
                "B": person["last_name"],
                "C": person["initials"] or "---",
                "D": person["company"],
                "E": person["company_code"] or "---",
                "F": person["attendance"] or "X",
                "G": person["distribution"] or "X",
            },
        )
        new_rows.append(row)
    replace_row_block(root, start, stop, new_rows)


def fill_simple_people(root: ET.Element, start: int, stop: int, people: list[dict]) -> None:
    sample = row_by_number(root, start)
    normalized = [normalize_person(p) for p in people] or [normalize_person({"first_name": "nicht angegeben"})]
    new_rows = []
    for person in normalized:
        row = copy.deepcopy(sample)
        set_row_cells(
            row,
            {
                "A": person["first_name"],
                "B": person["last_name"],
                "C": person["initials"],
                "D": person["company"],
            },
        )
        new_rows.append(row)
    replace_row_block(root, start, stop, new_rows)


def fill_simple_distribution(root: ET.Element, distribution: list[dict]) -> None:
    start = next((row_number(r) for r in rows(root) if row_number(r) > 28 and row_number(r) < 32), 29)
    sample = row_by_number(root, start) if any(row_number(r) == start for r in rows(root)) else row_by_number(root, 16)
    normalized = [normalize_person(p) for p in distribution] or [normalize_person({"first_name": "wie Teilnehmer"})]
    new_rows = []
    for person in normalized:
        row = copy.deepcopy(sample)
        set_row_cells(row, {"A": person["first_name"], "B": person["last_name"], "C": person["initials"], "D": person["company"]})
        new_rows.append(row)
    replace_row_block(root, start, 32, new_rows)


def fill_formal_documents(root: ET.Element, documents: list[dict], shared: list[str]) -> None:
    doc_start = next((row_number(r) for r in rows(root) if "_ Dokument/e, Plan/Pläne _" in row_values_text(r, shared)), None)
    marker = next((row_number(r) for r in rows(root) if row_values_text(r, shared).startswith("V = Version")), None)
    if doc_start is None or marker is None:
        return
    sample = row_by_number(root, doc_start)
    documents = documents or [{"title": "-", "date": "---", "version": "-", "from": "---", "to": "---"}]
    new_rows = []
    for doc in documents:
        row = copy.deepcopy(sample)
        set_row_cells(
            row,
            {
                "A": required(doc.get("title"), "-"),
                "D": required(doc.get("date"), "---"),
                "E": required(doc.get("version") or doc.get("vi"), "-"),
                "F": required(doc.get("from"), "---"),
                "G": required(doc.get("to"), "---"),
            },
        )
        new_rows.append(row)
    replace_row_block(root, doc_start, marker, new_rows)


def row_values_text(row: ET.Element, shared: list[str] | None = None) -> str:
    texts = []
    for cell in row.findall("s:c", NS):
        if cell.get("t") == "s":
            v = cell.find("s:v", NS)
            if v is not None and v.text and v.text.isdigit():
                index = int(v.text)
                if shared and index < len(shared):
                    texts.append(shared[index])
        for t in cell.findall(".//s:t", NS):
            if t.text:
                texts.append(t.text)
    return " ".join(texts)


def fill_protokoll_simple(root: ET.Element, spec: dict) -> None:
    sample = row_by_number(root, 2)
    topics = spec.get("topics", []) or [{"number": "1", "title": "Thema", "body": "nicht angegeben"}]
    new_rows = []
    for index, topic in enumerate(topics, start=1):
        row = copy.deepcopy(sample)
        number = topic.get("number") or str(index)
        set_row_cells(
            row,
            {
                "A": number,
                "B": required(topic.get("title"), "Thema"),
                "C": required(topic.get("body") or topic.get("summary")),
                "D": required(topic.get("responsible") or topic.get("owner"), "nicht angegeben"),
                "E": required(topic.get("deadline") or topic.get("due"), "Noch festzulegen"),
            },
        )
        new_rows.append(row)
    replace_row_block(root, 2, 7, new_rows)


def fill_protokoll_formal(root: ET.Element, spec: dict) -> int:
    category_sample = row_by_number(root, 4)
    item_sample = row_by_number(root, 5)
    meeting_number = required(spec.get("metadata", {}).get("meeting_number"), "01")
    topics = spec.get("topics", []) or [{"category": "01", "category_title": "Allgemein", "running_no": "01", "body": "nicht angegeben"}]
    new_rows = []
    current_category = None
    for topic in topics:
        category = required(topic.get("category") or topic.get("dk"), "01")
        if category != current_category:
            row = copy.deepcopy(category_sample)
            set_row_cells(row, {"A": category, "B": required(topic.get("category_title"), "Disziplin oder Kategorie")})
            new_rows.append(row)
            current_category = category
        row = copy.deepcopy(item_sample)
        set_row_cells(
            row,
            {
                "A": category,
                "B": required(topic.get("meeting_no") or topic.get("meeting_number"), meeting_number),
                "C": required(topic.get("running_no") or topic.get("number"), "01"),
                "D": topic_text(topic),
                "E": required(topic.get("responsible") or topic.get("owner"), "-"),
                "F": required(topic.get("deadline") or topic.get("due"), "-"),
                "G": required(topic.get("status"), "O"),
            },
        )
        new_rows.append(row)
    return replace_row_block(root, 4, 23, new_rows)


def fill_doku_info(root: ET.Element, spec: dict, shared: list[str]) -> None:
    appointments = spec.get("appointments", []) or [{"topic": "-", "participants": "-", "place": "-", "date": "---", "time": "---"}]
    sample = row_by_number(root, 3)
    new_rows = []
    for item in appointments:
        row = copy.deepcopy(sample)
        set_row_cells(
            row,
            {
                "A": required(item.get("topic"), "-"),
                "D": required(item.get("participants"), "-"),
                "F": required(item.get("place"), "-"),
                "H": required(item.get("date"), "---"),
                "I": required(item.get("time"), "---"),
            },
        )
        new_rows.append(row)
    replace_row_block(root, 3, 6, new_rows)

    approval = spec.get("approval", {})
    metadata = spec.get("metadata", {})
    creator_row = next(
        (r for r in rows(root) if "Ersteller" in row_values_text(r, shared) and "Erstelldatum" in row_values_text(r, shared)),
        None,
    )
    reviewer_row = next(
        (r for r in rows(root) if "Geprüft" in row_values_text(r, shared) and "Prüfdatum" in row_values_text(r, shared)),
        None,
    )
    if creator_row is not None:
        set_row_cells(creator_row, {"D": required(approval.get("creator") or metadata.get("author")), "H": required(approval.get("created_date") or metadata.get("created_date"))})
    if reviewer_row is not None:
        set_row_cells(reviewer_row, {"D": required(approval.get("reviewer"), "---"), "H": required(approval.get("reviewed_date"), "---")})

    attachments = spec.get("attachments", []) or [{"title": "-", "version": "-", "date": "---", "format": "---"}]
    att_start = next((row_number(r) for r in rows(root) if "_Dokument/e, Plan/Pläne_" in row_values_text(r, shared)), 17)
    att_stop = att_start + 3
    sample = row_by_number(root, att_start)
    new_rows = []
    for item in attachments:
        row = copy.deepcopy(sample)
        set_row_cells(
            row,
            {
                "A": required(item.get("title"), "-"),
                "E": required(item.get("version") or item.get("vi"), "-"),
                "F": required(item.get("date"), "---"),
                "H": required(item.get("format"), "---"),
            },
        )
        new_rows.append(row)
    replace_row_block(root, att_start, att_stop, new_rows)


def serialize_sheet(root: ET.Element, namespaces: dict[str, str]) -> bytes:
    xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    return inject_missing_namespaces(xml, namespaces)


def update_table_range(data: bytes, end_row: int) -> bytes:
    namespaces = register_namespaces(data)
    root = ET.fromstring(data)
    table_ref = f"A2:G{end_row}"
    root.set("ref", table_ref)
    auto_filter = root.find("s:autoFilter", NS)
    if auto_filter is not None:
        auto_filter.set("ref", table_ref)
    xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    return inject_missing_namespaces(xml, namespaces, root_name="table")


def update_print_area(data: bytes, sheet_name: str, end_ref: str) -> bytes:
    namespaces = register_namespaces(data)
    root = ET.fromstring(data)
    defined_names = root.find("s:definedNames", NS)
    if defined_names is None:
        return data
    target = f"{sheet_name}!{end_ref}"
    for defined_name in defined_names.findall("s:definedName", NS):
        if defined_name.get("name") == "_xlnm.Print_Area" and (defined_name.text or "").startswith(f"{sheet_name}!"):
            defined_name.text = target
    xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    return inject_missing_namespaces(xml, namespaces, root_name="workbook")


def create_xlsx(spec_path: Path, output_path: Path) -> None:
    spec = json.loads(spec_path.read_text(encoding="utf-8-sig"))
    manifest = load_manifest()
    template_key = spec.get("template", "pk_lp1_4_excel")
    if template_key not in manifest:
        raise ValueError(f"Unknown template {template_key!r}. Choose one of: {', '.join(manifest)}")
    entry = manifest[template_key]
    if "xlsx" not in entry:
        raise ValueError(f"Template {template_key!r} is not an XLSX template")
    template = ASSET_DIR / entry["xlsx"]
    if not template.exists():
        raise FileNotFoundError(template)
    actual_hash = sha256(template)
    if actual_hash != entry["sha256"]:
        raise ValueError(f"Template hash mismatch for {template.name}: {actual_hash}")

    shared = load_shared_strings(template)
    roots, namespaces, part_paths = load_sheet_roots(template, ["Deckblatt", "Protokoll", "Doku_Info"])
    deck = roots[part_paths["Deckblatt"]]
    protokoll = roots[part_paths["Protokoll"]]
    doku = roots[part_paths["Doku_Info"]]

    family = entry["family"]
    protokoll_extra_rows = 0
    if family == "excel-formal":
        fill_deckblatt_formal(deck, spec, shared)
        protokoll_extra_rows = fill_protokoll_formal(protokoll, spec)
    elif family == "excel-simple":
        fill_deckblatt_simple(deck, spec)
        fill_protokoll_simple(protokoll, spec)
    else:
        raise ValueError(f"Unsupported XLSX template family: {family}")
    fill_doku_info(doku, spec, shared)

    replacements = {
        part: serialize_sheet(root, namespaces[part])
        for part, root in roots.items()
    }
    if family == "excel-formal" and protokoll_extra_rows > 0:
        with zipfile.ZipFile(template) as z:
            table_end = 22 + protokoll_extra_rows
            replacements["xl/tables/table1.xml"] = update_table_range(z.read("xl/tables/table1.xml"), table_end)
            replacements["xl/workbook.xml"] = update_print_area(z.read("xl/workbook.xml"), "Protokoll", f"$A$1:$G${table_end}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "out.xlsx"
        shutil.copy2(template, tmp)
        with zipfile.ZipFile(tmp, "r") as zin:
            entries = {info.filename: (info, zin.read(info.filename)) for info in zin.infolist()}
        with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for name, (info, data) in entries.items():
                zout.writestr(info, replacements.get(name, data))


def main() -> None:
    parser = argparse.ArgumentParser(description="Create an EBA protocol XLSX from an official workbook template.")
    parser.add_argument("spec_json", type=Path)
    parser.add_argument("output_xlsx", type=Path)
    args = parser.parse_args()
    create_xlsx(args.spec_json, args.output_xlsx)
    print(args.output_xlsx)


if __name__ == "__main__":
    main()
