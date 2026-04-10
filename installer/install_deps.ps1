# ============================================================================
#  EBA Protokoll - Dependency Installer (called by Inno Setup post-install)
#  Installs Python venv, PyTorch+CUDA, onnx-asr (Parakeet TDT), FFmpeg, and downloads models.
# ============================================================================

param(
    [string]$InstallDir = "C:\EBA-Protokoll",
    [string]$HFToken = ""
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"  # speeds up Invoke-WebRequest

function Write-Step($step, $total, $msg) {
    Write-Host "`n[$step/$total] $msg" -ForegroundColor Cyan
}

$TOTAL = 9

# --------------------------------------------------------------------------
# 1. Find Python
# --------------------------------------------------------------------------
Write-Step 1 $TOTAL "Pruefe Python-Installation..."

$pythonExe = $null
foreach ($candidate in @(
    "python",
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe",
    "C:\Python312\python.exe",
    "C:\Python311\python.exe"
)) {
    try {
        $ver = & $candidate --version 2>&1
        if ($ver -match "Python 3\.(1[0-9]|[2-9]\d)") {
            $pythonExe = $candidate
            Write-Host "  Gefunden: $ver ($candidate)"
            break
        }
    } catch {}
}

if (-not $pythonExe) {
    Write-Step 1 $TOTAL "Python nicht gefunden. Installiere Python 3.12..."
    $pyInstaller = Join-Path $env:TEMP "python-3.12.9-amd64.exe"
    Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe" -OutFile $pyInstaller
    Start-Process -FilePath $pyInstaller -ArgumentList "/quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_test=0" -Wait
    Remove-Item $pyInstaller -ErrorAction SilentlyContinue

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    $pythonExe = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
    if (-not (Test-Path $pythonExe)) {
        $pythonExe = "python"
    }
    Write-Host "  Python installiert."
}

# --------------------------------------------------------------------------
# 2. Install FFmpeg (auto-download if missing)
# --------------------------------------------------------------------------
Write-Step 2 $TOTAL "Pruefe FFmpeg..."

$ffmpegFound = $false
$ffmpegDir = Join-Path $InstallDir "ffmpeg\bin"
$ffmpegPaths = @(
    (Join-Path $ffmpegDir "ffmpeg.exe"),
    "C:\ffmpeg\bin\ffmpeg.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe",
    "C:\ProgramData\chocolatey\bin\ffmpeg.exe"
)

# Check PATH first
try {
    $null = & ffmpeg -version 2>&1
    $ffmpegFound = $true
    Write-Host "  FFmpeg im PATH gefunden."
} catch {}

if (-not $ffmpegFound) {
    foreach ($fp in $ffmpegPaths) {
        if (Test-Path $fp) {
            $ffmpegFound = $true
            $ffmpegDir = Split-Path $fp
            break
        }
    }
}

if (-not $ffmpegFound) {
    Write-Host "  FFmpeg nicht gefunden. Lade herunter (~90 MB)..."
    $ffmpegZip = Join-Path $env:TEMP "ffmpeg-essentials.zip"
    $ffmpegExtract = Join-Path $env:TEMP "ffmpeg-extract"
    try {
        Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $ffmpegZip
        Expand-Archive -Path $ffmpegZip -DestinationPath $ffmpegExtract -Force
        # The zip contains a versioned subfolder — find it
        $innerDir = Get-ChildItem $ffmpegExtract -Directory | Select-Object -First 1
        $ffmpegDest = Join-Path $InstallDir "ffmpeg"
        if (Test-Path $ffmpegDest) { Remove-Item $ffmpegDest -Recurse -Force }
        Move-Item (Join-Path $innerDir.FullName "bin") $ffmpegDest -Force
        $ffmpegDir = $ffmpegDest
        Write-Host "  FFmpeg installiert nach: $ffmpegDest"
    } catch {
        Write-Host "  FFmpeg-Download fehlgeschlagen: $_" -ForegroundColor Yellow
        Write-Host "  Bitte manuell installieren: https://www.gyan.dev/ffmpeg/builds/" -ForegroundColor Yellow
    } finally {
        Remove-Item $ffmpegZip -ErrorAction SilentlyContinue
        Remove-Item $ffmpegExtract -Recurse -ErrorAction SilentlyContinue
    }
}

# Add FFmpeg to user PATH if not already there
if ($ffmpegDir -and (Test-Path (Join-Path $ffmpegDir "ffmpeg.exe"))) {
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$ffmpegDir*") {
        [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$ffmpegDir", "User")
        $env:Path += ";$ffmpegDir"
        Write-Host "  FFmpeg zum PATH hinzugefuegt."
    }
}

# --------------------------------------------------------------------------
# 3. Create directories
# --------------------------------------------------------------------------
Write-Step 3 $TOTAL "Erstelle Verzeichnisse..."

foreach ($dir in @($InstallDir, "$InstallDir\aufnahmen", "$InstallDir\transkripte", "$InstallDir\protokolle")) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
Write-Host "  Verzeichnisse erstellt."

# --------------------------------------------------------------------------
# 4. Create virtual environment
# --------------------------------------------------------------------------
Write-Step 4 $TOTAL "Erstelle Virtual Environment..."

$venvDir = Join-Path $InstallDir ".venv"
$pipExe = Join-Path $venvDir "Scripts\pip.exe"
$venvPython = Join-Path $venvDir "Scripts\python.exe"

if (-not (Test-Path $venvDir)) {
    & $pythonExe -m venv $venvDir
}
& $venvPython -m pip install --upgrade pip --quiet 2>&1 | Out-Null
Write-Host "  Virtual Environment bereit."

# --------------------------------------------------------------------------
# 5. Install PyTorch with CUDA
# --------------------------------------------------------------------------
Write-Step 5 $TOTAL "Installiere PyTorch mit CUDA-Unterstuetzung..."
Write-Host "  Dies kann einige Minuten dauern (ca. 2-3 GB Download)..."

& $pipExe install torch torchaudio --index-url https://download.pytorch.org/whl/cu126 2>&1 | ForEach-Object {
    if ($_ -match "^(Downloading|Installing|Successfully)") { Write-Host "  $_" }
}

