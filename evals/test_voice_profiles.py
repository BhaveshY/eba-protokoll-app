"""Eval: voice profile matching is correct and fast.

Verifies `identify_speakers` against a reference implementation on
randomized embeddings, and checks the greedy 1:1 invariant.
"""

from __future__ import annotations

import random
import time

import numpy as np

import conftest  # noqa: F401
from voice_profiles import SIMILARITY_THRESHOLD, identify_speakers


def _reference(embeddings, profiles):
    """Original Python-loop implementation, kept here as ground truth."""
    if not profiles or not embeddings:
        return {}
    candidates = []
    for speaker_id, emb in embeddings.items():
        for name, profile in profiles.items():
            sim = float(np.dot(emb, profile["embedding"]))
            candidates.append((sim, speaker_id, name))
    candidates.sort(reverse=True)
    matches = {}
    used = set()
    for sim, sid, name in candidates:
        if sim < SIMILARITY_THRESHOLD:
            break
        if sid in matches or name in used:
            continue
        matches[sid] = name
        used.add(name)
    return matches


def _unit_vec(rng: np.random.Generator, dim=256) -> np.ndarray:
    v = rng.standard_normal(dim).astype(np.float32)
    return v / np.linalg.norm(v)


def _make_case(rng, n_speakers, n_profiles, plant_matches=True):
    profiles = {}
    profile_embs = []
    for i in range(n_profiles):
        e = _unit_vec(rng)
        profiles[f"person_{i}"] = {"embedding": e, "n_sessions": 1}
        profile_embs.append(e)

    embeddings = {}
    for i in range(n_speakers):
        if plant_matches and i < n_profiles:
            # Plant a near-identical embedding so greedy matching has work to do.
            noise = rng.standard_normal(256).astype(np.float32) * 0.1
            e = profile_embs[i] + noise
            e = e / np.linalg.norm(e)
        else:
            e = _unit_vec(rng)
        embeddings[f"SPEAKER_{i:02d}"] = e
    return embeddings, profiles


def test_matches_reference():
    rng = np.random.default_rng(123)
    for n_sp, n_pr in [(1, 1), (3, 3), (5, 10), (10, 20), (25, 50)]:
        embeddings, profiles = _make_case(rng, n_sp, n_pr)
        expected = _reference(embeddings, profiles)
        actual = identify_speakers(embeddings, profiles)
        assert actual == expected, f"mismatch at ({n_sp}, {n_pr}): {actual} vs {expected}"


def test_empty_inputs():
    assert identify_speakers({}, {}) == {}
    assert identify_speakers({"s": np.ones(4, dtype=np.float32)}, {}) == {}
    assert identify_speakers({}, {"p": {"embedding": np.ones(4, dtype=np.float32), "n_sessions": 1}}) == {}


def test_greedy_one_to_one():
    # Two speakers, two profiles: both speakers best-match profile A, but A
    # must only go to the strongest. Second speaker goes to B if similarity
    # is above threshold, else nothing.
    rng = np.random.default_rng(7)
    a = _unit_vec(rng)
    b = _unit_vec(rng)
    # s1 ~= A exactly; s2 is a mild perturbation of A.
    s1 = a.copy()
    s2 = (a + 0.3 * b)
    s2 = s2 / np.linalg.norm(s2)
    profiles = {"A": {"embedding": a, "n_sessions": 1}, "B": {"embedding": b, "n_sessions": 1}}
    embeddings = {"s1": s1, "s2": s2}

    result = identify_speakers(embeddings, profiles)
    # s1 must take A (perfect match); s2 keeps whichever profile is left
    # assuming the similarity clears threshold, otherwise drops.
    assert result.get("s1") == "A"
    if "s2" in result:
        assert result["s2"] != "A"  # A was already taken


def test_below_threshold_not_matched():
    # Orthogonal embeddings → cosine similarity = 0 < threshold
    e = np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float32)
    p = np.array([0.0, 1.0, 0.0, 0.0], dtype=np.float32)
    result = identify_speakers({"s": e}, {"p": {"embedding": p, "n_sessions": 1}})
    assert result == {}


def test_speedup_on_large_db():
    """Scenarios with tens of speakers and hundreds of profiles should
    clearly benefit from matmul over Python loops."""
    rng = np.random.default_rng(2024)
    embeddings, profiles = _make_case(rng, n_speakers=30, n_profiles=300)

    t0 = time.perf_counter()
    ref = _reference(embeddings, profiles)
    ref_ms = (time.perf_counter() - t0) * 1000

    t0 = time.perf_counter()
    new = identify_speakers(embeddings, profiles)
    new_ms = (time.perf_counter() - t0) * 1000

    print(f"  voice profile match: reference={ref_ms:.1f}ms  vectorized={new_ms:.1f}ms  "
          f"speedup={ref_ms/max(new_ms, 0.01):.1f}x")
    assert new == ref
    # Matmul path should be at least 2x faster on this size.
    assert new_ms * 2 <= ref_ms, f"expected >=2x speedup, got {ref_ms/new_ms:.2f}x"
