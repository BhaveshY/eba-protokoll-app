"""
Speaker Voice Profiles
======================
Stores speaker voice embeddings for automatic identification across meetings.
Uses pyannote's WeSpeaker embedding model (256-dim vectors, cosine similarity).

Architecture follows meetscribe's proven approach:
- Top N longest segments averaged per speaker
- Greedy 1:1 matching above similarity threshold
- Weighted running average for profile updates across sessions
"""

import gc
import json
import logging
import os
import numpy as np
from collections import defaultdict
from pathlib import Path

PROFILES_PATH = Path(__file__).resolve().parent / "speaker_profiles.json"
SIMILARITY_THRESHOLD = 0.65
MIN_SEGMENT_DURATION = 1.5  # seconds — shorter clips give unreliable embeddings
MAX_SEGMENTS_PER_SPEAKER = 10


def load_profiles(path: str = None) -> dict:
    p = Path(path) if path else PROFILES_PATH
    if not p.exists():
        return {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {
            name: {
                "embedding": np.array(prof["embedding"], dtype=np.float32),
                "n_sessions": prof.get("n_sessions", 1),
            }
            for name, prof in data.items()
        }
    except Exception as exc:
        logging.warning("speaker_profiles.json corrupt: %s", exc)
        return {}


def save_profiles(profiles: dict, path: str = None) -> None:
    p = Path(path) if path else PROFILES_PATH
    data = {
        name: {
            "embedding": prof["embedding"].tolist(),
            "n_sessions": prof["n_sessions"],
        }
        for name, prof in profiles.items()
    }
    try:
        tmp = p.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, p)
    except Exception as exc:
        logging.error("Failed to save speaker profiles: %s", exc)


def extract_speaker_embeddings(
    audio_path: str,
    segments: list,
    hf_token: str,
) -> dict:
    """Extract average embedding per speaker from diarized segments.
    Loads audio from file and embedding model, extracts embeddings, frees both.
    Returns {speaker_label: np.ndarray(256,)}."""
    import torch
    from pyannote.audio import Inference, Model

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = Model.from_pretrained(
        "pyannote/wespeaker-voxceleb-resnet34-LM",
        token=hf_token,
    )
    model.to(torch.device(device))
    inference = Inference(model, window="whole")

    # Load audio once
    import torchaudio
    waveform, sr = torchaudio.load(audio_path)
    if sr != 16000:
        waveform = torchaudio.functional.resample(waveform, sr, 16000)
        sr = 16000
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)

    # Group segments by speaker, skip "Ich", sort by duration (longest first)
    speaker_segs = defaultdict(list)
    for seg in segments:
        sp = seg.get("speaker", "")
        if sp == "Ich" or not sp:
            continue
        dur = seg.get("end", 0) - seg.get("start", 0)
        if dur >= MIN_SEGMENT_DURATION:
            speaker_segs[sp].append(seg)

    embeddings = {}
    for speaker, segs in speaker_segs.items():
        segs.sort(key=lambda s: s["end"] - s["start"], reverse=True)
        segs = segs[:MAX_SEGMENTS_PER_SPEAKER]

        embs = []
        for seg in segs:
            start_sample = int(seg["start"] * sr)
            end_sample = int(seg["end"] * sr)
            clip = waveform[:, start_sample:end_sample]
            if clip.shape[1] < sr:  # skip clips under 1 second
                continue
            try:
                audio_dict = {"waveform": clip.float(), "sample_rate": sr}
                with torch.inference_mode():
                    emb = inference(audio_dict)
                embs.append(np.array(emb).flatten().astype(np.float32))
            except Exception as exc:
                logging.debug("Embedding extraction failed for segment: %s", exc)
                continue

        if embs:
            avg = np.mean(embs, axis=0)
            norm = np.linalg.norm(avg)
            if norm > 0:
                avg = avg / norm
            embeddings[speaker] = avg

    del model, inference
    gc.collect()
    if device == "cuda":
        torch.cuda.empty_cache()

    return embeddings


def identify_speakers(embeddings: dict, profiles: dict) -> dict:
    """Match speaker embeddings against known profiles.
    Returns {speaker_id: profile_name} for matches above threshold.
    Uses greedy 1:1 matching (best similarity first) like meetscribe.
    Cosine similarity is computed as a single matmul instead of a Python
    double loop — noticeable once the profile DB grows past a handful."""
    if not profiles or not embeddings:
        return {}

    speaker_ids = list(embeddings.keys())
    profile_names = list(profiles.keys())

    emb_matrix = np.stack([embeddings[s] for s in speaker_ids]).astype(np.float32)
    prof_matrix = np.stack([profiles[n]["embedding"] for n in profile_names]).astype(np.float32)

    sim = emb_matrix @ prof_matrix.T  # (n_speakers, n_profiles)

    # Flatten and rank by similarity, then do greedy 1:1 assignment.
    flat = sim.ravel()
    order = np.argsort(-flat, kind="stable")

    matches: dict = {}
    used_profiles: set = set()
    n_profiles = len(profile_names)
    for idx in order:
        s = float(flat[idx])
        if s < SIMILARITY_THRESHOLD:
            break
        i, j = divmod(int(idx), n_profiles)
        speaker_id = speaker_ids[i]
        name = profile_names[j]
        if speaker_id in matches or name in used_profiles:
            continue
        matches[speaker_id] = name
        used_profiles.add(name)

    return matches


def update_profiles(
    confirmed_names: dict,
    embeddings: dict,
    path: str = None,
) -> None:
    """Update profile database with confirmed speaker names and their embeddings.
    Uses weighted running average for existing profiles (improves accuracy over time)."""
    profiles = load_profiles(path)

    for speaker_id, name in confirmed_names.items():
        if not name or speaker_id not in embeddings:
            continue

        new_emb = embeddings[speaker_id]

        if name in profiles:
            # Weighted running average (like meetscribe)
            old = profiles[name]
            n = old["n_sessions"]
            merged = (old["embedding"] * n + new_emb) / (n + 1)
            norm = np.linalg.norm(merged)
            if norm > 0:
                merged = merged / norm
            profiles[name] = {"embedding": merged, "n_sessions": n + 1}
        else:
            profiles[name] = {"embedding": new_emb, "n_sessions": 1}

    save_profiles(profiles, path)
