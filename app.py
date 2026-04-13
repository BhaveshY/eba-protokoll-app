"""
EBA Protokoll App
==================
Windows 11 tkinter application for recording virtual meetings with
speaker diarization. Records mic + system audio (WASAPI loopback)
as separate tracks, then transcribes using NVIDIA Parakeet TDT v3
(via onnx-asr / ONNX Runtime) and diarizes using pyannote.audio.

Requires:
    pip install onnx-asr[gpu,hub] onnxruntime-gpu pyannote.audio torch torchaudio sounddevice PyAudioWPatch numpy

Target hardware: CPU + NVIDIA GPU (Windows 11)
"""

import gc
import json
import logging
import logging.handlers
import os
import shutil
import subprocess
import sys
import time
import traceback
import wave
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from datetime import datetime
from pathlib import Path

# pythonw.exe sets sys.stdout/stderr to None — PyTorch crashes when downloading models
# because it tries sys.stdout.write(). Redirect to devnull to prevent this.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

# --- Log rotation (5 MB max, 2 backups) ---
_log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "eba_debug.log")
_log_handler = logging.handlers.RotatingFileHandler(
    _log_path, maxBytes=5 * 1024 * 1024, backupCount=2, encoding="utf-8",
)
_log_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logging.root.addHandler(_log_handler)
logging.root.setLevel(logging.DEBUG)

# ---------------------------------------------------------------------------
# Ensure FFmpeg is on PATH (user env var may not be inherited by this process)
# ---------------------------------------------------------------------------
if not shutil.which("ffmpeg"):
    for _d in [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "ffmpeg"),       # installed by our installer
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "ffmpeg", "bin"),
        r"C:\ffmpeg\bin",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Links"),
        r"C:\ProgramData\chocolatey\bin",
    ]:
        if os.path.isfile(os.path.join(_d, "ffmpeg.exe")):
            os.environ["PATH"] = _d + ";" + os.environ.get("PATH", "")
            break

# ---------------------------------------------------------------------------
# Expose PyTorch's bundled CUDA/cuDNN DLLs to ONNX Runtime
# ---------------------------------------------------------------------------
# onnxruntime-gpu requires cuDNN 9 + cuBLAS (cublasLt64_12.dll, cudnn_*.dll).
# PyTorch's CUDA wheels already ship these DLLs in torch/lib/ — we just need
# to add that directory to the Windows DLL search path before onnxruntime
# loads its CUDA provider. Without this, ASR falls back to CPU (much slower).
try:
    import torch as _torch_probe
    _torch_lib = os.path.join(os.path.dirname(_torch_probe.__file__), "lib")
    if os.path.isdir(_torch_lib):
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(_torch_lib)
        os.environ["PATH"] = _torch_lib + ";" + os.environ.get("PATH", "")
    del _torch_probe, _torch_lib
except Exception as _exc:
    logging.debug("Could not expose torch CUDA DLLs: %s", _exc)

# ---------------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------------

APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = APP_DIR / "config.json"

DEFAULT_CONFIG = {
    "hf_token": "",
    "asr_model": "nemo-parakeet-tdt-0.6b-v3",
    "language": "auto",  # "auto" = let Parakeet detect; set "de"/"en"/etc for a single-language bias
    "speaker_names": {},
    "output_dir": r"C:\EBA-Protokoll",
    "noise_reduction": True,
}


def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
            merged = {**DEFAULT_CONFIG, **saved}
            return merged
        except Exception as exc:
            logging.warning("config.json corrupt, using defaults: %s", exc)
            # Back up corrupt file so user can recover manually
            try:
                bak = CONFIG_PATH.with_suffix(".json.bak")
                shutil.copy2(CONFIG_PATH, bak)
            except Exception:
                pass
    return dict(DEFAULT_CONFIG)


def save_config(cfg: dict) -> None:
    try:
        tmp = CONFIG_PATH.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
        os.replace(tmp, CONFIG_PATH)
    except Exception as exc:
        logging.error("Failed to save config: %s", exc)


def ensure_directories(base: str) -> None:
    for sub in ("aufnahmen", "transkripte", "protokolle"):
        os.makedirs(os.path.join(base, sub), exist_ok=True)


