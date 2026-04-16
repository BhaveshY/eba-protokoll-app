"""
Evals for the EBA Protokoll App.

The app imports tkinter + heavy ML stacks (torch, pyannote, onnx-asr) at
module scope. On a headless CI runner those either are missing or are
extremely slow to import. We only exercise pure-Python logic here, so we
stub the GUI/ML modules before importing the app.

Using stubs (not real tkinter) also means tests are fast enough to use
inside a tight self-improvement loop.
"""

import os
import sys
import types
from unittest.mock import MagicMock


def install_stubs() -> None:
    """Install import-time stubs for GUI/ML libs app.py pulls in at startup.
    Safe to call multiple times."""
    heavy = [
        "tkinter", "tkinter.ttk", "tkinter.filedialog", "tkinter.messagebox",
    ]
    for name in heavy:
        if name not in sys.modules:
            mod = MagicMock()
            # tkinter.Tk etc. are looked up via attribute access; MagicMock covers it.
            sys.modules[name] = mod

    # The app.py module-level code does `import torch as _torch_probe` inside a
    # try/except. If torch isn't installed, the except path runs cleanly — no
    # stub needed. We still short-circuit its DLL manipulation by pretending
    # there's no ffmpeg to find and no torch lib dir.


def add_repo_to_path() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(here)
    if repo not in sys.path:
        sys.path.insert(0, repo)


install_stubs()
add_repo_to_path()
