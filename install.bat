@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

:: ============================================================================
::  EBA Protokoll - Installer
::  Sitzungsaufnahme + Transkription mit WhisperX 3.8+ und pyannote-audio v4
:: ============================================================================

title EBA Protokoll - Installation

set "INSTALL_DIR=C:\EBA-Protokoll"
set "SCRIPT_DIR=%~dp0"
set "TOTAL_STEPS=10"
set "HF_TOKEN="

:: Startzeit merken
set "START_TIME=%TIME%"
for /f "tokens=1-4 delims=:., " %%a in ("%START_TIME%") do (
    set /a "START_S=(((%%a*60)+%%b)*60)+%%c"
)

echo.
echo  ============================================================
echo   EBA Protokoll - Installationsprogramm
echo  ============================================================
echo.
echo   Dieses Script installiert die EBA Protokoll-Anwendung
echo   mit WhisperX, Sprechererkennung und CUDA-Unterstuetzung.
echo.
echo   Installationsverzeichnis: %INSTALL_DIR%
echo  ============================================================
echo.

:: ============================================================================
:: [1/10] Python pruefen
:: ============================================================================
echo [1/%TOTAL_STEPS%] Pruefe Python-Installation...
echo.

where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  FEHLER: Python wurde nicht gefunden!
    echo.
    echo  Bitte installieren Sie Python 3.12 oder hoeher:
    echo    1. Besuchen Sie https://www.python.org/downloads/
    echo    2. Laden Sie Python 3.12 herunter
    echo    3. WICHTIG: Setzen Sie den Haken bei "Add Python to PATH"
    echo    4. Starten Sie dieses Script erneut
    echo.
    goto :error_exit
)

:: Python-Version pruefen
for /f "tokens=*" %%v in ('python --version 2^>^&1') do set "PYTHON_VERSION_STR=%%v"
echo   Gefunden: %PYTHON_VERSION_STR%

:: Major- und Minor-Version extrahieren
for /f "tokens=2 delims= " %%v in ("%PYTHON_VERSION_STR%") do set "PYTHON_VER=%%v"
for /f "tokens=1,2 delims=." %%a in ("%PYTHON_VER%") do (
    set "PY_MAJOR=%%a"
    set "PY_MINOR=%%b"
)

if !PY_MAJOR! lss 3 (
    echo  FEHLER: Python !PY_MAJOR!.!PY_MINOR! ist zu alt.
    echo  pyannote-audio v4 und WhisperX 3.8+ erfordern Python 3.10 oder hoeher.
    echo  Bitte installieren Sie Python 3.12: https://www.python.org/downloads/
    echo.
    goto :error_exit
)
if !PY_MAJOR! equ 3 if !PY_MINOR! lss 10 (
    echo  FEHLER: Python !PY_MAJOR!.!PY_MINOR! ist zu alt.
    echo  pyannote-audio v4 und WhisperX 3.8+ erfordern Python 3.10 oder hoeher.
    echo  Bitte installieren Sie Python 3.12: https://www.python.org/downloads/
    echo.
    goto :error_exit
)

echo   Python !PY_MAJOR!.!PY_MINOR! - OK
echo.

:: ============================================================================
:: [2/10] Verzeichnisse erstellen
:: ============================================================================
echo [2/%TOTAL_STEPS%] Erstelle Verzeichnisse...
echo.

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%INSTALL_DIR%\aufnahmen" mkdir "%INSTALL_DIR%\aufnahmen"
if not exist "%INSTALL_DIR%\transkripte" mkdir "%INSTALL_DIR%\transkripte"
if not exist "%INSTALL_DIR%\protokolle" mkdir "%INSTALL_DIR%\protokolle"

echo   %INSTALL_DIR%               - OK
echo   %INSTALL_DIR%\aufnahmen     - OK
echo   %INSTALL_DIR%\transkripte   - OK
echo   %INSTALL_DIR%\protokolle    - OK

:: App-Dateien kopieren
if exist "%SCRIPT_DIR%app.py" (
    copy /Y "%SCRIPT_DIR%app.py" "%INSTALL_DIR%\app.py" >nul
    echo   app.py kopiert                - OK
) else (
    echo   WARNUNG: app.py nicht im Installationsordner gefunden.
    echo   Bitte kopieren Sie app.py manuell nach %INSTALL_DIR%
)