# --------------------------------------------------------------------------
# 6. Install onnx-asr and dependencies
# --------------------------------------------------------------------------
Write-Step 6 $TOTAL "Installiere ASR und Abhaengigkeiten..."
Write-Host "  Dies kann einige Minuten dauern..."

& $pipExe install "onnx-asr[gpu,hub]" "onnxruntime-gpu>=1.19" pyannote.audio sounddevice numpy scipy PyAudioWPatch noisereduce 2>&1 | ForEach-Object {
    if ($_ -match "^(Downloading|Installing|Successfully)") { Write-Host "  $_" }
}

# Check if CUDA was overwritten by dependencies
$cudaCheck = & $venvPython -c "import torch; print(torch.cuda.is_available())" 2>&1
if ($cudaCheck -ne "True") {
    Write-Host "  CUDA wurde ueberschrieben. Repariere..." -ForegroundColor Yellow
    & $pipExe install torch torchaudio --index-url https://download.pytorch.org/whl/cu126 --force-reinstall 2>&1 | Out-Null
}

# --------------------------------------------------------------------------
# 7. Create config.json (if not exists)
# --------------------------------------------------------------------------
Write-Step 7 $TOTAL "Konfiguration..."

$configPath = Join-Path $InstallDir "config.json"
if (-not (Test-Path $configPath)) {
    $config = @{
        hf_token        = $HFToken
        asr_model       = "nvidia/parakeet-tdt-0.6b-v3"
        speaker_names   = @{}
        output_dir      = $InstallDir
        noise_reduction = $true
    }
    $config | ConvertTo-Json -Depth 3 | Set-Content -Path $configPath -Encoding UTF8
    Write-Host "  config.json erstellt."
} else {
    Write-Host "  config.json existiert bereits -- Einstellungen bleiben erhalten."
}

# --------------------------------------------------------------------------
# 8. Pre-download ASR model
# --------------------------------------------------------------------------
Write-Step 8 $TOTAL "Lade Parakeet ASR-Modell herunter (~640 MB)..."

& $venvPython -c "import onnx_asr; print('  Lade Parakeet TDT 0.6b v3...'); onnx_asr.load_model('nvidia/parakeet-tdt-0.6b-v3'); print('  ASR-Modell geladen - OK')" 2>&1

# --------------------------------------------------------------------------
# 9. Verify installation
# --------------------------------------------------------------------------
Write-Step 9 $TOTAL "Verifiziere Installation..."

$verifyScript = @"
import torch
print(f"  PyTorch: {torch.__version__}")
cuda = torch.cuda.is_available()
print(f"  CUDA: {cuda}")
if cuda:
    print(f"  GPU: {torch.cuda.get_device_name(0)}")
try:
    import onnx_asr
    print(f"  onnx-asr: OK")
except:
    print(f"  onnx-asr: FEHLER")
try:
    import pyannote.audio
    print(f"  pyannote: OK")
except:
    print(f"  pyannote: FEHLER")
"@

& $venvPython -c $verifyScript 2>&1

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "  Installation abgeschlossen!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Starten Sie die App ueber die Desktop-Verknuepfung"
Write-Host "  oder: $InstallDir\.venv\Scripts\pythonw.exe $InstallDir\app.py"
Write-Host ""

if (-not $HFToken) {
    Write-Host "  HINWEIS: HuggingFace-Token noch nicht konfiguriert." -ForegroundColor Yellow
    Write-Host "  Fuer Sprechererkennung den Token in der App eintragen." -ForegroundColor Yellow
}

exit 0