def compress_wav_to_flac(wav_path: str) -> str:
    """Compress a WAV file to FLAC (lossless, ~50% smaller). Returns FLAC path or original on failure."""
    flac_path = wav_path.rsplit(".", 1)[0] + ".flac"
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", wav_path, "-c:a", "flac", flac_path],
            capture_output=True, timeout=300,
        )
        if result.returncode == 0 and os.path.exists(flac_path) and os.path.getsize(flac_path) > 1024:
            os.remove(wav_path)
            return flac_path
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        logging.warning("FLAC compression failed: %s", exc)
    return wav_path


# ---------------------------------------------------------------------------
# Audio recording helpers — stream directly to WAV (constant memory)
# ---------------------------------------------------------------------------

MIC_SAMPLERATE = 16000
MIC_CHANNELS = 1


class MicRecorder:
    """Records from the default microphone using sounddevice.
    Streams directly to WAV file — memory stays constant regardless of duration."""

    def __init__(self, filepath: str, samplerate: int = MIC_SAMPLERATE):
        self.filepath = filepath
        self.samplerate = samplerate
        self._running = False
        self._stream = None
        self._wf = None
        self._lock = threading.Lock()

    def start(self) -> None:
        import sounddevice as sd

        self._wf = wave.open(self.filepath, "wb")
        self._wf.setnchannels(MIC_CHANNELS)
        self._wf.setsampwidth(2)  # int16
        self._wf.setframerate(self.samplerate)

        self._running = True
        try:
            self._stream = sd.InputStream(
                samplerate=self.samplerate,
                channels=MIC_CHANNELS,
                dtype="int16",
                blocksize=4096,
                callback=self._callback,
            )
            self._stream.start()
        except Exception:
            self._running = False
            self._wf.close()
            self._wf = None
            raise

    def _callback(self, indata, frames, time_info, status):
        if self._running:
            data = indata.copy().tobytes()
            with self._lock:
                if self._wf:
                    self._wf.writeframesraw(data)

    def stop(self) -> None:
        self._running = False
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        with self._lock:
            if self._wf:
                self._wf.close()
                self._wf = None


class SystemAudioRecorder:
    """Records system / loopback audio via PyAudioWPatch WASAPI loopback.
    Streams directly to WAV file — memory stays constant regardless of duration."""

    def __init__(self, filepath: str):
        self.filepath = filepath
        self._running = False
        self._p = None
        self._stream = None
        self._wf = None
        self._lock = threading.Lock()
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

            # Open WAV file for streaming write
            self._wf = wave.open(self.filepath, "wb")
            self._wf.setnchannels(self.channels)
            self._wf.setsampwidth(2)
            self._wf.setframerate(self.samplerate)

            self._stream = self._p.open(
                format=pyaudio.paInt16,
                channels=self.channels,
                rate=self.samplerate,
                input=True,
                input_device_index=int(loopback_device["index"]),
                frames_per_buffer=4096,
                stream_callback=self._callback,
            )
            self._stream.start_stream()
            self._running = True
            self.available = True

        except ImportError:
            self.error_message = "PyAudioWPatch nicht installiert."
            self._running = False
            self.available = False
            self._close_wav()
            self._cleanup()
        except Exception as exc:
            self.error_message = f"System-Audio Fehler: {exc}"
            self._running = False
            self.available = False
            self._close_wav()
            self._cleanup()

    def _callback(self, in_data, frame_count, time_info, status):
        if self._running:
            with self._lock:
                if self._wf:
                    self._wf.writeframesraw(in_data)
        return (None, 0)  # 0 == paContinue

    def stop(self) -> None:
        self._running = False
        if self._stream is not None:
            try:
                self._stream.stop_stream()
                self._stream.close()
            except Exception as exc:
                logging.debug("Stream close error: %s", exc)
            self._stream = None
        self._close_wav()
        self._cleanup()

    def _close_wav(self) -> None:
        with self._lock:
            if self._wf:
                self._wf.close()
                self._wf = None

    def _cleanup(self) -> None:
        if self._p is not None:
            try:
                self._p.terminate()
            except Exception as exc:
                logging.debug("PyAudio terminate error: %s", exc)
            self._p = None

    def has_audio_content(self) -> bool:
        """Check whether the recorded file actually contains audible content."""
        if not os.path.exists(self.filepath):
            return False
        try:
            import numpy as np
            with wave.open(self.filepath, "rb") as wf:
                n_frames = wf.getnframes()
                if n_frames == 0:
                    return False
                check_frames = min(n_frames, wf.getframerate() * 5)
                raw = wf.readframes(check_frames)

            samples = np.frombuffer(raw, dtype=np.int16)
            rms = np.sqrt(np.mean(samples.astype(np.float64) ** 2))
            return rms > 50
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
    except ImportError as exc:
        logging.debug("GPU info unavailable: %s", exc)
    return info