if exist "%SCRIPT_DIR%requirements.txt" (
    copy /Y "%SCRIPT_DIR%requirements.txt" "%INSTALL_DIR%\requirements.txt" >nul
    echo   requirements.txt kopiert      - OK
) else (
    echo   WARNUNG: requirements.txt nicht im Installationsordner gefunden.
)

echo.

:: ============================================================================
:: [3/10] Python Virtual Environment erstellen
:: ============================================================================
echo [3/%TOTAL_STEPS%] Erstelle Python Virtual Environment...
echo.

cd /d "%INSTALL_DIR%"

if not exist ".venv" (
    python -m venv .venv
) else (
    echo   Vorhandenes venv gefunden - wird wiederverwendet.
)
if %ERRORLEVEL% neq 0 (
    echo  FEHLER: Virtual Environment konnte nicht erstellt werden!
    echo  Stellen Sie sicher, dass Python korrekt installiert ist.
    echo.
    goto :error_exit
)

call .venv\Scripts\activate.bat
if %ERRORLEVEL% neq 0 (
    echo  FEHLER: Virtual Environment konnte nicht aktiviert werden!
    echo.
    goto :error_exit
)

:: pip aktualisieren
echo   Aktualisiere pip...
python -m pip install --upgrade pip >nul 2>&1

echo   Virtual Environment erstellt und aktiviert - OK
echo.

:: ============================================================================
:: [4/10] FFmpeg pruefen
:: ============================================================================
echo [4/%TOTAL_STEPS%] Pruefe FFmpeg...
echo.

where ffmpeg >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   FFmpeg nicht gefunden. Versuche Installation via winget...
    echo.
    winget install Gyan.FFmpeg --accept-package-agreements --accept-source-agreements >nul 2>&1

    :: PATH aktualisieren und erneut pruefen
    where ffmpeg >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo  ============================================================
        echo   FFmpeg ist nicht installiert!
        echo  ============================================================
        echo.
        echo   Die automatische Installation war nicht erfolgreich.
        echo   Bitte installieren Sie FFmpeg manuell:
        echo.
        echo     1. Besuchen Sie https://www.gyan.dev/ffmpeg/builds/
        echo     2. Laden Sie "ffmpeg-release-essentials.zip" herunter
        echo     3. Entpacken Sie den Ordner nach C:\ffmpeg
        echo     4. Fuegen Sie C:\ffmpeg\bin zu Ihren Umgebungsvariablen (PATH) hinzu
        echo     5. Starten Sie dieses Script erneut
        echo.
        echo   Alternativ in einer Administrator-Eingabeaufforderung:
        echo     winget install Gyan.FFmpeg
        echo  ============================================================
        echo.
        goto :error_exit
    ) else (
        echo   FFmpeg via winget installiert - OK
    )
) else (
    for /f "tokens=*" %%v in ('ffmpeg -version 2^>^&1') do (
        echo   %%v
        goto :ffmpeg_done
    )
    :ffmpeg_done
    echo   FFmpeg gefunden - OK
)
echo.

:: ============================================================================
:: [5/10] PyTorch mit CUDA installieren (KRITISCH - VOR whisperx!)
:: ============================================================================
echo [5/%TOTAL_STEPS%] Installiere PyTorch mit CUDA-Unterstuetzung...
echo.
echo   WICHTIG: PyTorch wird VOR WhisperX installiert, um CUDA-Unterstuetzung
echo   sicherzustellen. (Bekanntes Problem: pyannote #1675)
echo.
echo   Dies kann einige Minuten dauern...
echo.

pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126
if %ERRORLEVEL% neq 0 (
    echo.
    echo  FEHLER: PyTorch-Installation fehlgeschlagen!
    echo.
    echo  Moegliche Ursachen:
    echo    - Keine Internetverbindung
    echo    - Firewall blockiert den Download
    echo    - Nicht genuegend Speicherplatz
    echo.
    echo  Bitte pruefen Sie die Fehlermeldung oben und versuchen Sie es erneut.
    echo.
    goto :error_exit
)

echo.
echo   PyTorch mit CUDA installiert - OK
echo.

:: ============================================================================
:: [6/10] WhisperX und weitere Abhaengigkeiten installieren
:: ============================================================================
echo [6/%TOTAL_STEPS%] Installiere WhisperX und Abhaengigkeiten...
echo.
echo   whisperx installiert automatisch: faster-whisper, pyannote-audio v4, etc.
echo   Dies kann einige Minuten dauern...
echo.

:: --no-build-isolation verhindert, dass pip torch durch eine CPU-Version ersetzt
pip install whisperx sounddevice numpy PyAudioWPatch

:: Sicherheitscheck: CUDA darf nicht durch whisperx-Abhaengigkeiten entfernt worden sein
python -c "import torch; assert torch.cuda.is_available(), 'CUDA lost'" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   WARNUNG: CUDA wurde durch Abhaengigkeiten ueberschrieben. Repariere...
    pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126 --force-reinstall >nul 2>&1
)
if %ERRORLEVEL% neq 0 (
    echo.
    echo  FEHLER: Installation der Abhaengigkeiten fehlgeschlagen!
    echo.
    echo  Moegliche Ursachen:
    echo    - Keine Internetverbindung
    echo    - Kompilierungsfehler (Microsoft Visual C++ Build Tools erforderlich?)
    echo      Download: https://visualstudio.microsoft.com/visual-cpp-build-tools/
    echo.
    goto :error_exit
)

