"""Guard: the app's instance-mutex name must stay in sync with the installer's.

The Windows upgrade flow depends on ONE shared name existing on both sides:

  * ``INSTANCE_MUTEX_NAME`` in ``desktop.py`` — the app creates this mutex.
  * ``AppMutex`` in ``tooling/windows/setup.iss`` — the installer detects it,
    prompts the user to close the app, and waits for it to clear before
    replacing locked files.

If the two drift apart, the installer silently regresses to the fragile
Restart-Manager-only path and an in-place upgrade can roll back mid-install.
These tests (and the build-time check they cover) make that drift a hard error.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[1]
_MODULE_PATH = _REPO_ROOT / "tooling" / "windows" / "check_mutex_sync.py"


def _load_checker():
    spec = importlib.util.spec_from_file_location("check_mutex_sync", _MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


checker = _load_checker()


def test_extracts_mutex_name_from_python_source():
    source = 'INSTANCE_MUTEX_NAME = "SakaDeskInstanceMutex"\n'
    assert checker.find_python_mutex_name(source) == "SakaDeskInstanceMutex"


def test_extracts_mutex_name_from_iss_source():
    source = "AppId={{1314045D}\nAppMutex=SakaDeskInstanceMutex\nCompression=lzma\n"
    assert checker.find_iss_mutex_name(source) == "SakaDeskInstanceMutex"


def test_iss_extraction_ignores_appmutex_mentioned_in_comments():
    source = (
        "; The app holds this mutex (desktop.py); Setup uses AppMutex to detect it.\n"
        "AppMutex=SakaDeskInstanceMutex\n"
    )
    assert checker.find_iss_mutex_name(source) == "SakaDeskInstanceMutex"


def test_verify_sync_returns_shared_name_when_matching():
    py = 'INSTANCE_MUTEX_NAME = "SharedName"\n'
    iss = "AppMutex=SharedName\n"
    assert checker.verify_sync(py, iss) == "SharedName"


def test_verify_sync_raises_on_mismatch():
    py = 'INSTANCE_MUTEX_NAME = "AppSideName"\n'
    iss = "AppMutex=InstallerSideName\n"
    with pytest.raises(checker.MutexNameMismatch) as exc:
        checker.verify_sync(py, iss)
    # Message must name both offending values so the failure is actionable.
    assert "AppSideName" in str(exc.value)
    assert "InstallerSideName" in str(exc.value)


def test_verify_sync_raises_when_python_name_missing():
    with pytest.raises(checker.MutexNameMismatch):
        checker.verify_sync("# no mutex here\n", "AppMutex=SakaDeskInstanceMutex\n")


def test_verify_sync_raises_when_iss_name_missing():
    with pytest.raises(checker.MutexNameMismatch):
        checker.verify_sync('INSTANCE_MUTEX_NAME = "SakaDeskInstanceMutex"\n', "; nothing\n")


def test_real_repo_files_are_in_sync():
    """The actual shipped files must agree — this is the regression guard."""
    py_source = (_REPO_ROOT / "desktop.py").read_text(encoding="utf-8")
    iss_source = (_REPO_ROOT / "tooling" / "windows" / "setup.iss").read_text(
        encoding="utf-8"
    )
    # Should not raise; returns the single shared mutex name.
    name = checker.verify_sync(py_source, iss_source)
    assert name == "SakaDeskInstanceMutex"
