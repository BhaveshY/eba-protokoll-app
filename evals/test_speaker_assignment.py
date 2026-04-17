"""Eval: speaker-to-segment assignment is correct and fast.

Verifies the new vectorized `_assign_speakers_to_segments` against a
reference Python implementation on randomized inputs, then asserts it
is meaningfully faster on realistic sizes.
"""

from __future__ import annotations

import random
import time
from collections import namedtuple

import numpy as np

import conftest  # noqa: F401 — stubs + path
from app import _assign_speakers_to_segments


Turn = namedtuple("Turn", ["start", "end"])


class MockDiarization:
    """Minimal stand-in for pyannote.core.Annotation."""

    def __init__(self, turns):
        self._turns = list(turns)

    def itertracks(self, yield_label=True):
        for start, end, speaker in self._turns:
            yield Turn(start, end), None, speaker


def _reference(diarization, segments):
    """Original O(N*M) loop from before the optimization. Kept here as
    ground truth — not imported from app because app.py now only has the
    vectorized version."""
    dia_turns = [
        (t.start, t.end, s)
        for t, _, s in diarization.itertracks(yield_label=True)
    ]
    out = []
    for seg in segments:
        seg = dict(seg)
        seg_start, seg_end = seg["start"], seg["end"]
        best_speaker = "Unbekannt"
        best_overlap = 0.0
        for d_start, d_end, d_speaker in dia_turns:
            overlap = max(0.0, min(seg_end, d_end) - max(seg_start, d_start))
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = d_speaker
        seg["speaker"] = best_speaker
        out.append(seg)
    return out


def _gen_case(rng: random.Random, n_segments: int, n_turns: int, duration: float):
    segments = []
    for _ in range(n_segments):
        start = rng.uniform(0, duration)
        end = start + rng.uniform(0.3, 4.0)
        segments.append({"start": start, "end": end, "speaker": "Unbekannt", "text": "x"})
    turns = []
    for _ in range(n_turns):
        start = rng.uniform(0, duration)
        end = start + rng.uniform(0.5, 8.0)
        speaker = f"SPEAKER_{rng.randint(0, 5):02d}"
        turns.append((start, end, speaker))
    return segments, turns


def test_matches_reference_on_random_inputs():
    rng = random.Random(42)
    for n_seg, n_turn, dur in [(1, 1, 10), (5, 10, 60), (100, 50, 600), (500, 200, 3600)]:
        segments, turns = _gen_case(rng, n_seg, n_turn, dur)
        expected = _reference(MockDiarization(turns), segments)
        # Fresh copy because _assign_speakers_to_segments mutates in place.
        actual = _assign_speakers_to_segments(MockDiarization(turns), [dict(s) for s in segments])
        assert len(actual) == len(expected)
        for a, e in zip(actual, expected):
            assert a["speaker"] == e["speaker"], (
                f"mismatch on seg {a}: got {a['speaker']} expected {e['speaker']}"
            )


def test_empty_segments():
    turns = [(0.0, 5.0, "A")]
    assert _assign_speakers_to_segments(MockDiarization(turns), []) == []


def test_empty_diarization_marks_unbekannt():
    segs = [{"start": 0.0, "end": 1.0, "speaker": "A", "text": "hi"}]
    result = _assign_speakers_to_segments(MockDiarization([]), segs)
    assert result[0]["speaker"] == "Unbekannt"


def test_no_overlap_marks_unbekannt():
    segs = [{"start": 10.0, "end": 11.0, "speaker": "X", "text": "t"}]
    turns = [(0.0, 1.0, "A")]
    result = _assign_speakers_to_segments(MockDiarization(turns), segs)
    assert result[0]["speaker"] == "Unbekannt"


def test_picks_max_overlap_speaker():
    # Segment 0..10, turn A overlaps 0..1, turn B overlaps 3..10 → B wins.
    segs = [{"start": 0.0, "end": 10.0, "speaker": "?", "text": "t"}]
    turns = [(0.0, 1.0, "A"), (3.0, 10.0, "B")]
    result = _assign_speakers_to_segments(MockDiarization(turns), segs)
    assert result[0]["speaker"] == "B"


def test_tie_breaks_by_first_turn_in_order():
    """Matches the original loop: strict `>` on overlap means the
    first turn in iteration order wins on ties. `np.argmax` also
    returns the first index at the maximum, so the contract lines
    up — but we lock it in explicitly because a regression here
    would silently swap speaker labels."""
    segs = [{"start": 0.0, "end": 5.0, "speaker": "?", "text": "t"}]
    # Both turns give identical overlap of exactly 5.0.
    turns = [(0.0, 5.0, "A"), (0.0, 5.0, "B")]
    result = _assign_speakers_to_segments(MockDiarization(turns), segs)
    assert result[0]["speaker"] == "A"


def test_speedup_on_realistic_size():
    """The loop version hits pathological overhead once segments * turns
    crosses ~100k. Vectorized should be at least 3x faster there."""
    rng = random.Random(1)
    segments, turns = _gen_case(rng, n_segments=1200, n_turns=400, duration=7200)

    t0 = time.perf_counter()
    _reference(MockDiarization(turns), segments)
    ref_ms = (time.perf_counter() - t0) * 1000

    t0 = time.perf_counter()
    _assign_speakers_to_segments(MockDiarization(turns), [dict(s) for s in segments])
    new_ms = (time.perf_counter() - t0) * 1000

    print(f"  speaker assignment: reference={ref_ms:.1f}ms  vectorized={new_ms:.1f}ms  "
          f"speedup={ref_ms/max(new_ms, 0.01):.1f}x")
    # Intentionally loose — 3x is easily hit on any modern CPU, but we avoid
    # flaking on contended CI hosts.
    assert new_ms * 3 <= ref_ms, f"expected >=3x speedup, got {ref_ms/new_ms:.2f}x"
