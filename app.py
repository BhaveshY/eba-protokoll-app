"""
EBA Protokoll App
==================
Windows 11 tkinter application for recording virtual meetings with
speaker diarization. Records mic + system audio (WASAPI loopback)
as separate tracks, then transcribes and diarizes using WhisperX.

Requires:
    pip install whisperx torch torchaudio sounddevice PyAudioWPatch numpy

Target hardware: Ryzen CPU + NVIDIA GTX GPU (Windows 11)
"""

import json
import os
import time
import wave
import struct
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------------

APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = APP_DIR / "config.json"

DEFAULT_CONFIG = {
    "hf_token": "",
    "whisper_model": "small",
    "language": "de",
    "speaker_names": {},
    "output_dir": r"C:\EBA-Protokoll",
}


def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
            merged = {**DEFAULT_CONFIG, **saved}
            return merged
        except Exception:
            pass
    return dict(DEFAULT_CONFIG)


def save_config(cfg: dict) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


def ensure_directories(base: str) -> None:
    for sub in ("aufnahmen", "transkripte", "protokolle"):
        os.makedirs(os.path.join(base, sub), exist_ok=True)


# ---------------------------------------------------------------------------
# Audio recording helpers
# ---------------------------------------------------------------------------

MIC_SAMPLERATE = 16000
MIC_CHANNELS = 1


class MicRecorder:
    """Records from the default microphone using sounddevice."""

    def __init__(self, filepath: str, samplerate: int = MIC_SAMPLERATE):
        self.filepath = filepath
        self.samplerate = samplerate
        self._frames: list[bytes] = []
        self._running = False
        self._stream = None

    def start(self) -> None:
        import sounddevice as sd

        self._frames = []
        self._running = True
        self._stream = sd.InputStream(
            samplerate=self.samplerate,
            channels=MIC_CHANNELS,
            dtype="int16",
            callback=self._callback,
        )
        self._stream.start()

    def _callback(self, indata, frames, time_info, status):
        if self._running:
            self._frames.append(indata.copy().tobytes())

    def stop(self) -> None:
        self._running = False
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        self._save()

    def _save(self) -> None:
        with wave.open(self.filepath, "wb") as wf:
            wf.setnchannels(MIC_CHANNELS)
            wf.setsampwidth(2)  # int16
            wf.setframerate(self.samplerate)
            wf.writeframes(b"".join(self._frames))


