; ============================================================================
;  EBA Protokoll - Inno Setup Installer v2.0.0
;  Creates a proper Windows installer with wizard UI.
;
;  To compile: Install Inno Setup 6 from https://jrsoftware.org/isinfo.php
;  then open this file in Inno Setup Compiler and click Build > Compile.
; ============================================================================

#define AppName "EBA Protokoll"
#define AppVersion "2.0.0"
#define AppPublisher "EBA"
#define AppURL "https://github.com/BhaveshY/eba-protokoll-app"
#define DefaultInstallDir "C:\EBA-Protokoll"

[Setup]
AppId={{E8A2B4F1-7C3D-4A5E-9B1F-2D6E8A3C5B7D}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppSupportURL={#AppURL}
DefaultDirName={#DefaultInstallDir}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=EBA-Protokoll-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
UninstallDisplayName={#AppName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
german.WelcomeLabel2=Dieses Programm installiert [name/ver] auf Ihrem Computer.%n%nDie Installation umfasst:%n- Python 3.12 (falls nicht vorhanden)%n- FFmpeg (falls nicht vorhanden)%n- PyTorch mit CUDA-GPU-Beschleunigung%n- Parakeet TDT Spracherkennung (ONNX Runtime)%n- Sprechererkennung (pyannote)%n%nBenoetigter Speicherplatz: ca. 5 GB%nInternetverbindung erforderlich.

[Files]
; App files
Source: "..\app.py"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\voice_profiles.py"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\requirements.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\COWORK_PLUGIN_SETUP.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
; Installer helper
Source: "install_deps.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Dirs]
Name: "{app}\aufnahmen"
Name: "{app}\transkripte"
Name: "{app}\protokolle"

[Icons]
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\.venv\Scripts\pythonw.exe"; Parameters: "app.py"; WorkingDir: "{app}"; Comment: "EBA Protokoll starten"
Name: "{group}\{#AppName}"; Filename: "{app}\.venv\Scripts\pythonw.exe"; Parameters: "app.py"; WorkingDir: "{app}"; Comment: "EBA Protokoll starten"
Name: "{group}\{#AppName} deinstallieren"; Filename: "{uninstallexe}"

[Run]
; Run the dependency installer after file copy — visible PowerShell window so user sees progress
Filename: "powershell.exe"; \
    Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""& '{tmp}\install_deps.ps1' -InstallDir '{app}'{code:GetTokenParam}; if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }"""; \
    StatusMsg: "Installiere Abhaengigkeiten (Python, FFmpeg, PyTorch, Parakeet ASR, ...) - dies dauert ca. 10-20 Minuten..."; \
    Flags: waituntilterminated runascurrentuser; \
    Description: "Abhaengigkeiten installieren"

; Offer to launch the app
Filename: "{app}\.venv\Scripts\pythonw.exe"; \
    Parameters: "app.py"; \
    WorkingDir: "{app}"; \
    Flags: nowait postinstall skipifsilent; \
    Description: "EBA Protokoll jetzt starten"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\.venv"
Type: filesandordirs; Name: "{app}\__pycache__"
Type: filesandordirs; Name: "{app}\ffmpeg"
Type: files; Name: "{app}\config.json.tmp"
Type: files; Name: "{app}\config.json.bak"
Type: files; Name: "{app}\eba_debug.log"
Type: files; Name: "{app}\eba_debug.log.1"
Type: files; Name: "{app}\eba_debug.log.2"
Type: files; Name: "{app}\speaker_profiles.json"
Type: files; Name: "{app}\speaker_profiles.tmp"

[Code]
// Custom wizard page for HuggingFace token input
var
  TokenPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  TokenPage := CreateInputQueryPage(wpSelectDir,
    'HuggingFace Token',
    'Optional: Token fuer Sprechererkennung',
    'Fuer die Sprechererkennung wird ein HuggingFace-Token benoetigt.'#13#10 +
    ''#13#10 +
    'So erhalten Sie einen Token:'#13#10 +
    '1. Konto erstellen: https://huggingface.co/join'#13#10 +
    '2. Lizenzen akzeptieren auf:'#13#10 +
    '   - huggingface.co/pyannote/speaker-diarization-3.1'#13#10 +
    '   - huggingface.co/pyannote/segmentation-3.0'#13#10 +
    '3. Token erstellen: https://huggingface.co/settings/tokens'#13#10 +
    ''#13#10 +
    'Sie koennen den Token auch spaeter in der App eintragen.');
  TokenPage.Add('HuggingFace Token (oder leer lassen):', False);
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo,
  MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := '';
  Result := Result + 'Installationsverzeichnis:' + NewLine;
  Result := Result + Space + WizardDirValue + NewLine + NewLine;

  Result := Result + 'Folgende Komponenten werden installiert:' + NewLine;
  Result := Result + Space + 'Python 3.12 (falls nicht vorhanden)' + NewLine;
  Result := Result + Space + 'FFmpeg (falls nicht vorhanden)' + NewLine;
  Result := Result + Space + 'PyTorch mit CUDA-Unterstuetzung' + NewLine;
  Result := Result + Space + 'Parakeet TDT Spracherkennung (ONNX)' + NewLine;
  Result := Result + Space + 'pyannote Sprechererkennung' + NewLine + NewLine;

  Result := Result + 'Geschaetzter Download: ca. 3-4 GB' + NewLine;
  Result := Result + 'Installationsdauer: ca. 10-20 Minuten' + NewLine;

  if TokenPage.Values[0] <> '' then
  begin
    Result := Result + NewLine + 'HuggingFace Token: konfiguriert';
  end
  else
  begin
    Result := Result + NewLine + 'HuggingFace Token: wird spaeter konfiguriert';
  end;
end;

// Pass HF token to the PowerShell installer
function GetTokenParam(Param: String): String;
begin
  if TokenPage.Values[0] <> '' then
    Result := ' -HFToken ''' + TokenPage.Values[0] + ''''
  else
    Result := '';
end;

// Check for minimum disk space (5 GB)
function InitializeSetup: Boolean;
var
  FreeMB: Cardinal;
  TotalMB: Cardinal;
begin
  Result := True;
  if GetSpaceOnDisk(ExpandConstant('{sd}'), True, FreeMB, TotalMB) then
  begin
    if FreeMB < 5120 then
    begin
      MsgBox('Nicht genuegend Speicherplatz. Mindestens 5 GB werden benoetigt.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;