def _load_audio_safe(filepath: str):
    """Load audio as 16 kHz mono float32 numpy array.
    Uses torchaudio first (handles most formats via FFmpeg), falls back to stdlib wave
    + scipy polyphase resampling for WAV files when torchaudio is unavailable.
    No normalization — amplifies noise floor on quiet recordings."""
    import numpy as np

    samples = None

    # 1) torchaudio (preferred — high-quality Kaiser resampling, handles MP3/M4A/etc.)
    try:
        import torchaudio
        waveform, sample_rate = torchaudio.load(filepath)
        if sample_rate != 16000:
            waveform = torchaudio.functional.resample(waveform, sample_rate, 16000)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        samples = waveform.squeeze().numpy().astype(np.float32)
    except Exception:
        pass

    # 2) stdlib wave module fallback (WAV only)
    if samples is None:
        try:
            with wave.open(filepath, "rb") as wf:
                n_channels = wf.getnchannels()
                sampwidth = wf.getsampwidth()
                sample_rate = wf.getframerate()
                raw = wf.readframes(wf.getnframes())

            if sampwidth == 2:
                samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            elif sampwidth == 4:
                samples = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
            else:
                samples = np.frombuffer(raw, dtype=np.uint8).astype(np.float32) / 128.0 - 1.0

            if n_channels > 1:
                samples = samples.reshape(-1, n_channels).mean(axis=1)

            if sample_rate != 16000:
                import scipy.signal
                from math import gcd
                g = gcd(16000, sample_rate)
                up, down = 16000 // g, sample_rate // g
                # Always use polyphase filtering — handles any ratio including 44100->16000
                # (up=160, down=441) with proper antialiasing. Kaiser beta=5.0 is SciPy's
                # recommended default for speech.
                samples = scipy.signal.resample_poly(
                    samples, up, down, window=("kaiser", 5.0),
                ).astype(np.float32)

            samples = samples.astype(np.float32)
        except Exception:
            raise RuntimeError(
                f"Audiodatei konnte nicht geladen werden: {filepath}\n"
                "Bitte stellen Sie sicher, dass FFmpeg installiert ist "
                "(benoetigt fuer MP3/M4A/FLAC)."
            )

    return samples


def _reduce_noise(audio, sr: int = 16000):
    """Apply spectral gating noise reduction optimized for speech.
    Uses noisereduce with parameters tuned per library source docs (n_fft=512 for speech)."""
    import noisereduce as nr
    return nr.reduce_noise(
        y=audio,
        sr=sr,
        stationary=False,
        prop_decrease=0.85,
        n_fft=512,
        n_jobs=1,  # 1 job to avoid joblib worker segfault on Windows
    )


def _segment_results_to_dicts(segment_results, speaker_label: str = None) -> list[dict]:
    """Convert onnx-asr SegmentResult objects to segment dicts.
    Each SegmentResult has .text, .start, .end attributes."""
    segments = []
    for seg in segment_results:
        text = seg.text.strip() if hasattr(seg, 'text') else str(seg).strip()
        if text:
            segments.append({
                "start": getattr(seg, 'start', 0.0),
                "end": getattr(seg, 'end', 0.0),
                "speaker": speaker_label or "Unbekannt",
                "text": text,
            })
    return segments


def _assign_speakers_to_segments(diarization, segments: list[dict]) -> list[dict]:
    """Assign pyannote speaker labels to transcription segments by maximum time overlap.

    diarization: pyannote Annotation object from Pipeline.__call__()
    segments: list of {"start", "end", "speaker", "text"} dicts from ASR

    Returns the same segments with "speaker" field updated."""
    dia_turns = [
        (turn.start, turn.end, speaker)
        for turn, _, speaker in diarization.itertracks(yield_label=True)
    ]
    for seg in segments:
        seg_start, seg_end = seg["start"], seg["end"]
        best_speaker = "Unbekannt"
        best_overlap = 0.0
        for d_start, d_end, d_speaker in dia_turns:
            overlap = max(0.0, min(seg_end, d_end) - max(seg_start, d_start))
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = d_speaker
        seg["speaker"] = best_speaker
    return segments


