"""EBA Protokoll — meeting transcription with speaker diarization (Windows 11, NVIDIA GPU).
Records mic + system audio (WASAPI loopback), transcribes via Parakeet TDT / onnx-asr,
diarizes via pyannote.audio."""

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

if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

_log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "eba_debug.log")
_log_handler = logging.handlers.RotatingFileHandler(
    _log_path, maxBytes=5 * 1024 * 1024, backupCount=2, encoding="utf-8",
)
_log_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logging.root.addHandler(_log_handler)
logging.root.setLevel(logging.DEBUG)

if not shutil.which("ffmpeg"):
    for _d in [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "ffmpeg"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "ffmpeg", "bin"),
        r"C:\ffmpeg\bin",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Links"),
        r"C:\ProgramData\chocolatey\bin",
    ]:
        if os.path.isfile(os.path.join(_d, "ffmpeg.exe")):
            os.environ["PATH"] = _d + ";" + os.environ.get("PATH", "")
            break

# Expose PyTorch's bundled CUDA/cuDNN DLLs so ONNX Runtime finds them
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

APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = APP_DIR / "config.json"

DEFAULT_CONFIG = {
    "hf_token": "",
    "asr_model": "nemo-parakeet-tdt-0.6b-v3",
    "language": "auto",
    "speaker_names": {},
    "output_dir": r"C:\EBA-Protokoll",
    "noise_reduction": True,
    "debug_memory": False,
}


def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
            return {**DEFAULT_CONFIG, **saved}
        except Exception as exc:
            logging.warning("config.json corrupt, using defaults: %s", exc)
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


def _safe_project_name(name: str) -> str:
    return "".join(c if (c.isalnum() or c in "-_ ") else "_" for c in name)


def compress_wav_to_flac(wav_path: str) -> str:
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


MIC_SAMPLERATE = 16000
MIC_CHANNELS = 1


class MicRecorder:

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
        self._wf.setsampwidth(2)
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
        return (None, 0)

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
        # Samples windows across the file; the old "first 5 s" check misfired
        # when system audio started late (common — participant unmutes after t=0).
        if not os.path.exists(self.filepath):
            return False
        try:
            import numpy as np
            threshold = 50.0
            num_windows = 5
            with wave.open(self.filepath, "rb") as wf:
                n_frames = wf.getnframes()
                if n_frames == 0:
                    return False
                frame_rate = wf.getframerate() or 16000
                window_frames = min(frame_rate, n_frames)

                if n_frames <= window_frames:
                    wf.setpos(0)
                    raw = wf.readframes(n_frames)
                    samples = np.frombuffer(raw, dtype=np.int16)
                    if samples.size == 0:
                        return False
                    rms = float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))
                    return rms > threshold

                step = (n_frames - window_frames) // (num_windows - 1)
                for i in range(num_windows):
                    pos = min(i * step, n_frames - window_frames)
                    wf.setpos(pos)
                    raw = wf.readframes(window_frames)
                    samples = np.frombuffer(raw, dtype=np.int16)
                    if samples.size == 0:
                        continue
                    rms = float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))
                    if rms > threshold:
                        return True
            return False
        except Exception:
            return False



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


def _log_memory(tag: str) -> None:
    rss_mb = -1.0
    try:
        import psutil
        rss_mb = psutil.Process().memory_info().rss / 1024 / 1024
    except ImportError:
        pass
    try:
        import torch
        if torch.cuda.is_available():
            cuda_mb = torch.cuda.memory_allocated() / 1024 / 1024
            cuda_peak = torch.cuda.max_memory_allocated() / 1024 / 1024
            logging.info("[mem:%s] RSS=%.0fMB CUDA=%.0fMB peak=%.0fMB", tag, rss_mb, cuda_mb, cuda_peak)
            return
    except ImportError:
        pass
    logging.info("[mem:%s] RSS=%.0fMB", tag, rss_mb)


