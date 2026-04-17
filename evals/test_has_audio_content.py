"""Eval: `SystemAudioRecorder.has_audio_content` correctly detects audio
no matter where it appears in the file.

Before the fix, the check only looked at the first 5 seconds. A meeting
recording where the first bit is silent (user hit record before system
audio started playing — extremely common) was wrongly classified as
"silent" and diarization was skipped entirely.
"""

from __future__ import annotations

import os
import tempfile
import wave

import numpy as np

import conftest  # noqa: F401
from app import SystemAudioRecorder


SR = 16000


def _write_wav(path: str, samples: np.ndarray, sr: int = SR, channels: int = 1) -> None:
    with wave.open(path, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        clipped = np.clip(samples, -32768, 32767).astype(np.int16)
        wf.writeframes(clipped.tobytes())


def _make_recorder(path: str) -> SystemAudioRecorder:
    rec = SystemAudioRecorder(path)
    # SystemAudioRecorder.__init__ only sets filepath; has_audio_content
    # reads from disk, so no further setup is needed for the eval.
    return rec


def _silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SR), dtype=np.int16)


def _tone(seconds: float, amp: int = 8000, freq: int = 440) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.int16)


def test_all_silent_is_silent():
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "silent.wav")
        _write_wav(p, _silence(30))
        assert _make_recorder(p).has_audio_content() is False


def test_audio_at_start_detected():
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "start.wav")
        _write_wav(p, np.concatenate([_tone(3), _silence(27)]))
        assert _make_recorder(p).has_audio_content() is True


def test_audio_only_after_first_5s_detected_regression_fix():
    """This is the bug the old implementation had. The first 5 seconds
    are silent, but real audio begins at t=30s — the recorder must still
    report 'has audio'."""
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "late.wav")
        _write_wav(p, np.concatenate([_silence(30), _tone(30), _silence(30)]))
        assert _make_recorder(p).has_audio_content() is True, \
            "late-starting audio must be detected (the very bug this fix addresses)"


def test_audio_only_at_end_detected():
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "end.wav")
        _write_wav(p, np.concatenate([_silence(60), _tone(5)]))
        assert _make_recorder(p).has_audio_content() is True


def test_short_file_all_silent():
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "short_silent.wav")
        _write_wav(p, _silence(0.3))  # <1s: short-file branch
        assert _make_recorder(p).has_audio_content() is False


def test_short_file_with_audio():
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "short_audio.wav")
        _write_wav(p, _tone(0.5))
        assert _make_recorder(p).has_audio_content() is True


def test_missing_file_is_not_audio():
    rec = _make_recorder("/nonexistent/path/does_not_exist.wav")
    assert rec.has_audio_content() is False


def test_empty_wav_is_not_audio():
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "empty.wav")
        _write_wav(p, np.zeros(0, dtype=np.int16))
        assert _make_recorder(p).has_audio_content() is False
