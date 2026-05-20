"""Export a generated protocol DOCX or XLSX to PDF using Office or LibreOffice."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def run_powershell(script: str) -> bool:
    powershell = shutil.which("powershell") or shutil.which("powershell.exe")
    if not powershell:
        return False
    try:
        result = subprocess.run(
            [powershell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except OSError:
        return False
    return result.returncode == 0


def export_with_word(docx: Path, pdf: Path) -> bool:
    script = f"""
$ErrorActionPreference = 'Stop'
$word = $null
$doc = $null
try {{
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $doc = $word.Documents.Open('{str(docx).replace("'", "''")}')
  $doc.SaveAs([ref] '{str(pdf).replace("'", "''")}', [ref] 17)
}} finally {{
  if ($doc -ne $null) {{ $doc.Close() | Out-Null }}
  if ($word -ne $null) {{ $word.Quit() | Out-Null }}
}}
"""
    return run_powershell(script) and pdf.exists() and pdf.stat().st_size > 0


def export_xlsx_with_excel(xlsx: Path, pdf: Path) -> bool:
    script = f"""
$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
try {{
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $workbook = $excel.Workbooks.Open('{str(xlsx).replace("'", "''")}')
  $workbook.ExportAsFixedFormat(0, '{str(pdf).replace("'", "''")}')
}} finally {{
  if ($workbook -ne $null) {{ $workbook.Close($false) | Out-Null }}
  if ($excel -ne $null) {{ $excel.Quit() | Out-Null }}
}}
"""
    return run_powershell(script) and pdf.exists() and pdf.stat().st_size > 0


def export_with_libreoffice(input_path: Path, pdf: Path) -> bool:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return False
    outdir = pdf.parent
    result = subprocess.run(
        [soffice, "--headless", "--convert-to", "pdf", "--outdir", str(outdir), str(input_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    generated = outdir / f"{input_path.stem}.pdf"
    if generated.exists() and generated != pdf:
        generated.replace(pdf)
    return result.returncode == 0 and pdf.exists() and pdf.stat().st_size > 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Export protocol DOCX or XLSX to PDF.")
    parser.add_argument("input_file", type=Path)
    parser.add_argument("pdf", type=Path)
    args = parser.parse_args()
    args.pdf.parent.mkdir(parents=True, exist_ok=True)
    input_file = args.input_file.resolve()
    if input_file.suffix.lower() == ".docx":
        ok = export_with_word(input_file, args.pdf.resolve())
    elif input_file.suffix.lower() == ".xlsx":
        ok = export_xlsx_with_excel(input_file, args.pdf.resolve())
    else:
        print("PDF export failed: input must be .docx or .xlsx.", file=sys.stderr)
        return 1
    if not ok:
        ok = export_with_libreoffice(input_file, args.pdf.resolve())
    if not ok:
        print("PDF export failed: Office or LibreOffice export did not produce a PDF.", file=sys.stderr)
        return 1
    print(args.pdf)
    return 0


if __name__ == "__main__":
    sys.exit(main())
