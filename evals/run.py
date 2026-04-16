"""Entry point for running the eval suite without pytest.

Usage:
    python evals/run.py

Exits with non-zero status on any failure. Writes a concise summary to
stdout so it's easy to paste into a PR description or CI log.
"""

from __future__ import annotations

import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import conftest  # noqa: F401 — installs stubs, adds repo to path


def _collect_tests(module):
    return [(name, getattr(module, name)) for name in dir(module) if name.startswith("test_")]


def main() -> int:
    import test_speaker_assignment  # type: ignore
    import test_voice_profiles  # type: ignore
    import test_has_audio_content  # type: ignore

    modules = [test_speaker_assignment, test_voice_profiles, test_has_audio_content]

    total = 0
    failed = 0
    t_start = time.perf_counter()

    for mod in modules:
        mod_name = mod.__name__
        print(f"\n=== {mod_name} ===")
        for name, fn in _collect_tests(mod):
            total += 1
            try:
                fn()
                print(f"  PASS  {name}")
            except AssertionError as exc:
                failed += 1
                print(f"  FAIL  {name}: {exc}")
            except Exception:
                failed += 1
                print(f"  ERROR {name}:")
                traceback.print_exc()

    elapsed = time.perf_counter() - t_start
    print(f"\n{total - failed}/{total} passed in {elapsed:.2f}s")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
