"""Pinned onnxruntime wheel manifest + host-class selection (on-demand runtime provisioning).

`select_runtime_host_class()` maps the detected hardware to a runtime build:
NVIDIA GPU -> `directml` (onnxruntime-directml), everything else -> `cpu`. The
manifest pins each wheel by exact (version, files.pythonhosted.org URL, sha256,
size) -- PyPI's hosted files are immutable per (package, version, hash), so a
pinned URL+hash can never silently serve different bytes.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from backend.services.hardware import detect_hardware

HostClass = Literal["cpu", "directml"]


@dataclass(frozen=True)
class RuntimeAsset:
    host_class: str
    package: str
    version: str
    wheel_url: str
    sha256: str
    size_bytes: int


_RUNTIME_MANIFEST: dict[str, RuntimeAsset] = {
    "cpu": RuntimeAsset(
        host_class="cpu",
        package="onnxruntime",
        version="1.27.0",
        wheel_url=(
            "https://files.pythonhosted.org/packages/4f/88/"
            "8ec9db1a4d126bb8b758992beb40d1249df171917d75f44a327eb5f20dda/"
            "onnxruntime-1.27.0-cp312-cp312-win_amd64.whl"
        ),
        sha256="20c321cf187ba496e648acf6b4cf90b4d398b0d17c2a77fdaeba365b908cc1c1",
        size_bytes=13358769,
    ),
    "directml": RuntimeAsset(
        host_class="directml",
        package="onnxruntime-directml",
        version="1.24.4",
        wheel_url=(
            "https://files.pythonhosted.org/packages/88/ea/"
            "33814eb0ec96775eda4c1d30b0d86e91d7d2cd0d84c66d3915aef0e06fa3/"
            "onnxruntime_directml-1.24.4-cp312-cp312-win_amd64.whl"
        ),
        sha256="f2ecb68b7b7b259d2ef3112ae760149f9b5a1e7c0fbb73d539da6250a648a614",
        size_bytes=25111930,
    ),
}


def get_runtime_asset(host_class: str) -> RuntimeAsset | None:
    return _RUNTIME_MANIFEST.get(host_class)


def select_runtime_host_class() -> HostClass:
    """`directml` if an NVIDIA GPU is detected, else `cpu`."""
    gpu = (detect_hardware().get("gpu") or "")
    if "nvidia" in gpu.lower():
        return "directml"
    return "cpu"