def _load_audio_safe(filepath: str):
    import numpy as np

    samples = None

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
                samples = scipy.signal.resample_poly(
                    samples, up, down, window=("kaiser", 5.0),
                ).astype(np.float32)
        except Exception:
            raise RuntimeError(
                f"Audiodatei konnte nicht geladen werden: {filepath}\n"
                "Bitte stellen Sie sicher, dass FFmpeg installiert ist "
                "(benoetigt fuer MP3/M4A/FLAC)."
            )

    return samples


def _reduce_noise(audio, sr: int = 16000):
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
    import numpy as np

    dia_turns = [
        (turn.start, turn.end, speaker)
        for turn, _, speaker in diarization.itertracks(yield_label=True)
    ]
    if not segments:
        return segments
    if not dia_turns:
        for seg in segments:
            seg["speaker"] = "Unbekannt"
        return segments

    turn_starts = np.fromiter((t[0] for t in dia_turns), dtype=np.float64, count=len(dia_turns))
    turn_ends = np.fromiter((t[1] for t in dia_turns), dtype=np.float64, count=len(dia_turns))
    speakers = [t[2] for t in dia_turns]

    seg_starts = np.fromiter((s["start"] for s in segments), dtype=np.float64, count=len(segments))
    seg_ends = np.fromiter((s["end"] for s in segments), dtype=np.float64, count=len(segments))

    # overlap[i, j] = max(0, min(seg_end_i, turn_end_j) - max(seg_start_i, turn_start_j))
    overlap = np.minimum(seg_ends[:, None], turn_ends[None, :]) \
              - np.maximum(seg_starts[:, None], turn_starts[None, :])
    np.maximum(overlap, 0.0, out=overlap)

    best_idx = overlap.argmax(axis=1)
    best_overlap = overlap[np.arange(len(segments)), best_idx]

    for i, seg in enumerate(segments):
        seg["speaker"] = speakers[int(best_idx[i])] if best_overlap[i] > 0 else "Unbekannt"
    return segments


_asr_cache = {"key": None, "model": None}


def _save_audio_to_tempfile(audio, sr: int = 16000) -> str:
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
    debug_memory: bool = False,
) -> list[dict]:
    """Transcribe mic + system tracks using Parakeet TDT + pyannote diarization.
    Returns merged, sorted segments. On diarization failure, returns transcript without speaker labels."""
    import onnx_asr

    try:
        import torch as _torch
    except ImportError:
        _torch = None

    if debug_memory and _torch is not None and _torch.cuda.is_available():
        _torch.cuda.reset_peak_memory_stats()

    def mem(tag: str) -> None:
        if debug_memory:
            _log_memory(tag)

    recognize_kwargs = {"pnc": True, "channel": "mean"}
    if language and language != "auto":
        recognize_kwargs["language"] = language

    def status(msg, pct=-1):
        if progress_callback:
            progress_callback(msg, pct)

    def cancelled() -> bool:
        return cancel_event is not None and cancel_event.is_set()

    has_mic = bool(mic_path) and os.path.exists(mic_path)
    has_sys = bool(system_path) and os.path.exists(system_path)

    cache_key = asr_model_name
    if _asr_cache["key"] == cache_key and _asr_cache["model"] is not None:
        status("ASR-Modell aus Cache...", 3)
        asr_model = _asr_cache["model"]
    else:
        status("Lade Parakeet ASR-Modell...", 0)
        asr_base = onnx_asr.load_model(asr_model_name)
        vad = onnx_asr.load_vad()
        asr_model = asr_base.with_vad(vad, speech_pad_ms=100)
        _asr_cache["model"] = asr_model
        _asr_cache["key"] = cache_key

    if cancelled():
        return []

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

    if has_mic and not cancelled():
        status("Transkribiere Mikrofon...", 17)
        if mic_audio is not None:
            tmp = _save_audio_to_tempfile(mic_audio)
            try:
                results = list(asr_model.recognize(tmp, **recognize_kwargs))
            finally:
                os.unlink(tmp)
        else:
            results = list(asr_model.recognize(mic_path, **recognize_kwargs))

        all_segments.extend(_segment_results_to_dicts(results, speaker_label="Ich"))

        del mic_audio
        mem("after_mic_asr")

    if has_sys and not cancelled():
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
            gc.collect()
            if _torch is not None and _torch.cuda.is_available():
                _torch.cuda.empty_cache()
            mem("before_diarize")

            status("Sprechererkennung (Diarisierung)...", 74)
            try:
                import torch
                from pyannote.audio import Pipeline as DiarizationPipeline

                device = "cuda" if torch.cuda.is_available() else "cpu"

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

                pipe = getattr(diarize_pipeline, '_pipeline', diarize_pipeline)
                if hasattr(pipe, 'embedding_batch_size'):
                    pipe.embedding_batch_size = 8
                if hasattr(pipe, 'segmentation_batch_size'):
                    pipe.segmentation_batch_size = 8
                if device == "cuda":
                    torch.backends.cuda.matmul.allow_tf32 = True

                with torch.inference_mode():
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
                mem("after_diarize")
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



