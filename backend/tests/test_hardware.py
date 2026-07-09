"""Tests for `backend.services.hardware` -- best-effort hardware detection + local-vs-cloud
suggestion for the KB chatbot's LLM backend.

`detect_hardware()` must never raise (it's a best-effort probe safe to call
unconditionally); `suggest_llm_backend()` is pure logic over a hardware dict so it's
tested directly with hand-made dicts rather than depending on the real machine's GPU.

Ported from `saka_cli/tests/test_hardware.py`.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

from backend.services import hardware
from backend.services.hardware import detect_hardware, suggest_llm_backend


@pytest.fixture(autouse=True)
def _reset_hw_cache():
    import backend.services.hardware as h

    h._hw_cache = None
    yield
    h._hw_cache = None


# --- suggest_llm_backend ----------------------------------------------------------------


def test_suggest_24gb_vram_recommends_local_t2_qwen3_32b():
    hw = {
        "ram_gb": 64.0,
        "gpu": "NVIDIA RTX 4090",
        "vram_gb": 24.0,
        "platform": "Linux",
    }
    suggestion = suggest_llm_backend(hw)

    assert suggestion["recommended"] == "local"
    assert suggestion["local_model"] == "qwen3:32b"
    assert suggestion["tier"] == "T2"
    assert suggestion["reason"]


def test_suggest_12gb_vram_recommends_local_t1_qwen25_14b():
    hw = {
        "ram_gb": 32.0,
        "gpu": "NVIDIA RTX 3060",
        "vram_gb": 12.0,
        "platform": "Linux",
    }
    suggestion = suggest_llm_backend(hw)

    assert suggestion["recommended"] == "local"
    assert suggestion["local_model"] == "qwen2.5:14b"
    assert suggestion["tier"] == "T1"
    assert suggestion["reason"]


def test_suggest_8gb_vram_recommends_local_optional_small_tier():
    """T1-small: reason must mention `nemotron-nano-9b-v2-japanese` as an alternative."""
    hw = {"ram_gb": 16.0, "gpu": "NVIDIA RTX 3050", "vram_gb": 8.0, "platform": "Linux"}
    suggestion = suggest_llm_backend(hw)

    assert suggestion["recommended"] == "local"
    assert suggestion["local_model"] == "qwen2.5:7b"
    assert suggestion["tier"] == "T1-small"
    assert "nemotron-nano-9b-v2-japanese" in suggestion["reason"]


def test_suggest_4gb_vram_recommends_cloud():
    hw = {"ram_gb": 16.0, "gpu": "NVIDIA GTX 1650", "vram_gb": 4.0, "platform": "Linux"}
    suggestion = suggest_llm_backend(hw)

    assert suggestion["recommended"] == "cloud"
    assert suggestion["local_model"] is None
    assert suggestion["reason"]


def test_suggest_no_gpu_recommends_cloud():
    hw = {"ram_gb": 16.0, "gpu": None, "vram_gb": None, "platform": "Linux"}
    suggestion = suggest_llm_backend(hw)

    assert suggestion["recommended"] == "cloud"
    assert suggestion["local_model"] is None


def test_suggest_unknown_hardware_recommends_cloud():
    hw = {"ram_gb": None, "gpu": None, "vram_gb": None, "platform": "Linux"}
    suggestion = suggest_llm_backend(hw)

    assert suggestion["recommended"] == "cloud"
    assert suggestion["local_model"] is None


def test_suggest_apple_silicon_with_enough_ram_recommends_local():
    hw = {"ram_gb": 18.0, "gpu": "Apple Silicon", "vram_gb": None, "platform": "Darwin"}
    suggestion = suggest_llm_backend(hw)

    assert suggestion["recommended"] == "local"
    assert suggestion["local_model"] == "qwen2.5:14b"


def test_suggest_apple_silicon_with_low_ram_recommends_cloud():
    hw = {"ram_gb": 8.0, "gpu": "Apple Silicon", "vram_gb": None, "platform": "Darwin"}
    suggestion = suggest_llm_backend(hw)

    assert suggestion["recommended"] == "cloud"


def test_suggest_llm_backend_calls_detect_hardware_when_none_passed():
    with patch(
        "backend.services.hardware.detect_hardware",
        return_value={
            "ram_gb": None,
            "gpu": None,
            "vram_gb": None,
            "platform": "Linux",
        },
    ) as mock_detect:
        suggestion = suggest_llm_backend()

    mock_detect.assert_called_once()
    assert suggestion["recommended"] == "cloud"


# --- detect_hardware ---------------------------------------------------------------------


def test_detect_hardware_never_raises_when_subprocess_fails():
    with patch(
        "backend.services.hardware.subprocess.run",
        side_effect=FileNotFoundError("no nvidia-smi"),
    ):
        hw = detect_hardware()

    assert hw["gpu"] is None
    assert hw["vram_gb"] is None
    assert "platform" in hw


def test_detect_hardware_never_raises_when_sysconf_missing():
    with (
        patch(
            "backend.services.hardware.subprocess.run",
            side_effect=FileNotFoundError("no nvidia-smi"),
        ),
        patch("backend.services.hardware._detect_ram_gb", side_effect=OSError("boom")),
    ):
        hw = detect_hardware()

    assert hw["ram_gb"] is None


def test_detect_hardware_never_raises_on_unexpected_exception():
    """Even a probe raising something outside the usual OSError/ValueError family
    must not escape `detect_hardware()` -- it's called unconditionally on startup."""
    with patch(
        "backend.services.hardware.subprocess.run",
        side_effect=RuntimeError("unexpected"),
    ):
        hw = detect_hardware()

    assert hw["gpu"] is None
    assert hw["vram_gb"] is None