class SystemAudioRecorder:
    """Records system / loopback audio via PyAudioWPatch WASAPI loopback."""

    def __init__(self, filepath: str):
        self.filepath = filepath
        self._running = False
        self._frames: list[bytes] = []
        self._p = None
        self._stream = None
        self.samplerate = 16000
        self.channels = 1
        self.available = False
        self.error_message = ""

    def start(self) -> None:
        try:
            import pyaudiowpatch as pyaudio

            self._p = pyaudio.PyAudio()

            # Find the default WASAPI loopback device
            wasapi_info = None
            for i in range(self._p.get_host_api_count()):
                api = self._p.get_host_api_info_by_index(i)
                if api.get("name", "").lower().find("wasapi") != -1:
                    wasapi_info = api
                    break

            if wasapi_info is None:
                self.error_message = "WASAPI nicht verfuegbar."
                self._cleanup()
                return

            # Find the default loopback device
            loopback_device = None
            default_output_idx = wasapi_info.get("defaultOutputDevice", -1)
            default_output_name = ""
            if default_output_idx >= 0:
                try:
                    default_output_name = self._p.get_device_info_by_index(default_output_idx).get("name", "").split(" (")[0]
                except Exception:
                    pass

            for i in range(self._p.get_device_count()):
                dev = self._p.get_device_info_by_index(i)
                if dev.get("isLoopbackDevice", False):
                    if default_output_name and dev.get("name", "").find(default_output_name) != -1:
                        loopback_device = dev
                        break
                    if loopback_device is None:
                        loopback_device = dev

            if loopback_device is None:
                self.error_message = "Kein Loopback-Geraet gefunden."
                self._cleanup()
                return

            self.samplerate = int(loopback_device["defaultSampleRate"])
            self.channels = int(loopback_device["maxInputChannels"])
            if self.channels < 1:
                self.channels = 2

            self._frames = []
            self._running = True
            self.available = True

            self._stream = self._p.open(
                format=pyaudio.paInt16,
                channels=self.channels,
                rate=self.samplerate,
                input=True,
                input_device_index=int(loopback_device["index"]),
                frames_per_buffer=1024,
                stream_callback=self._callback,
            )
            self._stream.start_stream()

        except ImportError:
            self.error_message = "PyAudioWPatch nicht installiert."
            self._cleanup()
        except Exception as exc:
            self.error_message = f"System-Audio Fehler: {exc}"
            self._cleanup()

    def _callback(self, in_data, frame_count, time_info, status):
        if self._running:
            self._frames.append(in_data)
        return (None, 0)  # 0 == paContinue

    def stop(self) -> None:
        self._running = False
        if self._stream is not None:
            try:
                self._stream.stop_stream()
                self._stream.close()
            except Exception:
                pass
            self._stream = None
        self._save()
        self._cleanup()

    def _cleanup(self) -> None:
        if self._p is not None:
            try:
                self._p.terminate()
            except Exception:
                pass
            self._p = None

    def _save(self) -> None:
        if not self._frames:
            return
        with wave.open(self.filepath, "wb") as wf:
            wf.setnchannels(self.channels)
            wf.setsampwidth(2)
            wf.setframerate(self.samplerate)
            wf.writeframes(b"".join(self._frames))

    def has_audio_content(self) -> bool:
        """Check whether the recorded file actually contains audible content."""
        if not os.path.exists(self.filepath):
            return False
        try:
            with wave.open(self.filepath, "rb") as wf:
                n_frames = wf.getnframes()
                if n_frames == 0:
                    return False
                # Read up to 5 seconds to check for silence
                check_frames = min(n_frames, wf.getframerate() * 5)
                raw = wf.readframes(check_frames)
                n_channels = wf.getnchannels()

            samples = struct.unpack(f"<{len(raw) // 2}h", raw)
            # RMS energy
            rms = (sum(s * s for s in samples) / len(samples)) ** 0.5
            return rms > 50  # threshold above noise floor
        except Exception:
            return False


# ---------------------------------------------------------------------------
# Transcription + Diarization
# ---------------------------------------------------------------------------


def get_gpu_info() -> dict:
    info = {"cuda_available": False, "gpu_name": "Keine GPU erkannt", "vram_mb": 0}
    try:
        import torch
        if torch.cuda.is_available():
            info["cuda_available"] = True
            info["gpu_name"] = torch.cuda.get_device_name(0)
            info["vram_mb"] = int(torch.cuda.get_device_properties(0).total_memory / 1024 / 1024)
    except ImportError:
        pass
    return info


def _load_audio_safe(filepath: str):
    """Load audio as numpy array, with torchaudio fallback for Windows TorchCodec DLL issues."""
    import whisperx
    try:
        return whisperx.load_audio(filepath)
    except Exception:
        import torchaudio
        waveform, sample_rate = torchaudio.load(filepath)
        if sample_rate != 16000:
            waveform = torchaudio.functional.resample(waveform, sample_rate, 16000)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        return waveform.squeeze().numpy()


def _extract_segments(result: dict, speaker_label: str = None) -> list[dict]:
    """Extract segment dicts from whisperx result. If speaker_label is set, override all speakers."""
    return [
        {
            "start": seg.get("start", 0.0),
            "end": seg.get("end", 0.0),
            "speaker": speaker_label or seg.get("speaker", "Unbekannt"),
            "text": seg.get("text", "").strip(),
        }
        for seg in result.get("segments", [])
        if seg.get("text", "").strip()
    ]