class SpeakerRenameDialog(tk.Toplevel):

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



class EBAProtokollApp(tk.Tk):
    def __init__(self):
        super().__init__()

        self.title("EBA Protokoll")
        self.geometry("600x700")
        self.minsize(500, 550)

        self.config_data = load_config()
        ensure_directories(self.config_data["output_dir"])

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

        style = ttk.Style(self)
        try:
            style.theme_use("vista")
        except Exception:
            try:
                style.theme_use("clam")
            except Exception as exc:
                logging.debug("Theme fallback failed: %s", exc)

        self._notebook = ttk.Notebook(self)
        self._notebook.pack(fill="both", expand=True, padx=6, pady=(6, 0))

        self._build_recording_tab()
        self._build_settings_tab()

        self._statusbar = ttk.Label(
            self, text="Bereit", relief="sunken", anchor="w", padding=(6, 2)
        )
        self._statusbar.pack(fill="x", side="bottom", padx=6, pady=(0, 6))

        self._update_gpu_status()

        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_recording_tab(self) -> None:
        tab = ttk.Frame(self._notebook, padding=10)
        self._notebook.add(tab, text="  Aufnahme  ")

        proj_frame = ttk.LabelFrame(tab, text="Projektname", padding=6)
        proj_frame.pack(fill="x", pady=(0, 8))

        default_name = f"Besprechung_{datetime.now():%Y-%m-%d}"
        self._project_var = tk.StringVar(value=default_name)
        ttk.Entry(proj_frame, textvariable=self._project_var, width=50).pack(
            fill="x"
        )

        self._timer_var = tk.StringVar(value="00:00:00")
        timer_label = ttk.Label(
            tab, textvariable=self._timer_var, font=("Consolas", 28), anchor="center"
        )
        timer_label.pack(pady=(4, 8))

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

        self._progress_var = tk.DoubleVar(value=0)
        self._progress = ttk.Progressbar(
            tab, variable=self._progress_var, mode="determinate", maximum=100, length=400
        )
        self._progress.pack(fill="x", pady=(10, 4))

        self._status_var = tk.StringVar(value="")
        ttk.Label(tab, textvariable=self._status_var, wraplength=560).pack(
            anchor="w", pady=2
        )

        self._lastfile_var = tk.StringVar(value="")
        ttk.Label(tab, textvariable=self._lastfile_var, foreground="gray", wraplength=560).pack(
            anchor="w", pady=(8, 0)
        )

    def _build_mapped_combobox(self, parent, options: list[tuple[str, str]],
                               config_key: str, default: str, width: int = 50) -> tk.StringVar:
        label_to_code = {lbl: code for lbl, code in options}
        code_to_label = {code: lbl for lbl, code in options}
        current = self.config_data.get(config_key, default)
        code_var = tk.StringVar(value=current)
        display_var = tk.StringVar(value=code_to_label.get(current, options[0][0]))
        combo = ttk.Combobox(parent, textvariable=display_var,
                             values=[lbl for lbl, _ in options], state="readonly", width=width)
        combo.pack(anchor="w")
        combo.bind("<<ComboboxSelected>>",
                   lambda _: code_var.set(label_to_code.get(display_var.get(), default)))
        return code_var

    def _build_settings_tab(self) -> None:
        tab = ttk.Frame(self._notebook, padding=10)
        self._notebook.add(tab, text="  Einstellungen  ")

        token_frame = ttk.LabelFrame(tab, text="HuggingFace Token (fuer Diarisierung)", padding=6)
        token_frame.pack(fill="x", pady=(0, 8))

        self._token_var = tk.StringVar(value=self.config_data.get("hf_token", ""))
        ttk.Entry(token_frame, textvariable=self._token_var, show="*", width=55).pack(
            fill="x"
        )

        model_frame = ttk.LabelFrame(tab, text="ASR-Modell", padding=6)
        model_frame.pack(fill="x", pady=(0, 8))

        ttk.Label(
            model_frame,
            text="Canary = hoechste Genauigkeit (1 Mrd. Parameter, ca. 2x langsamer).\n"
                 "Parakeet = gute Balance aus Geschwindigkeit und Qualitaet.",
            font=("Segoe UI", 9),
            foreground="gray",
        ).pack(anchor="w", pady=(0, 4))

        self._model_var = self._build_mapped_combobox(model_frame, [
            ("Canary 1b v2 (maximale Genauigkeit, 25 Sprachen)", "nemo-canary-1b-v2"),
            ("Parakeet TDT 0.6b v3 (schnell, 25 Sprachen)", "nemo-parakeet-tdt-0.6b-v3"),
        ], "asr_model", "nemo-parakeet-tdt-0.6b-v3")

        lang_frame = ttk.LabelFrame(tab, text="Sprache", padding=6)
        lang_frame.pack(fill="x", pady=(0, 8))

        ttk.Label(
            lang_frame,
            text="Automatisch = mehrsprachige Meetings (z.B. Deutsch + Englisch).\n"
                 "Eine Sprache waehlen nur, wenn wirklich nur eine Sprache gesprochen wird.",
            font=("Segoe UI", 9),
            foreground="gray",
        ).pack(anchor="w", pady=(0, 4))

        self._lang_var = self._build_mapped_combobox(lang_frame, [
            ("Automatisch (mehrsprachig, empfohlen)", "auto"),
            ("Deutsch", "de"), ("Englisch", "en"), ("Spanisch", "es"),
            ("Franzoesisch", "fr"), ("Italienisch", "it"), ("Portugiesisch", "pt"),
            ("Niederlaendisch", "nl"), ("Polnisch", "pl"),
        ], "language", "auto", width=40)

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

        nr_frame = ttk.LabelFrame(tab, text="Audio-Vorverarbeitung", padding=6)
        nr_frame.pack(fill="x", pady=(0, 8))

        self._nr_var = tk.BooleanVar(value=self.config_data.get("noise_reduction", True))
        ttk.Checkbutton(
            nr_frame,
            text="Rauschunterdrueckung vor Transkription",
            variable=self._nr_var,
        ).pack(anchor="w")
        ttk.Label(
            nr_frame,
            text="Bei sauberer Audio (Headset, leises Buero) ausschalten fuer bessere\n"
                 "Worterkennung. Einschalten nur bei starkem Hintergrundrauschen.",
            font=("Segoe UI", 9),
            foreground="gray",
        ).pack(anchor="w", pady=(2, 0))

        gpu_frame = ttk.LabelFrame(tab, text="GPU Status", padding=6)
        gpu_frame.pack(fill="x", pady=(0, 8))

        self._gpu_info_var = tk.StringVar(value="Pruefe GPU...")
        ttk.Label(gpu_frame, textvariable=self._gpu_info_var, wraplength=520).pack(
            anchor="w"
        )

        ttk.Button(tab, text="Einstellungen speichern", command=self._save_settings).pack(
            pady=10
        )

    def _browse_dir(self) -> None:
        d = filedialog.askdirectory(initialdir=self._dir_var.get())
        if d:
            self._dir_var.set(d)

    def _sync_config_from_ui(self) -> None:
        self.config_data["hf_token"] = self._token_var.get().strip()
        self.config_data["output_dir"] = self._dir_var.get().strip()
        self.config_data["noise_reduction"] = self._nr_var.get()
        self.config_data["language"] = self._lang_var.get()
        self.config_data["asr_model"] = self._model_var.get()

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
        prefix = f"{_safe_project_name(project)}_{timestamp}"
        self._last_mic_path = os.path.join(aufnahmen, f"{prefix}_mic.wav")
        self._last_sys_path = os.path.join(aufnahmen, f"{prefix}_system.wav")

        try:
            self._mic_recorder = MicRecorder(self._last_mic_path)
            self._mic_recorder.start()
        except Exception as exc:
            messagebox.showerror(
                "Mikrofon-Fehler",
                f"Mikrofon konnte nicht gestartet werden:\n{exc}",
            )
            return

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
        self._timer_var.set(format_timestamp(time.time() - self._record_start))
        self._timer_id = self.after(500, self._update_timer)

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

    def _start_transcription(self) -> None:
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

        worker_args = {
            "hf_token": hf_token,
            "model": self._model_var.get(),
            "base_dir": self._dir_var.get().strip() or DEFAULT_CONFIG["output_dir"],
            "project": self._project_var.get().strip() or "Besprechung",
            "mic_path": self._last_mic_path,
            "sys_path": self._last_sys_path,
            "noise_reduction": self._nr_var.get(),
            "language": self._lang_var.get(),
            "debug_memory": bool(self.config_data.get("debug_memory", False)),
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
        try:
            sys_path = args["sys_path"]

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
                debug_memory=args.get("debug_memory", False),
            )

            was_cancelled = self._cancel_event and self._cancel_event.is_set()

            if not all_segments:
                self._set_status("Abgebrochen." if was_cancelled else "Keine Sprache erkannt.")
                self._finish_transcription([])
                return

            base_dir = args["base_dir"]
            ensure_directories(base_dir)

            out_path = os.path.join(
                base_dir, "transkripte",
                f"{_safe_project_name(args['project'])}_{datetime.now():%Y-%m-%d_%H%M%S}.txt",
            )

            speaker_names = dict(self.config_data.get("speaker_names", {}))
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(format_transcript(all_segments, speaker_names))

            if was_cancelled:
                self._set_status(f"Abgebrochen. Teilergebnis gespeichert: {out_path}")
            else:
                self._set_status(f"Transkript gespeichert: {out_path}")

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

            for wav in (args["mic_path"], args["sys_path"]):
                if wav and os.path.exists(wav) and wav.endswith(".wav"):
                    threading.Thread(target=compress_wav_to_flac, args=(wav,), daemon=True).start()

            self._finish_transcription(all_segments, out_path)

        except Exception as exc:
            logging.error("Transcription error:\n%s", traceback.format_exc())
            self._set_status(f"Fehler: {exc}")
            self._finish_transcription([])

    def _set_status(self, text: str, pct: int = -1) -> None:
        def _update():
            self._status_var.set(text)
            if pct >= 0:
                self._progress_var.set(pct)
        self.after(0, _update)

    def _finish_transcription(self, segments: list[dict], out_path: str = "") -> None:

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
        existing_names = dict(self.config_data.get("speaker_names", {}))
        for speaker_id, name in self._auto_names.items():
            existing_names[speaker_id] = name

        dlg = SpeakerRenameDialog(self, segments, existing_names)
        self.wait_window(dlg)

        if not dlg.confirmed:
            return

        new_names = dlg.result
        self.config_data["speaker_names"] = new_names
        save_config(self.config_data)

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

    def _on_close(self) -> None:
        if self._recording:
            if not messagebox.askyesno(
                "Aufnahme aktiv",
                "Die Aufnahme laeuft noch. Trotzdem beenden?",
            ):
                return
            self._stop_recording()

        self._sync_config_from_ui()
        save_config(self.config_data)

        self.destroy()


if __name__ == "__main__":
    app = EBAProtokollApp()
    app.mainloop()