def test_detect_hardware_parses_nvidia_smi_output():
    mock_result = MagicMock()
    mock_result.returncode = 0
    mock_result.stdout = "NVIDIA GeForce RTX 4090, 24564\n"

    with patch("backend.services.hardware.subprocess.run", return_value=mock_result):
        hw = detect_hardware()

    assert hw["gpu"] == "NVIDIA GeForce RTX 4090"
    assert hw["vram_gb"] is not None
    assert 23.0 < hw["vram_gb"] < 25.0


def test_detect_hardware_returns_expected_keys():
    hw = detect_hardware()
    assert set(hw.keys()) == {"ram_gb", "gpu", "vram_gb", "platform"}


def test_detect_hardware_picks_apple_silicon_when_no_nvidia_gpu():
    with (
        patch(
            "backend.services.hardware._detect_nvidia_gpu", return_value=(None, None)
        ),
        patch("backend.services.hardware._is_apple_silicon", return_value=True),
        patch("backend.services.hardware._detect_ram_gb", return_value=18.0),
    ):
        hw = detect_hardware()

    assert hw["gpu"] == "Apple Silicon"
    assert hw["vram_gb"] == 18.0
    assert hw["ram_gb"] == 18.0


# --- _detect_ram_gb / _detect_ram_gb_windows / _is_apple_silicon (private helpers) --------


def test_detect_ram_gb_falls_through_to_windows_helper_when_sysconf_unavailable():
    with (
        patch("backend.services.hardware.platform.system", return_value="Windows"),
        patch.object(os, "sysconf_names", {}, create=True),
        patch(
            "backend.services.hardware._detect_ram_gb_windows", return_value=32.0
        ) as mock_windows,
    ):
        result = hardware._detect_ram_gb()

    mock_windows.assert_called_once()
    assert result == 32.0


def test_detect_ram_gb_returns_none_on_non_windows_without_sysconf():
    with (
        patch("backend.services.hardware.platform.system", return_value="Linux"),
        patch.object(os, "sysconf_names", {}, create=True),
    ):
        result = hardware._detect_ram_gb()

    assert result is None


def test_detect_ram_gb_windows_success_path():
    """Simulates a successful `GlobalMemoryStatusEx` call (Windows-only API, unavailable on
    this test host) by patching `ctypes.windll` in directly -- `create=True` since the
    attribute doesn't exist at all outside Windows."""
    mock_windll = MagicMock()
    mock_windll.kernel32.GlobalMemoryStatusEx.return_value = 1

    with patch("ctypes.windll", mock_windll, create=True):
        result = hardware._detect_ram_gb_windows()

    assert result is not None
    mock_windll.kernel32.GlobalMemoryStatusEx.assert_called_once()


@pytest.mark.skipif(
    os.name == "nt", reason="ctypes.windll genuinely exists on Windows hosts"
)
def test_detect_ram_gb_windows_returns_none_when_api_unavailable():
    """On a non-Windows host, `ctypes.windll` genuinely doesn't exist -- the AttributeError
    is caught and this returns `None` rather than raising."""
    result = hardware._detect_ram_gb_windows()
    assert result is None


def test_is_apple_silicon_false_on_non_darwin():
    with patch("backend.services.hardware.platform.system", return_value="Linux"):
        assert hardware._is_apple_silicon() is False


def test_is_apple_silicon_true_on_arm64_darwin():
    with (
        patch("backend.services.hardware.platform.system", return_value="Darwin"),
        patch("backend.services.hardware.platform.machine", return_value="arm64"),
    ):
        assert hardware._is_apple_silicon() is True


def test_is_apple_silicon_handles_oserror_gracefully():
    with patch(
        "backend.services.hardware.platform.system", side_effect=OSError("boom")
    ):
        assert hardware._is_apple_silicon() is False