def transcribe_and_diarize(
    mic_path: str,
    system_path: str,
    whisper_model_name: str,
    language: str,
    hf_token: str,
    progress_callback=None,
) -> list[dict]:
    """Transcribe mic + system tracks using shared models. Returns merged, sorted segments."""
    import whisperx
    import torch
    from whisperx.diarize import DiarizationPipeline, assign_word_speakers

    def status(msg):
        if progress_callback:
            progress_callback(msg)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "int8" if device == "cuda" else "float32"

    # Load models once, reuse for both tracks
    status("Lade Whisper-Modell...")
    model = whisperx.load_model(whisper_model_name, device, language=language, compute_type=compute_type)

    status("Lade Alignment-Modell...")
    align_model, align_metadata = whisperx.load_align_model(language_code=language, device=device)

    all_segments = []

    # --- Mic track (all segments = "Ich") ---
    if mic_path and os.path.exists(mic_path):
        status("Transkribiere Mikrofon...")
        mic_audio = _load_audio_safe(mic_path)
        mic_result = model.transcribe(mic_audio, batch_size=16)

        if mic_result["segments"]:
            status("Zeitstempel-Ausrichtung (Mikrofon)...")
            mic_result = whisperx.align(mic_result["segments"], align_model, align_metadata, mic_audio, device)
            all_segments.extend(_extract_segments(mic_result, speaker_label="Ich"))

    # --- System track (needs diarization) ---
    if system_path and os.path.exists(system_path):
        status("Transkribiere System-Audio...")
        sys_audio = _load_audio_safe(system_path)
        sys_result = model.transcribe(sys_audio, batch_size=16)

        if sys_result["segments"]:
            status("Zeitstempel-Ausrichtung (System)...")
            sys_result = whisperx.align(sys_result["segments"], align_model, align_metadata, sys_audio, device)

            # Free whisper + alignment models before loading diarization (saves ~2GB VRAM)
            del model, align_model, align_metadata
            import gc; gc.collect()
            if device == "cuda":
                torch.cuda.empty_cache()

            status("Sprechererkennung (Diarisierung)...")
            diarize_pipeline = DiarizationPipeline(token=hf_token, device=device)

            try:
                diarize_segments = diarize_pipeline(sys_audio, min_speakers=1, max_speakers=10)
            except (OSError, RuntimeError, ImportError, AttributeError):
                # TorchCodec DLL issue — fall back to file path input
                diarize_segments = diarize_pipeline(system_path, min_speakers=1, max_speakers=10)

            sys_result = assign_word_speakers(diarize_segments, sys_result)
            all_segments.extend(_extract_segments(sys_result))

    all_segments.sort(key=lambda s: s["start"])
    return all_segments


def format_timestamp(seconds: float) -> str:
    total = int(seconds)
    return f"{total // 3600:02d}:{(total % 3600) // 60:02d}:{total % 60:02d}"


def format_transcript(segments: list[dict], speaker_names: dict) -> str:
    return "\n".join(
        f"[{format_timestamp(seg['start'])}] {speaker_names.get(seg['speaker'], seg['speaker'])}: {seg['text']}"
        for seg in segments if seg["text"]
    )


# ---------------------------------------------------------------------------
# Speaker Renaming Dialog
# ---------------------------------------------------------------------------