_asr_cache = {"key": None, "model": None}


def _save_audio_to_tempfile(audio, sr: int = 16000) -> str:
    """Save numpy audio to a temporary WAV file for ASR engines that need file paths."""
    import tempfile
    import numpy as np
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    samples = (audio * 32767).clip(-32768, 32767).astype(np.int16)
    with wave.open(tmp.name, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(samples.tobytes())
    return tmp.name


def transcribe_and_diarize(
    mic_path: str,
    system_path: str,
    asr_model_name: str,
    hf_token: str,
    progress_callback=None,
    cancel_event: threading.Event = None,
    noise_reduction: bool = True,
    language: str = "auto",
) -> list[dict]:
    """Transcribe mic + system tracks using Parakeet TDT (onnx-asr) + pyannote diarization.
    Returns merged, sorted segments. Checks cancel_event between stages.
    On diarization failure, returns transcript without speaker labels.

    language: "auto" for automatic detection (handles code-switching), or an ISO code
              like "de"/"en" to bias decoding toward that language."""
    import onnx_asr

    # Build kwargs for asr_model.recognize() — pnc always on; language only when forced
    recognize_kwargs = {"pnc": True}
    if language and language != "auto":
        recognize_kwargs["language"] = language

    def status(msg, pct=-1):
        if progress_callback:
            progress_callback(msg, pct)

    def cancelled() -> bool:
        return cancel_event is not None and cancel_event.is_set()

    # --- Load or reuse cached onnx-asr model ---
    has_mic = bool(mic_path) and os.path.exists(mic_path)
    has_sys = bool(system_path) and os.path.exists(system_path)

    cache_key = asr_model_name
    if _asr_cache["key"] == cache_key and _asr_cache["model"] is not None:
        status("ASR-Modell aus Cache...", 3)
        asr_model = _asr_cache["model"]
    else:
        status("Lade Parakeet ASR-Modell...", 0)
        # GPU auto-detected: uses CUDAExecutionProvider if onnxruntime-gpu installed
        asr_base = onnx_asr.load_model(asr_model_name)
        # onnx-asr >= 0.11 requires an explicit VAD instance; default is silero
        vad = onnx_asr.load_vad()
        # Use silero's default settings — aggressive tuning (low threshold / long pad)
        # causes more mismatched words than it fixes on typical meeting audio.
        asr_model = asr_base.with_vad(vad)
        _asr_cache["model"] = asr_model
        _asr_cache["key"] = cache_key

    if cancelled():
        return []

    # --- Parallel noise reduction ---
    mic_audio = sys_audio = None
    nr_errors = {}

    if noise_reduction and (has_mic or has_sys) and not cancelled():
        status("Rauschunterdrueckung...", 5)
        nr_results = {}

        def _denoise(key, path):
            try:
                audio = _load_audio_safe(path)
                nr_results[key] = _reduce_noise(audio)
            except Exception as exc:
                nr_errors[key] = exc

        threads = []
        if has_mic:
            t = threading.Thread(target=_denoise, args=("mic", mic_path))
            t.start()
            threads.append(t)
        if has_sys:
            t = threading.Thread(target=_denoise, args=("sys", system_path))
            t.start()
            threads.append(t)
        for t in threads:
            t.join()
        if nr_errors:
            raise next(iter(nr_errors.values()))

        mic_audio = nr_results.get("mic")
        sys_audio = nr_results.get("sys")

    all_segments = []

    # --- Mic track (all segments = "Ich") ---
    if has_mic and not cancelled():
        status("Transkribiere Mikrofon...", 17)
        if mic_audio is not None:
            # Denoised audio — save to temp file for onnx-asr
            tmp = _save_audio_to_tempfile(mic_audio)
            try:
                results = list(asr_model.recognize(tmp, **recognize_kwargs))
            finally:
                os.unlink(tmp)
        else:
            # Original file — pass directly
            results = list(asr_model.recognize(mic_path, **recognize_kwargs))

        all_segments.extend(_segment_results_to_dicts(results, speaker_label="Ich"))

        if mic_audio is not None:
            del mic_audio
            mic_audio = None

    # --- System track (needs diarization) ---
    if has_sys and not cancelled():
        # Always load sys_audio into memory — needed for diarization later
        if sys_audio is None:
            sys_audio = _load_audio_safe(system_path)

        status("Transkribiere System-Audio...", 49)
        if noise_reduction and sys_audio is not None:
            tmp = _save_audio_to_tempfile(sys_audio)
            try:
                results = list(asr_model.recognize(tmp, **recognize_kwargs))
            finally:
                os.unlink(tmp)
        else:
            results = list(asr_model.recognize(system_path, **recognize_kwargs))

        sys_segments = _segment_results_to_dicts(results)

        if sys_segments and not cancelled():
            status("Sprechererkennung (Diarisierung)...", 74)
            try:
                import torch
                from pyannote.audio import Pipeline as DiarizationPipeline

                device = "cuda" if torch.cuda.is_available() else "cpu"

                # pyannote v4.0+ renamed use_auth_token to token
                try:
                    diarize_pipeline = DiarizationPipeline.from_pretrained(
                        "pyannote/speaker-diarization-3.1",
                        token=hf_token,
                    )
                except TypeError:
                    diarize_pipeline = DiarizationPipeline.from_pretrained(
                        "pyannote/speaker-diarization-3.1",
                        use_auth_token=hf_token,
                    )
                diarize_pipeline.to(torch.device(device))

                # Reduce batch sizes — pyannote default=32 causes OOM/slowdown on GTX GPUs
                pipe = getattr(diarize_pipeline, '_pipeline', diarize_pipeline)
                if hasattr(pipe, 'embedding_batch_size'):
                    pipe.embedding_batch_size = 8
                if hasattr(pipe, 'segmentation_batch_size'):
                    pipe.segmentation_batch_size = 8
                # Re-enable TF32 — pyannote disables it, losing 10-15% GPU speed
                if device == "cuda":
                    torch.backends.cuda.matmul.allow_tf32 = True

                try:
                    diarization = diarize_pipeline(
                        {"waveform": torch.from_numpy(sys_audio).unsqueeze(0).float(), "sample_rate": 16000},
                        min_speakers=1, max_speakers=10,
                    )
                except (OSError, RuntimeError, ImportError, AttributeError):
                    diarization = diarize_pipeline(system_path, min_speakers=1, max_speakers=10)

                sys_segments = _assign_speakers_to_segments(diarization, sys_segments)

                del diarize_pipeline
                gc.collect()
                if device == "cuda":
                    torch.cuda.empty_cache()
            except Exception as exc:
                status(f"Sprechererkennung fehlgeschlagen ({exc}) -- Transkript ohne Sprecherzuordnung.")

        all_segments.extend(sys_segments)
        del sys_audio

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
        self.confirmed: bool = False
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
        self.confirmed = True
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
        self._cancel_event: threading.Event | None = None
        self._last_embeddings: dict = {}
        self._auto_names: dict = {}

        # Style
        style = ttk.Style(self)
        try:
            style.theme_use("vista")
        except Exception:
            try:
                style.theme_use("clam")
            except Exception as exc:
                logging.debug("Theme fallback failed: %s", exc)

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
            tab, variable=self._progress_var, mode="determinate", maximum=100, length=400
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

        # ASR model info
        model_frame = ttk.LabelFrame(tab, text="ASR-Modell", padding=6)
        model_frame.pack(fill="x", pady=(0, 8))

        ttk.Label(
            model_frame,
            text="NVIDIA Parakeet TDT 0.6b v3 via ONNX Runtime (25 Sprachen)",
            font=("Segoe UI", 9),
        ).pack(anchor="w")

        # Language hint (auto by default — required for code-switched meetings)
        lang_frame = ttk.LabelFrame(tab, text="Sprache", padding=6)
        lang_frame.pack(fill="x", pady=(0, 8))

        ttk.Label(
            lang_frame,
            text="Automatisch = mehrsprachige Meetings (z.B. Deutsch + Englisch).\n"
                 "Eine Sprache waehlen nur, wenn wirklich nur eine Sprache gesprochen wird.",
            font=("Segoe UI", 9),
            foreground="gray",
        ).pack(anchor="w", pady=(0, 4))

        # Display label -> config value
        _LANG_OPTIONS = [
            ("Automatisch (mehrsprachig, empfohlen)", "auto"),
            ("Deutsch", "de"),
            ("Englisch", "en"),
            ("Spanisch", "es"),
            ("Franzoesisch", "fr"),
            ("Italienisch", "it"),
            ("Portugiesisch", "pt"),
            ("Niederlaendisch", "nl"),
            ("Polnisch", "pl"),
        ]
        self._lang_label_to_code = {lbl: code for lbl, code in _LANG_OPTIONS}
        self._lang_code_to_label = {code: lbl for lbl, code in _LANG_OPTIONS}

        current_code = self.config_data.get("language", "auto")
        current_label = self._lang_code_to_label.get(current_code, _LANG_OPTIONS[0][0])

        # Internal var holds the ISO code; combobox works with display labels
        self._lang_var = tk.StringVar(value=current_code)
        self._lang_display_var = tk.StringVar(value=current_label)

        lang_combo = ttk.Combobox(
            lang_frame,
            textvariable=self._lang_display_var,
            values=[lbl for lbl, _ in _LANG_OPTIONS],
            state="readonly",
            width=40,
        )
        lang_combo.pack(anchor="w")

        def _on_lang_change(_event=None):
            label = self._lang_display_var.get()
            self._lang_var.set(self._lang_label_to_code.get(label, "auto"))

        lang_combo.bind("<<ComboboxSelected>>", _on_lang_change)

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

        # Noise reduction
        nr_frame = ttk.LabelFrame(tab, text="Audio-Vorverarbeitung", padding=6)
        nr_frame.pack(fill="x", pady=(0, 8))

        self._nr_var = tk.BooleanVar(value=self.config_data.get("noise_reduction", True))
        ttk.Checkbutton(
            nr_frame,
            text="Rauschunterdrueckung vor Transkription (empfohlen)",
            variable=self._nr_var,
        ).pack(anchor="w")

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
    def _browse_dir(self) -> None:
        d = filedialog.askdirectory(initialdir=self._dir_var.get())
        if d:
            self._dir_var.set(d)

    def _sync_config_from_ui(self) -> None:
        self.config_data["hf_token"] = self._token_var.get().strip()
        self.config_data["output_dir"] = self._dir_var.get().strip()
        self.config_data["noise_reduction"] = self._nr_var.get()
        if hasattr(self, "_lang_var"):
            self.config_data["language"] = self._lang_var.get()

    def _save_settings(self) -> None:
        self._sync_config_from_ui()
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

        multi_speaker = messagebox.askyesno(
            "Sprecheranzahl",
            "Sind mehrere Sprecher in der Aufnahme?\n\n"
            "Ja = Sprechererkennung (HuggingFace-Token noetig)\n"
            "Nein = Einzelsprecher (kein Token noetig)",
        )
        if multi_speaker:
            self._last_mic_path = ""
            self._last_sys_path = filepath
        else:
            self._last_mic_path = filepath
            self._last_sys_path = ""
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
        # Read language on main thread (tkinter vars are not thread-safe)
        language = self._lang_var.get() if hasattr(self, "_lang_var") else self.config_data.get("language", "auto")
        worker_args = {
            "hf_token": hf_token,
            "model": self.config_data.get("asr_model", "nemo-parakeet-tdt-0.6b-v3"),
            "base_dir": self._dir_var.get().strip() or DEFAULT_CONFIG["output_dir"],
            "project": self._project_var.get().strip() or "Besprechung",
            "mic_path": self._last_mic_path,
            "sys_path": self._last_sys_path,
            "noise_reduction": self._nr_var.get(),
            "language": language,
        }

        self._cancel_event = threading.Event()
        self._transcribe_btn.config(text="ABBRECHEN", state="normal",
                                    command=self._cancel_transcription)
        self._record_btn.config(state="disabled")
        self._import_btn.config(state="disabled")
        self._progress_var.set(0)

        thread = threading.Thread(target=self._transcription_worker, args=(worker_args,), daemon=True)
        thread.start()

    def _cancel_transcription(self) -> None:
        if self._cancel_event:
            self._cancel_event.set()
        self._transcribe_btn.config(state="disabled")
        self._set_status("Wird abgebrochen...")

    def _transcription_worker(self, args: dict) -> None:
        """Runs in a background thread."""
        try:
            sys_path = args["sys_path"]

            # Check if system audio is silent (skip diarization on empty loopback)
            if (sys_path and self._sys_recorder
                    and self._sys_recorder.filepath == sys_path
                    and not self._sys_recorder.has_audio_content()):
                self._set_status("System-Audio ist stumm -- wird uebersprungen.")
                sys_path = ""

            all_segments = transcribe_and_diarize(
                mic_path=args["mic_path"],
                system_path=sys_path,
                asr_model_name=args["model"],
                hf_token=args["hf_token"],
                progress_callback=self._set_status,
                cancel_event=self._cancel_event,
                noise_reduction=args["noise_reduction"],
                language=args.get("language", "auto"),
            )

            was_cancelled = self._cancel_event and self._cancel_event.is_set()

            if not all_segments:
                self._set_status("Abgebrochen." if was_cancelled else "Keine Sprache erkannt.")
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

            if was_cancelled:
                self._set_status(f"Abgebrochen. Teilergebnis gespeichert: {out_path}")
            else:
                self._set_status(f"Transkript gespeichert: {out_path}")

            # Extract speaker embeddings for voice profiles (before FLAC compression changes file)
            self._last_embeddings = {}
            self._auto_names = {}
            if sys_path and all_segments and args["hf_token"] and not was_cancelled:
                try:
                    from voice_profiles import extract_speaker_embeddings, identify_speakers, load_profiles
                    self._set_status("Sprecher-Profile abgleichen...", 92)
                    self._last_embeddings = extract_speaker_embeddings(
                        sys_path, all_segments, args["hf_token"],
                    )
                    if self._last_embeddings:
                        profiles = load_profiles()
                        self._auto_names = identify_speakers(self._last_embeddings, profiles)
                except Exception as exc:
                    logging.warning("Voice profile extraction failed: %s", exc)

            # Compress recordings to FLAC in background (lossless, ~50% smaller)
            for wav in (args["mic_path"], args["sys_path"]):
                if wav and os.path.exists(wav) and wav.endswith(".wav"):
                    threading.Thread(target=compress_wav_to_flac, args=(wav,), daemon=True).start()

            self._finish_transcription(all_segments, out_path)

        except Exception as exc:
            logging.error("Transcription error:\n%s", traceback.format_exc())
            self._set_status(f"Fehler: {exc}")
            self._finish_transcription([])

    def _set_status(self, text: str, pct: int = -1) -> None:
        """Thread-safe status update with optional progress percentage."""
        def _update():
            self._status_var.set(text)
            if pct >= 0:
                self._progress_var.set(pct)
        self.after(0, _update)

    def _finish_transcription(self, segments: list[dict], out_path: str = "") -> None:
        """Called from worker thread when done."""

        def _ui_finish():
            self._progress_var.set(100)
            self.after(500, lambda: self._progress_var.set(0))
            self._transcribe_btn.config(text="TRANSKRIBIEREN",
                                        command=self._start_transcription,
                                        state="normal")
            self._record_btn.config(state="normal")
            self._import_btn.config(state="normal")

            if out_path:
                self._lastfile_var.set(f"Transkript: {out_path}")

            if segments:
                self._show_speaker_rename(segments, out_path)

        self.after(0, _ui_finish)

    def _show_speaker_rename(self, segments: list[dict], out_path: str) -> None:
        """Show the speaker renaming dialog, then re-save the transcript and update voice profiles."""
        existing_names = dict(self.config_data.get("speaker_names", {}))

        # Merge auto-identified names from voice profiles
        for speaker_id, name in self._auto_names.items():
            existing_names[speaker_id] = name

        dlg = SpeakerRenameDialog(self, segments, existing_names)
        self.wait_window(dlg)

        if not dlg.confirmed:
            return

        new_names = dlg.result
        self.config_data["speaker_names"] = new_names
        save_config(self.config_data)

        # Update voice profiles with confirmed names
        if self._last_embeddings:
            try:
                from voice_profiles import update_profiles
                update_profiles(new_names, self._last_embeddings)
            except Exception as exc:
                logging.warning("Voice profile update failed: %s", exc)

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
        self._sync_config_from_ui()
        save_config(self.config_data)

        self.destroy()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app = EBAProtokollApp()
    app.mainloop()