echo.
echo   WhisperX und Abhaengigkeiten installiert - OK
echo.

:: ============================================================================
:: [7/10] CUDA-Unterstuetzung pruefen
:: ============================================================================
echo [7/%TOTAL_STEPS%] Pruefe CUDA-Unterstuetzung...
echo.

python -c "import torch; cuda=torch.cuda.is_available(); print(f'  CUDA verfuegbar: {cuda}'); print(f'  GPU: {torch.cuda.get_device_name(0) if cuda else \"Keine GPU erkannt\"}'); print(f'  PyTorch Version: {torch.__version__}')"

python -c "import torch; exit(0 if torch.cuda.is_available() else 1)"
if %ERRORLEVEL% neq 0 (
    echo.
    echo  ============================================================
    echo   WARNUNG: CUDA ist NICHT verfuegbar!
    echo  ============================================================
    echo.
    echo   Die Transkription funktioniert trotzdem, aber DEUTLICH langsamer.
    echo.
    echo   Fuer GPU-Beschleunigung benoetigen Sie:
    echo     - Eine NVIDIA-Grafikkarte (GTX 1060 oder besser)
    echo     - Aktuelle NVIDIA-Treiber: https://www.nvidia.de/Download/index.aspx
    echo     - CUDA Toolkit 12.6: https://developer.nvidia.com/cuda-downloads
    echo.
) else (
    echo.
    echo   CUDA-Unterstuetzung bestaetigt - OK
)
echo.

:: ============================================================================
:: [8/10] HuggingFace-Token einrichten
:: ============================================================================
echo [8/%TOTAL_STEPS%] HuggingFace-Token fuer Sprechererkennung...
echo.
echo  ============================================================
echo   Fuer Sprechererkennung benoetigen Sie einen HuggingFace-Token.
echo  ============================================================
echo.
echo   So erhalten Sie einen Token:
echo.
echo   1. Erstellen Sie ein kostenloses Konto:
echo      https://huggingface.co/join
echo.
echo   2. Akzeptieren Sie die Lizenzen auf BEIDEN Seiten:
echo      - https://huggingface.co/pyannote/speaker-diarization-community-1
echo      - https://huggingface.co/pyannote/segmentation-3.0
echo.
echo   3. Erstellen Sie einen Token:
echo      https://huggingface.co/settings/tokens
echo.
echo  ============================================================
echo.

set /p "HF_TOKEN=  HuggingFace-Token eingeben (oder Enter zum Ueberspringen): "

:: config.json erstellen (Schluessel muessen mit app.py uebereinstimmen)
echo {> "%INSTALL_DIR%\config.json"
echo   "hf_token": "!HF_TOKEN!",>> "%INSTALL_DIR%\config.json"
echo   "whisper_model": "small",>> "%INSTALL_DIR%\config.json"
echo   "language": "de",>> "%INSTALL_DIR%\config.json"
echo   "speaker_names": {},>> "%INSTALL_DIR%\config.json"
echo   "output_dir": "C:\\EBA-Protokoll">> "%INSTALL_DIR%\config.json"
echo }>> "%INSTALL_DIR%\config.json"

