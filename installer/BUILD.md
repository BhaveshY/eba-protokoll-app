# Building the EBA Protokoll Installer

## Prerequisites

1. Install **Inno Setup 6** from https://jrsoftware.org/isinfo.php
   - Download the installer and run it
   - Default installation is fine

## Build Steps

1. Open `installer/setup.iss` in Inno Setup Compiler
2. Click **Build > Compile** (or press Ctrl+F9)
3. The installer will be created at `installer/output/EBA-Protokoll-Setup-1.0.0.exe`

## What the Installer Does

1. Shows a wizard with install location and HuggingFace token input
2. Copies app files to the install directory (default: `C:\EBA-Protokoll`)
3. Runs `install_deps.ps1` which:
   - Checks for Python 3.10+, installs Python 3.12 if missing
   - Checks for FFmpeg on PATH
   - Creates a Python virtual environment
   - Installs PyTorch with CUDA support (~2.5 GB)
   - Installs WhisperX and all dependencies
   - Verifies CUDA availability
   - Creates config.json (preserves existing)
4. Creates desktop and Start Menu shortcuts
5. Registers an uninstaller in Add/Remove Programs

## Distribution

The output `.exe` is a self-contained installer (~500 KB). Users need:
- Windows 10/11 (64-bit)
- Internet connection (downloads ~3-4 GB during install)
- NVIDIA GPU recommended (works without, but slower)

## Updating the Version

Change `#define AppVersion "1.0.0"` in `setup.iss` to the new version number.
