"""Validate that an EBA protocol XLSX preserves the official workbook template."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
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

UNCHANGED_PARTS = [
    "xl/styles.xml",
    "xl/theme/theme1.xml",
    "xl/_rels/workbook.xml.rels",
]

PUBLIC_PLACEHOLDERS = [
    "_Besprechungsthema_",
    "_Prj.-Nr._",
    "_Prj.-Name_",
    "_Ort_",
    "_tt.mm.jj_",
    "_Ersteller_",
    "_Vorname_",
    "_Name_",
    "_Kürzel_",
    "_Firma_",
    "_ Dokument/e, Plan/Pläne _",
    "_Dokument/e, Plan/Pläne_",
    "_Thema 01_",
    "_Name A_",
    "TT.MM.JJ",
    "TT.MM.JJJJ",
    "XXX",
]

MARKDOWN_LEFTOVERS = [
    "# Meeting-Protokoll",
    "## Teilnehmer",
    "## Besprochene Themen",
    "|---|",
    "|-----|",
]

BRAND_STYLE_TOKENS = ["FA8800", "A4A5A5", "E1E1E1", "000000"]
CELL_RE = re.compile(r"\$?([A-Z]{1,3})\$?(\d+)")
RANGE_RE = re.compile(r"\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?\d+")


def load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def zip_hash(z: zipfile.ZipFile, name: str) -> str:
    return hashlib.sha256(z.read(name)).hexdigest().upper()


def sheet_part_paths(z: zipfile.ZipFile) -> dict[str, str]:
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


def shared_strings(z: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    values = []
    for si in root.findall("s:si", NS):
        values.append("".join(t.text or "" for t in si.findall(".//s:t", NS)))
    return values


def sheet_text(z: zipfile.ZipFile, part: str, shared: list[str]) -> str:
    root = ET.fromstring(z.read(part))
    values = []
    for cell in root.findall(".//s:c", NS):
        cell_type = cell.get("t")
        if cell_type == "inlineStr":
            values.extend(t.text or "" for t in cell.findall(".//s:t", NS))
        elif cell_type == "s":
            v = cell.find("s:v", NS)
            if v is not None and v.text and v.text.isdigit():
                idx = int(v.text)
                if idx < len(shared):
                    values.append(shared[idx])
        else:
            v = cell.find("s:v", NS)
            if v is not None and v.text:
                values.append(v.text)
    return "\n".join(values)


def normalize_allowed_workbook_changes(data: bytes, template_key: str) -> bytes:
    root = ET.fromstring(data)
    defined_names = root.find("s:definedNames", NS)
    if defined_names is not None and template_key == "pk_excel":
        for defined_name in defined_names.findall("s:definedName", NS):
            if defined_name.get("name") == "_xlnm.Print_Area" and (defined_name.text or "").startswith("Protokoll!"):
                defined_name.text = "Protokoll!$A$1:$G$__ROW__"
    return ET.tostring(root, encoding="utf-8")


def validate_workbook_part(out_zip: zipfile.ZipFile, tpl_zip: zipfile.ZipFile, template_key: str) -> list[str]:
    if zip_hash(out_zip, "xl/workbook.xml") == zip_hash(tpl_zip, "xl/workbook.xml"):
        return []
    out_norm = normalize_allowed_workbook_changes(out_zip.read("xl/workbook.xml"), template_key)
    tpl_norm = normalize_allowed_workbook_changes(tpl_zip.read("xl/workbook.xml"), template_key)
    if out_norm == tpl_norm:
        return []
    return ["Template part changed unexpectedly: xl/workbook.xml"]


def row_from_ref(ref: str) -> int:
    match = CELL_RE.fullmatch(ref.replace("$", ""))
    if not match:
        raise ValueError(f"Invalid cell reference: {ref}")
    return int(match.group(2))


def range_end_row(ref: str) -> int:
    right = ref.split(":")[-1]
    return row_from_ref(right)


def dimension_end_row(root: ET.Element) -> int:
    dimension = root.find("s:dimension", NS)
    if dimension is None or not dimension.get("ref"):
        return 0
    return range_end_row(dimension.get("ref", "A1"))


def invalid_range_refs(root: ET.Element) -> list[str]:
    invalid = []
    for el in root.iter():
        for attr in ("ref", "sqref"):
            value = el.get(attr)
            if not value:
                continue
            for token in value.split():
                if "!" in token:
                    token = token.rsplit("!", 1)[-1]
                if not RANGE_RE.fullmatch(token):
                    continue
                left, right = token.split(":", 1)
                if row_from_ref(right) < row_from_ref(left):
                    invalid.append(value)
    return invalid


def validate_table_consistency(z: zipfile.ZipFile, template_key: str, parts: dict[str, str]) -> list[str]:
    if template_key != "pk_excel":
        return []
    errors = []
    protokoll = ET.fromstring(z.read(parts["Protokoll"]))
    table = ET.fromstring(z.read("xl/tables/table1.xml"))
    workbook = ET.fromstring(z.read("xl/workbook.xml"))
    table_ref = table.get("ref", "")
    auto_filter = table.find("s:autoFilter", NS)
    if auto_filter is None or auto_filter.get("ref") != table_ref:
        errors.append("Formal workbook table and autofilter ranges differ")
    if table_ref and range_end_row(table_ref) != dimension_end_row(protokoll) - 1:
        errors.append("Formal workbook table range does not match Protokoll sheet dimensions")
    defined_names = workbook.find("s:definedNames", NS)
    if defined_names is not None and table_ref:
        print_areas = [
            defined_name.text or ""
            for defined_name in defined_names.findall("s:definedName", NS)
            if defined_name.get("name") == "_xlnm.Print_Area" and (defined_name.text or "").startswith("Protokoll!")
        ]
        if print_areas and range_end_row(print_areas[0]) != range_end_row(table_ref):
            errors.append("Formal workbook print area does not match the protocol table range")
    return errors


def validate(path: Path, template_key: str) -> list[str]:
    errors: list[str] = []
    manifest = load_manifest()
    entry = manifest.get(template_key)
    if not entry or "xlsx" not in entry:
        return [f"Unknown XLSX template key: {template_key}"]
    template = ASSET_DIR / entry["xlsx"]
    if not path.exists() or path.stat().st_size == 0:
        return [f"Output does not exist or is empty: {path}"]

    with zipfile.ZipFile(path) as out_zip, zipfile.ZipFile(template) as tpl_zip:
        for part in UNCHANGED_PARTS:
            if part in out_zip.namelist() and part in tpl_zip.namelist():
                if zip_hash(out_zip, part) != zip_hash(tpl_zip, part):
                    errors.append(f"Template part changed unexpectedly: {part}")
        errors.extend(validate_workbook_part(out_zip, tpl_zip, template_key))
        out_names = set(out_zip.namelist())
        tpl_names = set(tpl_zip.namelist())
        if out_names != tpl_names:
            errors.append("Workbook package parts changed unexpectedly")
        styles = out_zip.read("xl/styles.xml").decode("utf-8", errors="ignore")
        for token in BRAND_STYLE_TOKENS:
            if token not in styles:
                errors.append(f"Expected EBA style token missing: {token}")
        parts = sheet_part_paths(out_zip)
        shared = shared_strings(out_zip)
        visible = "\n".join(sheet_text(out_zip, parts[name], shared) for name in ("Deckblatt", "Protokoll", "Doku_Info"))
        errors.extend(validate_table_consistency(out_zip, template_key, parts))
        for sheet_name in ("Deckblatt", "Protokoll", "Doku_Info"):
            sheet_root = ET.fromstring(out_zip.read(parts[sheet_name]))
            for ref in invalid_range_refs(sheet_root):
                errors.append(f"Invalid reversed range in {sheet_name}: {ref}")

    for placeholder in PUBLIC_PLACEHOLDERS:
        if placeholder in visible:
            errors.append(f"Public workbook placeholder still visible: {placeholder}")
    for leftover in MARKDOWN_LEFTOVERS:
        if leftover in visible:
            errors.append(f"Markdown/Cowork leftover found: {leftover}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an EBA protocol XLSX.")
    parser.add_argument("xlsx", type=Path)
    parser.add_argument("--template", required=True, choices=[k for k, v in load_manifest().items() if "xlsx" in v])
    args = parser.parse_args()
    errors = validate(args.xlsx, args.template)
    if errors:
        print("Validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Validation passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