if not "!HF_TOKEN!"=="" (
    echo.
    echo   Token gespeichert in config.json - OK
) else (
    echo.
    echo   Kein Token eingegeben - Sprechererkennung wird spaeter konfiguriert.
    echo   Sie koennen den Token spaeter in den Einstellungen der App eintragen.
)
echo.

:: ============================================================================
:: [9/10] Modelle herunterladen
:: ============================================================================
echo [9/%TOTAL_STEPS%] Lade Whisper-Modell herunter (small, deutsch)...
echo.
echo   Der erste Download kann einige Minuten dauern...
echo.

python -c "import whisperx; print('  Lade Whisper \"small\" Modell...'); whisperx.load_model('small', 'cpu', language='de', compute_type='float32'); print('  Whisper-Modell geladen - OK')"
if %ERRORLEVEL% neq 0 (
    echo.
    echo  WARNUNG: Whisper-Modell konnte nicht heruntergeladen werden.
    echo  Das Modell wird beim ersten Start der Anwendung geladen.
    echo.
) else (
    echo.
)

if not "!HF_TOKEN!"=="" (
    echo   Teste Sprechererkennungs-Modell...
    echo.
    python -c "from whisperx.diarize import DiarizationPipeline; print('  Lade Diarization-Pipeline...'); DiarizationPipeline(token='!HF_TOKEN!', device='cpu'); print('  Sprechererkennungs-Modell geladen - OK')"
    if !ERRORLEVEL! neq 0 (
        echo.
        echo  WARNUNG: Sprechererkennungs-Modell konnte nicht geladen werden.
        echo  Bitte pruefen Sie:
        echo    - Ist der HuggingFace-Token korrekt?
        echo    - Haben Sie die Lizenzen auf HuggingFace akzeptiert?
        echo.
    ) else (
        echo.
    )
)

:: ============================================================================
:: [10/10] Desktop-Verknuepfung erstellen
:: ============================================================================
echo [10/%TOTAL_STEPS%] Erstelle Desktop-Verknuepfung...
echo.

set "DESKTOP=%USERPROFILE%\Desktop"

(
    echo @echo off
    echo cd /d C:\EBA-Protokoll
    echo .venv\Scripts\pythonw.exe app.py
) > "%DESKTOP%\EBA Protokoll.bat"

if exist "%DESKTOP%\EBA Protokoll.bat" (
    echo   Desktop-Verknuepfung erstellt - OK
    echo   Pfad: %DESKTOP%\EBA Protokoll.bat
) else (
    echo  WARNUNG: Desktop-Verknuepfung konnte nicht erstellt werden.
    echo  Bitte erstellen Sie manuell eine Verknuepfung zu:
    echo    %INSTALL_DIR%\app.py
)
echo.

:: ============================================================================
:: Abschluss
:: ============================================================================

:: Installationsdauer berechnen
set "END_TIME=%TIME%"
for /f "tokens=1-4 delims=:., " %%a in ("%END_TIME%") do (
    set /a "END_S=(((%%a*60)+%%b)*60)+%%c"
)
set /a "DURATION=END_S-START_S"
if !DURATION! lss 0 set /a "DURATION+=86400"
set /a "MINS=DURATION/60"
set /a "SECS=DURATION%%60"

echo  ============================================================
echo   Installation abgeschlossen!
echo  ============================================================
echo.
echo   Installationsverzeichnis: %INSTALL_DIR%
echo   Installationsdauer:       !MINS! Minuten, !SECS! Sekunden
echo.
echo   Starten Sie die Anwendung ueber:
echo     - Desktop-Verknuepfung "EBA Protokoll"
echo     - Oder: %INSTALL_DIR%\.venv\Scripts\pythonw.exe %INSTALL_DIR%\app.py
echo.
if "!HF_TOKEN!"=="" (
    echo   HINWEIS: Sprechererkennung ist noch nicht konfiguriert.
    echo   Tragen Sie Ihren HuggingFace-Token in config.json ein.
    echo.
)
echo  ============================================================
echo.

goto :end

:error_exit
echo.
echo  ============================================================
echo   Installation abgebrochen.
echo   Bitte beheben Sie den Fehler und starten Sie erneut.
echo  ============================================================
echo.

:end
endlocal
pause