class SpeakerRenameDialog(tk.Toplevel):
    """Modal dialog that lets the user assign real names to detected speakers."""

    def __init__(self, parent, segments: list[dict], existing_names: dict):
        super().__init__(parent)
        self.title("Sprecher zuordnen")
        self.geometry("520x420")
        self.resizable(True, True)
        self.transient(parent)
        self.grab_set()

        self.result: dict = dict(existing_names)
        self._entries: dict[str, tk.StringVar] = {}

        # Collect unique speakers (exclude "Ich")
        speaker_quotes: dict[str, str] = {}
        for seg in segments:
            sp = seg["speaker"]
            if sp == "Ich":
                continue
            if sp not in speaker_quotes and seg["text"]:
                quote = seg["text"][:120]
                if len(seg["text"]) > 120:
                    quote += "..."
                speaker_quotes[sp] = quote

        if not speaker_quotes:
            lbl = ttk.Label(
                self,
                text="Keine weiteren Sprecher erkannt.",
                font=("Segoe UI", 11),
            )
            lbl.pack(pady=30)
            ttk.Button(self, text="Schliessen", command=self._on_ok).pack(pady=10)
            return

        ttk.Label(
            self,
            text="Erkannte Sprecher umbenennen:",
            font=("Segoe UI", 12, "bold"),
        ).pack(padx=10, pady=(12, 4), anchor="w")

        container = ttk.Frame(self)
        container.pack(fill="both", expand=True, padx=10, pady=5)

        canvas = tk.Canvas(container, highlightthickness=0)
        scrollbar = ttk.Scrollbar(container, orient="vertical", command=canvas.yview)
        scroll_frame = ttk.Frame(canvas)

        scroll_frame.bind(
            "<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )
        canvas.create_window((0, 0), window=scroll_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        for speaker_id, quote in speaker_quotes.items():
            frame = ttk.LabelFrame(scroll_frame, text=speaker_id, padding=6)
            frame.pack(fill="x", padx=4, pady=4)

            ttk.Label(
                frame,
                text=f'"{quote}"',
                wraplength=440,
                foreground="gray",
                font=("Segoe UI", 9, "italic"),
            ).pack(anchor="w")

            var = tk.StringVar(value=existing_names.get(speaker_id, ""))
            entry = ttk.Entry(frame, textvariable=var, width=40)
            entry.pack(anchor="w", pady=(4, 0))
            self._entries[speaker_id] = var

        btn_frame = ttk.Frame(self)
        btn_frame.pack(fill="x", padx=10, pady=10)
        ttk.Button(btn_frame, text="Uebernehmen", command=self._on_ok).pack(
            side="right", padx=4
        )
        ttk.Button(btn_frame, text="Abbrechen", command=self.destroy).pack(
            side="right", padx=4
        )

    def _on_ok(self) -> None:
        for speaker_id, var in self._entries.items():
            name = var.get().strip()
            if name:
                self.result[speaker_id] = name
        self.destroy()


# ---------------------------------------------------------------------------
# Main Application
# ---------------------------------------------------------------------------


class EBAProtokollApp(tk.Tk):
    def __init__(self):
        super().__init__()

        self.title("EBA Protokoll")
        self.geometry("600x700")
        self.minsize(500, 550)

        self.config_data = load_config()
        ensure_directories(self.config_data["output_dir"])

        # State
        self._recording = False
        self._mic_recorder: MicRecorder | None = None
        self._sys_recorder: SystemAudioRecorder | None = None
        self._record_start: float = 0.0
        self._timer_id: str | None = None
        self._last_mic_path: str = ""
        self._last_sys_path: str = ""

        # Style
        style = ttk.Style(self)
        try:
            style.theme_use("vista")
        except Exception:
            try:
                style.theme_use("clam")
            except Exception:
                pass

        # Notebook (tabs)
        self._notebook = ttk.Notebook(self)
        self._notebook.pack(fill="both", expand=True, padx=6, pady=(6, 0))

        self._build_recording_tab()
        self._build_settings_tab()

        # Status bar
        self._statusbar = ttk.Label(
            self, text="Bereit", relief="sunken", anchor="w", padding=(6, 2)
        )
        self._statusbar.pack(fill="x", side="bottom", padx=6, pady=(0, 6))

        self._update_gpu_status()

        # Persist config on close
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # ------------------------------------------------------------------
    # Recording Tab
    # ------------------------------------------------------------------
    def _build_recording_tab(self) -> None:
        tab = ttk.Frame(self._notebook, padding=10)
        self._notebook.add(tab, text="  Aufnahme  ")

        # Project name
        proj_frame = ttk.LabelFrame(tab, text="Projektname", padding=6)
        proj_frame.pack(fill="x", pady=(0, 8))

        default_name = f"Besprechung_{datetime.now():%Y-%m-%d}"
        self._project_var = tk.StringVar(value=default_name)
        ttk.Entry(proj_frame, textvariable=self._project_var, width=50).pack(
            fill="x"
        )

        # Timer
        self._timer_var = tk.StringVar(value="00:00:00")
        timer_label = ttk.Label(
            tab, textvariable=self._timer_var, font=("Consolas", 28), anchor="center"
        )
        timer_label.pack(pady=(4, 8))

        # Buttons
        btn_frame = ttk.Frame(tab)
        btn_frame.pack(fill="x", pady=4)

        self._record_btn = tk.Button(
            btn_frame,
            text="AUFNAHME STARTEN",
            bg="#d9534f",
            fg="white",
            activebackground="#c9302c",
            activeforeground="white",
            font=("Segoe UI", 13, "bold"),
            relief="raised",
            bd=2,
            cursor="hand2",
            command=self._toggle_recording,
        )
        self._record_btn.pack(fill="x", ipady=10, pady=4)

        row2 = ttk.Frame(tab)
        row2.pack(fill="x", pady=4)

        self._transcribe_btn = ttk.Button(
            row2, text="TRANSKRIBIEREN", state="disabled", command=self._start_transcription
        )
        self._transcribe_btn.pack(side="left", expand=True, fill="x", padx=(0, 4))

        self._import_btn = ttk.Button(
            row2, text="DATEI IMPORTIEREN", command=self._import_file
        )
        self._import_btn.pack(side="left", expand=True, fill="x", padx=(4, 0))

        # Progress
        self._progress_var = tk.DoubleVar(value=0)
        self._progress = ttk.Progressbar(
            tab, variable=self._progress_var, mode="indeterminate", length=400
        )
        self._progress.pack(fill="x", pady=(10, 4))

        self._status_var = tk.StringVar(value="")
        ttk.Label(tab, textvariable=self._status_var, wraplength=560).pack(
            anchor="w", pady=2
        )

        # Last file
        self._lastfile_var = tk.StringVar(value="")
        ttk.Label(tab, textvariable=self._lastfile_var, foreground="gray", wraplength=560).pack(
            anchor="w", pady=(8, 0)
        )

    # ------------------------------------------------------------------
    # Settings Tab
    # ------------------------------------------------------------------
    def _build_settings_tab(self) -> None:
        tab = ttk.Frame(self._notebook, padding=10)
        self._notebook.add(tab, text="  Einstellungen  ")

        # HuggingFace token
        token_frame = ttk.LabelFrame(tab, text="HuggingFace Token (fuer Diarisierung)", padding=6)
        token_frame.pack(fill="x", pady=(0, 8))

        self._token_var = tk.StringVar(value=self.config_data.get("hf_token", ""))
        ttk.Entry(token_frame, textvariable=self._token_var, show="*", width=55).pack(
            fill="x"
        )

        # Whisper model
        model_frame = ttk.LabelFrame(tab, text="Whisper Modell", padding=6)
        model_frame.pack(fill="x", pady=(0, 8))

        self._model_var = tk.StringVar(
            value=self.config_data.get("whisper_model", "small")
        )
        models = ["tiny", "base", "small", "medium", "large"]
        combo = ttk.Combobox(
            model_frame, textvariable=self._model_var, values=models, state="readonly"
        )
        combo.pack(fill="x")

        # Language
        lang_frame = ttk.LabelFrame(tab, text="Sprache", padding=6)
        lang_frame.pack(fill="x", pady=(0, 8))

        self._lang_var = tk.StringVar(value=self.config_data.get("language", "de"))
        langs = [
            ("Deutsch", "de"),
            ("Englisch", "en"),
            ("Franzoesisch", "fr"),
            ("Spanisch", "es"),
            ("Italienisch", "it"),
        ]
        lang_combo = ttk.Combobox(
            lang_frame,
            textvariable=self._lang_var,
            values=[f"{name} ({code})" for name, code in langs],
            state="readonly",
        )
        lang_combo.pack(fill="x")
        # Map display string back to code on selection
        lang_combo.bind("<<ComboboxSelected>>", lambda e: self._update_lang_code(lang_combo, langs))
        # Set initial display
        for name, code in langs:
            if code == self._lang_var.get():
                lang_combo.set(f"{name} ({code})")
                break

        # Output directory
        dir_frame = ttk.LabelFrame(tab, text="Ausgabe-Verzeichnis", padding=6)
        dir_frame.pack(fill="x", pady=(0, 8))

        dir_row = ttk.Frame(dir_frame)
        dir_row.pack(fill="x")

        self._dir_var = tk.StringVar(value=self.config_data.get("output_dir", DEFAULT_CONFIG["output_dir"]))
        ttk.Entry(dir_row, textvariable=self._dir_var, width=45).pack(
            side="left", fill="x", expand=True
        )
        ttk.Button(dir_row, text="...", width=4, command=self._browse_dir).pack(
            side="left", padx=(4, 0)
        )

        # GPU info
        gpu_frame = ttk.LabelFrame(tab, text="GPU Status", padding=6)
        gpu_frame.pack(fill="x", pady=(0, 8))

        self._gpu_info_var = tk.StringVar(value="Pruefe GPU...")
        ttk.Label(gpu_frame, textvariable=self._gpu_info_var, wraplength=520).pack(
            anchor="w"
        )

        # Save button
        ttk.Button(tab, text="Einstellungen speichern", command=self._save_settings).pack(
            pady=10
        )

    # ------------------------------------------------------------------
    # Settings helpers
    # ------------------------------------------------------------------
    def _update_lang_code(self, combo, langs):
        sel = combo.get()
        for name, code in langs:
            if f"{name} ({code})" == sel:
                self._lang_var.set(code)
                break

    def _browse_dir(self) -> None:
        d = filedialog.askdirectory(initialdir=self._dir_var.get())
        if d:
            self._dir_var.set(d)

    def _save_settings(self) -> None:
        self.config_data["hf_token"] = self._token_var.get().strip()
        self.config_data["whisper_model"] = self._model_var.get()
        self.config_data["language"] = self._lang_var.get()
        self.config_data["output_dir"] = self._dir_var.get().strip()
        save_config(self.config_data)
        ensure_directories(self.config_data["output_dir"])
        messagebox.showinfo("Gespeichert", "Einstellungen wurden gespeichert.")

    def _update_gpu_status(self) -> None:
        info = get_gpu_info()
        if info["cuda_available"]:
            text = f"CUDA verfuegbar  |  {info['gpu_name']}  |  {info['vram_mb']} MB VRAM"
        else:
            text = "Keine CUDA-GPU erkannt. CPU-Modus wird verwendet (langsamer)."
        self._gpu_info_var.set(text)
        self._statusbar.config(text=text)

    # ------------------------------------------------------------------
    # Recording
    # ------------------------------------------------------------------
    def _toggle_recording(self) -> None:
        if not self._recording:
            self._start_recording()
        else:
            self._stop_recording()

    def _start_recording(self) -> None:
        project = self._project_var.get().strip()
        if not project:
            project = f"Besprechung_{datetime.now():%Y-%m-%d}"
            self._project_var.set(project)

        base_dir = self._dir_var.get().strip() or DEFAULT_CONFIG["output_dir"]
        ensure_directories(base_dir)
        aufnahmen = os.path.join(base_dir, "aufnahmen")

        timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        safe_project = "".join(
            c if (c.isalnum() or c in "-_ ") else "_" for c in project
        )
        self._last_mic_path = os.path.join(
            aufnahmen, f"{safe_project}_{timestamp}_mic.wav"
        )
        self._last_sys_path = os.path.join(
            aufnahmen, f"{safe_project}_{timestamp}_system.wav"
        )

        # Start mic recorder
        try:
            self._mic_recorder = MicRecorder(self._last_mic_path)
            self._mic_recorder.start()
        except Exception as exc:
            messagebox.showerror(
                "Mikrofon-Fehler",
                f"Mikrofon konnte nicht gestartet werden:\n{exc}",
            )
            return

        # Start system audio recorder
        self._sys_recorder = SystemAudioRecorder(self._last_sys_path)
        self._sys_recorder.start()

        if not self._sys_recorder.available:
            self._status_var.set(
                f"Hinweis: Nur Mikrofon aktiv. {self._sys_recorder.error_message}"
            )
        else:
            self._status_var.set("Aufnahme laeuft... (Mikrofon + System-Audio)")

        self._recording = True
        self._record_start = time.time()
        self._record_btn.config(text="STOPPEN", bg="#5bc0de")
        self._transcribe_btn.config(state="disabled")
        self._import_btn.config(state="disabled")
        self._update_timer()

    def _stop_recording(self) -> None:
        self._recording = False
        if self._timer_id:
            self.after_cancel(self._timer_id)
            self._timer_id = None

        self._status_var.set("Aufnahme wird gespeichert...")
        self.update_idletasks()

        if self._mic_recorder:
            self._mic_recorder.stop()
        if self._sys_recorder:
            self._sys_recorder.stop()

        self._record_btn.config(text="AUFNAHME STARTEN", bg="#d9534f")
        self._transcribe_btn.config(state="normal")
        self._import_btn.config(state="normal")

        paths = [self._last_mic_path]
        if self._sys_recorder and self._sys_recorder.available:
            paths.append(self._last_sys_path)

        self._lastfile_var.set("Dateien: " + ", ".join(paths))
        self._status_var.set("Aufnahme gespeichert. Bereit zur Transkription.")

    def _update_timer(self) -> None:
        if not self._recording:
            return
        elapsed = time.time() - self._record_start
        h = int(elapsed) // 3600
        m = (int(elapsed) % 3600) // 60
        s = int(elapsed) % 60
        self._timer_var.set(f"{h:02d}:{m:02d}:{s:02d}")
        self._timer_id = self.after(500, self._update_timer)

    # ------------------------------------------------------------------
    # File import
    # ------------------------------------------------------------------
    def _import_file(self) -> None:
        filepath = filedialog.askopenfilename(
            title="Audio-/Video-Datei importieren",
            filetypes=[
                ("Audio/Video", "*.wav *.mp3 *.m4a *.mp4 *.mkv *.ogg *.flac *.webm"),
                ("Alle Dateien", "*.*"),
            ],
        )
        if not filepath:
            return

        # Treat imported file as system track (needs diarization)
        self._last_mic_path = ""
        self._last_sys_path = filepath
        self._lastfile_var.set(f"Importiert: {filepath}")
        self._transcribe_btn.config(state="normal")
        self._status_var.set("Datei importiert. Bereit zur Transkription.")

    # ------------------------------------------------------------------
    # Transcription
    # ------------------------------------------------------------------
    def _start_transcription(self) -> None:
        # Validate inputs
        hf_token = self._token_var.get().strip()
        has_system = bool(self._last_sys_path) and os.path.exists(self._last_sys_path)
        has_mic = bool(self._last_mic_path) and os.path.exists(self._last_mic_path)

        if not has_mic and not has_system:
            messagebox.showwarning(
                "Keine Datei",
                "Keine Aufnahme vorhanden. Bitte zuerst aufnehmen oder eine Datei importieren.",
            )
            return

        if has_system and not hf_token:
            messagebox.showwarning(
                "Token fehlt",
                "Fuer die Sprechererkennung wird ein HuggingFace-Token benoetigt.\n"
                "Bitte unter Einstellungen eintragen.",
            )
            return

        # Read all tkinter vars on main thread before launching worker (thread safety)
        worker_args = {
            "hf_token": hf_token,
            "model": self._model_var.get(),
            "language": self._lang_var.get(),
            "base_dir": self._dir_var.get().strip() or DEFAULT_CONFIG["output_dir"],
            "project": self._project_var.get().strip() or "Besprechung",
            "mic_path": self._last_mic_path,
            "sys_path": self._last_sys_path,
        }

        self._transcribe_btn.config(state="disabled")
        self._record_btn.config(state="disabled")
        self._import_btn.config(state="disabled")
        self._progress.start(15)

        thread = threading.Thread(target=self._transcription_worker, args=(worker_args,), daemon=True)
        thread.start()

    def _transcription_worker(self, args: dict) -> None:
        """Runs in a background thread."""
        try:
            sys_path = args["sys_path"]

            # Check if system audio is silent (skip diarization on empty loopback)
            if sys_path and self._sys_recorder and not self._sys_recorder.has_audio_content():
                self._set_status("System-Audio ist stumm -- wird uebersprungen.")
                sys_path = ""

            all_segments = transcribe_and_diarize(
                mic_path=args["mic_path"],
                system_path=sys_path,
                whisper_model_name=args["model"],
                language=args["language"],
                hf_token=args["hf_token"],
                progress_callback=self._set_status,
            )

            if not all_segments:
                self._set_status("Keine Sprache erkannt.")
                self._finish_transcription([])
                return

            # Save transcript
            base_dir = args["base_dir"]
            ensure_directories(base_dir)

            project = args["project"]
            safe_project = "".join(c if (c.isalnum() or c in "-_ ") else "_" for c in project)
            out_path = os.path.join(
                base_dir, "transkripte", f"{safe_project}_{datetime.now():%Y-%m-%d_%H%M%S}.txt"
            )

            speaker_names = dict(self.config_data.get("speaker_names", {}))
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(format_transcript(all_segments, speaker_names))

            self._set_status(f"Transkript gespeichert: {out_path}")
            self._finish_transcription(all_segments, out_path)

        except Exception as exc:
            self._set_status(f"Fehler: {exc}")
            self._finish_transcription([])

    def _set_status(self, text: str) -> None:
        """Thread-safe status update."""
        self.after(0, lambda: self._status_var.set(text))

    def _finish_transcription(self, segments: list[dict], out_path: str = "") -> None:
        """Called from worker thread when done."""

        def _ui_finish():
            self._progress.stop()
            self._progress_var.set(0)
            self._transcribe_btn.config(state="normal")
            self._record_btn.config(state="normal")
            self._import_btn.config(state="normal")

            if out_path:
                self._lastfile_var.set(f"Transkript: {out_path}")

            if segments:
                self._show_speaker_rename(segments, out_path)

        self.after(0, _ui_finish)

    def _show_speaker_rename(self, segments: list[dict], out_path: str) -> None:
        """Show the speaker renaming dialog, then re-save the transcript."""
        existing_names = dict(self.config_data.get("speaker_names", {}))
        dlg = SpeakerRenameDialog(self, segments, existing_names)
        self.wait_window(dlg)

        new_names = dlg.result
        if new_names != existing_names:
            # Update config
            self.config_data["speaker_names"] = new_names
            save_config(self.config_data)

            # Re-save transcript with updated names
            if out_path:
                transcript_text = format_transcript(segments, new_names)
                try:
                    with open(out_path, "w", encoding="utf-8") as f:
                        f.write(transcript_text)
                    self._status_var.set(
                        f"Transkript mit Sprechernamen aktualisiert: {out_path}"
                    )
                except Exception as exc:
                    self._status_var.set(f"Fehler beim Speichern: {exc}")

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def _on_close(self) -> None:
        if self._recording:
            if not messagebox.askyesno(
                "Aufnahme aktiv",
                "Die Aufnahme laeuft noch. Trotzdem beenden?",
            ):
                return
            self._stop_recording()

        # Persist any changed settings
        self.config_data["hf_token"] = self._token_var.get().strip()
        self.config_data["whisper_model"] = self._model_var.get()
        self.config_data["language"] = self._lang_var.get()
        self.config_data["output_dir"] = self._dir_var.get().strip()
        save_config(self.config_data)

        self.destroy()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app = EBAProtokollApp()
    app.mainloop()
