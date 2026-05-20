"""Validate that an EBA protocol DOCX preserves the official template structure."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}
SKILL_ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = SKILL_ROOT / "assets"
MANIFEST_PATH = SKILL_ROOT / "references" / "template-manifest.json"

UNCHANGED_PARTS = [
    "word/styles.xml",
    "word/theme/theme1.xml",
    "word/settings.xml",
    "word/numbering.xml",
    "word/fontTable.xml",
]

PUBLIC_PLACEHOLDERS = [
    "_Projektname einsetzen_",
    "_Projektnummer einsetzen_",
    "_Projektbeschreibung_",
    "_kurze Beschreibung zum Dokument/Übergeordnetes Thema einsetzen_",
    "_Beschreibung einfügen_",
    "_Besprechungsthema_",
    "_Prj.-Nr._",
    "_Prj.-Name_",
    "_Ort_",
    "_Vorname_",
    "_Name_",
    "_Firma_",
    "_ Dokument/e, Plan/Pläne _",
]

MARKDOWN_LEFTOVERS = [
    "# Meeting-Protokoll",
    "## Teilnehmer",
    "## Besprochene Themen",
    "|---|",
    "|-----|",
]

BRAND_FILLS = {"000000", "A4A5A5", "E1E1E1", "FA6400", "FFB380", "FFE0CC"}


def load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def zip_hash(z: zipfile.ZipFile, name: str) -> str:
    return hashlib.sha256(z.read(name)).hexdigest().upper()


def all_text(root: ET.Element) -> str:
    return "\n".join(t.text or "" for t in root.findall(".//w:t", NS))


def public_text(root: ET.Element, family: str) -> str:
    body = root.find("w:body", NS)
    if body is None:
        return ""
    tables = body.findall(".//w:tbl", NS)
    count = 4 if family == "lp5" else 4
    selected = tables[:count]
    return "\n".join(all_text(tbl) for tbl in selected)


def validate(path: Path, template_key: str) -> list[str]:
    errors: list[str] = []
    manifest = load_manifest()
    entry = manifest.get(template_key)
    if not entry or "docx" not in entry:
        return [f"Unknown DOCX template key: {template_key}"]
    template = ASSET_DIR / entry["docx"]
    if not path.exists() or path.stat().st_size == 0:
        return [f"Output does not exist or is empty: {path}"]

    with zipfile.ZipFile(path) as out_zip, zipfile.ZipFile(template) as tpl_zip:
        for part in UNCHANGED_PARTS:
            if part in out_zip.namelist() and part in tpl_zip.namelist():
                if zip_hash(out_zip, part) != zip_hash(tpl_zip, part):
                    errors.append(f"Template part changed unexpectedly: {part}")
        root = ET.fromstring(out_zip.read("word/document.xml"))
        visible = public_text(root, entry["family"])
        complete = all_text(root)

    for placeholder in PUBLIC_PLACEHOLDERS:
        if placeholder in visible:
            errors.append(f"Public template placeholder still visible: {placeholder}")
    for leftover in MARKDOWN_LEFTOVERS:
        if leftover in complete:
            errors.append(f"Markdown/Cowork leftover found: {leftover}")
    fills = set(re.findall(r'w:fill="([0-9A-Fa-f]{6})"', zipfile.ZipFile(path).read("word/document.xml").decode("utf-8", errors="ignore")))
    if not BRAND_FILLS.intersection(fills):
        errors.append("Expected EBA brand fills were not found in document.xml")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an EBA protocol DOCX.")
    parser.add_argument("docx", type=Path)
    parser.add_argument("--template", required=True, choices=[k for k, v in load_manifest().items() if "docx" in v])
    args = parser.parse_args()
    errors = validate(args.docx, args.template)
    if errors:
        print("Validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Validation passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
