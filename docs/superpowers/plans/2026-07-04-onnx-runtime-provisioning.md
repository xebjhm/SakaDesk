# On-Demand ONNX Runtime Provisioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Windows app without onnxruntime bundled; on first KB use, auto-detect the host and download + install the correct onnxruntime build (NVIDIA→DirectML, else CPU), then load it before first import.

**Architecture:** A pinned wheel manifest + a `RuntimeProvisioner` (download→sha256-verify→extract→atomic install, mirroring `ModelDownloadManager`), a `runtime_loader` that prepends the installed runtime to `sys.path`/DLL dir before any `import onnxruntime`, a readiness probe that auto-triggers provisioning, a status endpoint, and a PyInstaller `excludes` change.

**Tech Stack:** Python 3.12, httpx (async, `follow_redirects`), zipfile, structlog, FastAPI, pytest + respx.

## Global Constraints

- Python **3.12** (build/runtime). `requires-python >= 3.12` (SakaDesk).
- All new outbound HTTP uses `httpx.AsyncClient(follow_redirects=True)` (HF/PyPI redirect).
- **Complete logging** (spec §Logging): every step logs via `structlog`; log the HTTP status on any non-200 *before* `raise_for_status`; never log secrets (none here).
- Windows packaged app is the only consumer; dev/tests/non-Windows must be unaffected (onnxruntime stays in the venv → loader is a no-op).
- App-data dir via `backend.services.platform.get_app_data_dir()` (honors `SAKADESK_DATA_DIR`).
- Follow existing patterns in `backend/services/model_assets.py` (provisioner) and `tests/test_model_assets_download.py` (tests). Run tests with `uv run python -m pytest <path> -o addopts="" -q` (the repo's default addopts add `--cov`/integration filters).
- Pinned wheels (cp312-win_amd64), verbatim:
  - `onnxruntime` 1.27.0 — url `https://files.pythonhosted.org/packages/4f/88/8ec9db1a4d126bb8b758992beb40d1249df171917d75f44a327eb5f20dda/onnxruntime-1.27.0-cp312-cp312-win_amd64.whl`, sha256 `20c321cf187ba496e648acf6b4cf90b4d398b0d17c2a77fdaeba365b908cc1c1`, size `13358769`.
  - `onnxruntime-directml` 1.24.4 — url `https://files.pythonhosted.org/packages/88/ea/33814eb0ec96775eda4c1d30b0d86e91d7d2cd0d84c66d3915aef0e06fa3/onnxruntime_directml-1.24.4-cp312-cp312-win_amd64.whl`, sha256 `f2ecb68b7b7b259d2ef3112ae760149f9b5a1e7c0fbb73d539da6250a648a614`, size `25111930`.

---

### Task 1: Runtime manifest + host-class selection

**Files:**
- Create: `backend/services/onnx_runtime_manifest.py`
- Test: `tests/test_onnx_runtime_manifest.py`

**Interfaces:**
- Produces: `RuntimeAsset` (frozen dataclass: `host_class:str, package:str, version:str, wheel_url:str, sha256:str, size_bytes:int`); `get_runtime_asset(host_class:str) -> RuntimeAsset | None`; `select_runtime_host_class() -> Literal["cpu","directml"]`.
- Consumes: `backend.services.hardware.detect_hardware`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_onnx_runtime_manifest.py
from unittest.mock import patch

from backend.services import onnx_runtime_manifest as m


def test_manifest_has_cpu_and_directml_pins():
    cpu = m.get_runtime_asset("cpu")
    dml = m.get_runtime_asset("directml")
    assert cpu.package == "onnxruntime" and cpu.sha256 and cpu.size_bytes > 0
    assert dml.package == "onnxruntime-directml" and dml.sha256 and dml.size_bytes > 0
    assert m.get_runtime_asset("bogus") is None


def test_host_class_directml_for_nvidia_else_cpu():
    with patch.object(m, "detect_hardware", return_value={"gpu": "NVIDIA GeForce RTX 3090"}):
        assert m.select_runtime_host_class() == "directml"
    with patch.object(m, "detect_hardware", return_value={"gpu": None}):
        assert m.select_runtime_host_class() == "cpu"
    with patch.object(m, "detect_hardware", return_value={"gpu": "AMD Radeon"}):
        assert m.select_runtime_host_class() == "cpu"  # v1: only NVIDIA -> directml
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_onnx_runtime_manifest.py -o addopts="" -q`
Expected: FAIL (`ModuleNotFoundError: backend.services.onnx_runtime_manifest`).

- [ ] **Step 3: Write minimal implementation**

```python
# backend/services/onnx_runtime_manifest.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_onnx_runtime_manifest.py -o addopts="" -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/onnx_runtime_manifest.py tests/test_onnx_runtime_manifest.py
git commit -m "feat(runtime): pinned onnxruntime wheel manifest + host-class selection"
```

---

### Task 2: RuntimeProvisioner (download → verify → extract → install)

**Files:**
- Create: `backend/services/onnx_runtime_provision.py`
- Test: `tests/test_onnx_runtime_provision.py`

**Interfaces:**
- Consumes: `RuntimeAsset`, `get_runtime_asset` (Task 1); `get_app_data_dir`.
- Produces: `RuntimeProvisioner(runtime_dir: Path | None = None, http_client_factory: Callable[[], httpx.AsyncClient] | None = None)` with `async ensure(host_class:str)`, `status()->dict`, `cancel()->bool`, `is_installed(host_class:str)->bool`, `install_dir(host_class:str)->Path`; module singleton `get_runtime_provisioner()->RuntimeProvisioner`. Status dict shape: `{"state","host","bytesDone","bytesTotal","reason"}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_onnx_runtime_provision.py
import hashlib
import io
import zipfile

import httpx
import pytest
import respx

from backend.services import onnx_runtime_provision as prov
from backend.services.onnx_runtime_manifest import RuntimeAsset


def _fake_wheel_bytes() -> bytes:
    """A real zip shaped like an onnxruntime wheel: an onnxruntime/ package + a dist-info file."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("onnxruntime/__init__.py", "# stub\n")
        z.writestr("onnxruntime/capi/onnxruntime.dll", b"\x00binary\x00")
        z.writestr("onnxruntime-9.9.9.dist-info/METADATA", "Name: onnxruntime\n")
    return buf.getvalue()


def _asset(url="https://pypi.example/onnxruntime-9.9.9-cp312-cp312-win_amd64.whl", body=None):
    body = body if body is not None else _fake_wheel_bytes()
    return RuntimeAsset(
        host_class="cpu", package="onnxruntime", version="9.9.9",
        wheel_url=url, sha256=hashlib.sha256(body).hexdigest(), size_bytes=len(body),
    )


@pytest.mark.asyncio
@respx.mock
async def test_ensure_downloads_verifies_extracts_and_installs(tmp_path, monkeypatch):
    body = _fake_wheel_bytes()
    asset = _asset(body=body)
    monkeypatch.setitem(prov._install_manifest_for_test(), "cpu", asset)  # helper below
    respx.get(asset.wheel_url).mock(return_value=httpx.Response(200, content=body))

    mgr = prov.RuntimeProvisioner(runtime_dir=tmp_path)
    await mgr.ensure("cpu")

    st = mgr.status()
    assert st["state"] == "done", st
    assert (tmp_path / "cpu" / "onnxruntime" / "__init__.py").read_text().startswith("# stub")
    assert (tmp_path / "cpu" / ".installed").read_text().strip() == "9.9.9"
    assert mgr.is_installed("cpu") is True


@pytest.mark.asyncio
@respx.mock
async def test_ensure_follows_redirect(tmp_path, monkeypatch):
    body = _fake_wheel_bytes()
    asset = _asset(body=body)
    monkeypatch.setitem(prov._install_manifest_for_test(), "cpu", asset)
    cdn = "https://cdn.example/onnxruntime.whl"
    respx.get(asset.wheel_url).mock(return_value=httpx.Response(302, headers={"location": cdn}))
    respx.get(cdn).mock(return_value=httpx.Response(200, content=body))

    mgr = prov.RuntimeProvisioner(runtime_dir=tmp_path)
    await mgr.ensure("cpu")
    assert mgr.status()["state"] == "done"


@pytest.mark.asyncio
@respx.mock
async def test_ensure_checksum_mismatch_errors(tmp_path, monkeypatch):
    good = _fake_wheel_bytes()
    asset = _asset(body=good)  # sha of `good`
    monkeypatch.setitem(prov._install_manifest_for_test(), "cpu", asset)
    respx.get(asset.wheel_url).mock(return_value=httpx.Response(200, content=b"corrupted"))

    mgr = prov.RuntimeProvisioner(runtime_dir=tmp_path)
    await mgr.ensure("cpu")
    st = mgr.status()
    assert st["state"] == "error" and st["reason"] == "checksum_mismatch"
    assert not (tmp_path / "cpu").exists()


@pytest.mark.asyncio
async def test_ensure_noop_when_installed(tmp_path, monkeypatch):
    asset = _asset()
    monkeypatch.setitem(prov._install_manifest_for_test(), "cpu", asset)
    # pre-install
    (tmp_path / "cpu" / "onnxruntime").mkdir(parents=True)
    (tmp_path / "cpu" / ".installed").write_text("9.9.9")
    mgr = prov.RuntimeProvisioner(runtime_dir=tmp_path)
    await mgr.ensure("cpu")  # must not raise / not download
    assert mgr.status()["state"] == "done"
```

Note the test uses a helper `prov._install_manifest_for_test()` returning the live manifest dict so tests can inject a fake asset. Implement it in Step 3 as a thin accessor to the Task-1 manifest.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_onnx_runtime_provision.py -o addopts="" -q`
Expected: FAIL (`ModuleNotFoundError: backend.services.onnx_runtime_provision`).

- [ ] **Step 3: Write minimal implementation**

```python
# backend/services/onnx_runtime_provision.py
"""On-demand download + install of the host-appropriate onnxruntime wheel.

Mirrors backend.services.model_assets.ModelDownloadManager: stream the pinned
wheel (follow_redirects), sha256-verify as it streams, extract the `onnxruntime/`
package from the wheel zip into a temp dir, then atomically rename it into
`<app-data>/runtime/<host_class>/`. Every failure path records a typed `error`
state and never crashes the caller's background task.
"""
from __future__ import annotations

import asyncio
import hashlib
import shutil
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx
import structlog

from backend.services.onnx_runtime_manifest import (
    RuntimeAsset,
    _RUNTIME_MANIFEST,
    get_runtime_asset,
)
from backend.services.platform import get_app_data_dir

logger = structlog.get_logger(__name__)

_CHUNK = 1024 * 1024
_TIMEOUT = httpx.Timeout(30.0, read=120.0)
_PROGRESS_LOG_EVERY = 16 * 1024 * 1024  # 16 MiB — throttle debug progress logs

ProvisionState = Literal[
    "idle", "downloading", "verifying", "extracting", "done", "error", "cancelled"
]


def _install_manifest_for_test() -> dict[str, RuntimeAsset]:
    """The live manifest dict — tests `monkeypatch.setitem` a fake asset onto it."""
    return _RUNTIME_MANIFEST


class _Cancelled(Exception):
    pass


class _ChecksumMismatch(RuntimeError):
    pass


@dataclass
class _Status:
    state: ProvisionState = "idle"
    host: str | None = None
    bytes_done: int = 0
    bytes_total: int = 0
    reason: str | None = None

    def as_dict(self) -> dict:
        return {
            "state": self.state,
            "host": self.host,
            "bytesDone": self.bytes_done,
            "bytesTotal": self.bytes_total,
            "reason": self.reason,
        }


class RuntimeProvisioner:
    def __init__(
        self,
        runtime_dir: Path | None = None,
        http_client_factory: Callable[[], httpx.AsyncClient] | None = None,
    ) -> None:
        self._runtime_dir_override = runtime_dir
        self._http = http_client_factory or (
            lambda: httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True)
        )
        self._status = _Status()
        self._cancel = asyncio.Event()
        self._lock = asyncio.Lock()

    def _runtime_dir(self) -> Path:
        if self._runtime_dir_override is not None:
            return self._runtime_dir_override
        return get_app_data_dir() / "runtime"

    def install_dir(self, host_class: str) -> Path:
        return self._runtime_dir() / host_class

    def is_installed(self, host_class: str) -> bool:
        asset = get_runtime_asset(host_class)
        if asset is None:
            return False
        marker = self.install_dir(host_class) / ".installed"
        return (
            marker.exists()
            and marker.read_text(encoding="utf-8").strip() == asset.version
            and (self.install_dir(host_class) / "onnxruntime").is_dir()
        )

    def status(self) -> dict:
        return self._status.as_dict()

    async def ensure(self, host_class: str) -> None:
        asset = get_runtime_asset(host_class)
        if asset is None:
            self._status = _Status(state="error", host=host_class, reason="no_manifest")
            logger.error(
                "onnx_runtime.provision_failed",
                host_class=host_class, reason="no_manifest", status=None,
                error="no manifest entry",
            )
            return
        if self.is_installed(host_class):
            self._status = _Status(
                state="done", host=host_class,
                bytes_total=asset.size_bytes, bytes_done=asset.size_bytes,
            )
            return
        async with self._lock:
            if self._status.state in ("downloading", "verifying", "extracting"):
                return
            self._status = _Status(
                state="downloading", host=host_class, bytes_total=asset.size_bytes
            )
            self._cancel = asyncio.Event()
        await self._provision(asset)

    async def _provision(self, asset: RuntimeAsset) -> None:
        target = self.install_dir(asset.host_class)
        tmp = self._runtime_dir() / f".{asset.host_class}.extract"
        wheel_tmp = self._runtime_dir() / f".{asset.host_class}.whl"
        logger.info(
            "onnx_runtime.provision_started",
            host_class=asset.host_class, package=asset.package,
            version=asset.version, url=asset.wheel_url, size_bytes=asset.size_bytes,
        )
        try:
            self._runtime_dir().mkdir(parents=True, exist_ok=True)
            if tmp.exists():
                shutil.rmtree(tmp, ignore_errors=True)
            wheel_tmp.unlink(missing_ok=True)

            hasher = hashlib.sha256()
            downloaded = 0
            next_log = _PROGRESS_LOG_EVERY
            async with self._http() as client:
                async with client.stream("GET", asset.wheel_url) as resp:
                    if resp.status_code != 200:
                        logger.error(
                            "onnx_runtime.download_http_status",
                            host_class=asset.host_class,
                            status=resp.status_code, final_url=str(resp.url),
                        )
                    resp.raise_for_status()
                    with wheel_tmp.open("wb") as f:
                        async for chunk in resp.aiter_bytes(_CHUNK):
                            if self._cancel.is_set():
                                raise _Cancelled()
                            f.write(chunk)
                            hasher.update(chunk)
                            downloaded += len(chunk)
                            self._status.bytes_done = downloaded
                            if downloaded >= next_log:
                                logger.debug(
                                    "onnx_runtime.download_progress",
                                    host_class=asset.host_class,
                                    bytes_done=downloaded, bytes_total=asset.size_bytes,
                                )
                                next_log += _PROGRESS_LOG_EVERY

            self._status.state = "verifying"
            digest = hasher.hexdigest()
            if digest != asset.sha256:
                raise _ChecksumMismatch(
                    f"{asset.package}: expected {asset.sha256}, got {digest}"
                )
            logger.info("onnx_runtime.verified", host_class=asset.host_class, sha256_ok=True)

            self._status.state = "extracting"
            logger.info("onnx_runtime.extract_started", host_class=asset.host_class, dest=str(tmp))
            tmp.mkdir(parents=True)
            count = 0
            with zipfile.ZipFile(wheel_tmp) as z:
                for name in z.namelist():
                    if name.startswith("onnxruntime/"):
                        z.extract(name, tmp)
                        count += 1
            logger.info(
                "onnx_runtime.extract_done",
                host_class=asset.host_class, files=count, dest=str(tmp),
            )

            (tmp / ".installed").write_text(asset.version, encoding="utf-8")
            if target.exists():
                shutil.rmtree(target)
            tmp.rename(target)  # atomic on the same filesystem
            wheel_tmp.unlink(missing_ok=True)
            self._status.state = "done"
            logger.info(
                "onnx_runtime.provision_complete",
                host_class=asset.host_class, version=asset.version, dest=str(target),
            )
        except _Cancelled:
            self._status.state = "cancelled"
            logger.info("onnx_runtime.provision_cancelled", host_class=asset.host_class)
            shutil.rmtree(tmp, ignore_errors=True)
            wheel_tmp.unlink(missing_ok=True)
        except Exception as exc:  # noqa: BLE001 - record a typed error state, never crash the task
            self._status.state = "error"
            if isinstance(exc, _ChecksumMismatch):
                self._status.reason = "checksum_mismatch"
            elif isinstance(exc, zipfile.BadZipFile):
                self._status.reason = "extract_failed"
            else:
                self._status.reason = "network_error"
            status_code = (
                exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
            )
            logger.error(
                "onnx_runtime.provision_failed",
                host_class=asset.host_class, reason=self._status.reason,
                status=status_code, error=str(exc),
            )
            shutil.rmtree(tmp, ignore_errors=True)
            wheel_tmp.unlink(missing_ok=True)

    def cancel(self) -> bool:
        if self._status.state not in ("downloading", "verifying", "extracting"):
            return False
        self._cancel.set()
        return True


_provisioner: RuntimeProvisioner | None = None


def get_runtime_provisioner() -> RuntimeProvisioner:
    global _provisioner
    if _provisioner is None:
        _provisioner = RuntimeProvisioner()
    return _provisioner
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run python -m pytest tests/test_onnx_runtime_provision.py -o addopts="" -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/onnx_runtime_provision.py tests/test_onnx_runtime_provision.py
git commit -m "feat(runtime): RuntimeProvisioner (download/verify/extract/install onnxruntime wheel)"
```

---

### Task 3: runtime_loader (bootstrap onnxruntime importability)

**Files:**
- Create: `backend/services/onnx_runtime_loader.py`
- Test: `tests/test_onnx_runtime_loader.py`

**Interfaces:**
- Consumes: `select_runtime_host_class` (Task 1), `get_runtime_provisioner().install_dir` (Task 2).
- Produces: `ensure_onnxruntime_importable() -> Literal["bundled","loaded","missing"]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_onnx_runtime_loader.py
import sys

from backend.services import onnx_runtime_loader as loader
from backend.services import onnx_runtime_provision as prov


def test_bundled_when_onnxruntime_importable(monkeypatch):
    monkeypatch.setattr(loader.importlib.util, "find_spec", lambda name: object())
    assert loader.ensure_onnxruntime_importable() == "bundled"


def test_missing_when_no_runtime(monkeypatch, tmp_path):
    monkeypatch.setattr(loader.importlib.util, "find_spec", lambda name: None)
    monkeypatch.setattr(loader, "select_runtime_host_class", lambda: "cpu")
    monkeypatch.setattr(prov, "_provisioner", prov.RuntimeProvisioner(runtime_dir=tmp_path))
    assert loader.ensure_onnxruntime_importable() == "missing"


def test_loaded_when_runtime_present(monkeypatch, tmp_path):
    monkeypatch.setattr(loader.importlib.util, "find_spec", lambda name: None)
    monkeypatch.setattr(loader, "select_runtime_host_class", lambda: "cpu")
    monkeypatch.setattr(prov, "_provisioner", prov.RuntimeProvisioner(runtime_dir=tmp_path))
    (tmp_path / "cpu" / "onnxruntime" / "capi").mkdir(parents=True)
    (tmp_path / "cpu" / "onnxruntime" / "__init__.py").write_text("# stub")

    result = loader.ensure_onnxruntime_importable()
    assert result == "loaded"
    assert str(tmp_path / "cpu") in sys.path
    sys.path.remove(str(tmp_path / "cpu"))  # cleanup
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_onnx_runtime_loader.py -o addopts="" -q`
Expected: FAIL (`ModuleNotFoundError: backend.services.onnx_runtime_loader`).

- [ ] **Step 3: Write minimal implementation**

```python
# backend/services/onnx_runtime_loader.py
"""Make onnxruntime importable: from the venv (dev) or a downloaded runtime (packaged).

MUST run before any `import onnxruntime` (i.e. before the embedder module is
first imported). Idempotent.
"""
from __future__ import annotations

import importlib
import importlib.util
import os
import sys
from typing import Literal

import structlog

from backend.services.onnx_runtime_manifest import select_runtime_host_class
from backend.services.onnx_runtime_provision import get_runtime_provisioner

logger = structlog.get_logger(__name__)

LoaderResult = Literal["bundled", "loaded", "missing"]


def ensure_onnxruntime_importable() -> LoaderResult:
    try:
        if importlib.util.find_spec("onnxruntime") is not None:
            logger.debug("runtime_loader.onnxruntime_bundled")
            return "bundled"
    except (ImportError, ValueError):
        pass  # a broken partial path -> treat as not importable, fall through

    host = select_runtime_host_class()
    install = get_runtime_provisioner().install_dir(host)
    pkg = install / "onnxruntime"
    if pkg.is_dir():
        capi = pkg / "capi"
        if capi.is_dir():
            try:
                os.add_dll_directory(str(capi))
            except (OSError, AttributeError):
                pass  # non-Windows / already added
        if str(install) not in sys.path:
            sys.path.insert(0, str(install))
        importlib.invalidate_caches()
        logger.info("runtime_loader.loaded_downloaded", host_class=host, path=str(pkg))
        return "loaded"

    logger.info("runtime_loader.runtime_missing", host_class=host, expected_path=str(pkg))
    return "missing"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_onnx_runtime_loader.py -o addopts="" -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/onnx_runtime_loader.py tests/test_onnx_runtime_loader.py
git commit -m "feat(runtime): runtime_loader bootstraps onnxruntime (venv or downloaded)"
```

---

### Task 4: Status endpoint `GET /api/ai/runtime/status`

**Files:**
- Modify: `backend/api/ai.py` (add the route near the existing `GET /api/ai/models/download/status`)
- Test: `tests/test_api_runtime_status.py`

**Interfaces:**
- Consumes: `get_runtime_provisioner().status()` (Task 2).
- Produces: `GET /api/ai/runtime/status` → the provisioner status dict.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_api_runtime_status.py
def test_runtime_status_endpoint(client):
    resp = client.get("/api/ai/runtime/status")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) >= {"state", "host", "bytesDone", "bytesTotal", "reason"}
    assert body["state"] in ("idle", "downloading", "verifying", "extracting", "done", "error", "cancelled")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_api_runtime_status.py -o addopts="" -q`
Expected: FAIL (404 → assertion on status_code).

- [ ] **Step 3: Write minimal implementation**

Add near the top imports of `backend/api/ai.py`:
```python
from backend.services.onnx_runtime_provision import get_runtime_provisioner
```
Add the route (place it beside the model-download status route):
```python
@router.get("/runtime/status")
async def runtime_status() -> dict:
    """Progress of the on-demand onnxruntime download (mirrors /models/download/status)."""
    return get_runtime_provisioner().status()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_api_runtime_status.py -o addopts="" -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api/ai.py tests/test_api_runtime_status.py
git commit -m "feat(runtime): GET /api/ai/runtime/status endpoint"
```

---

### Task 5: Readiness `runtime` probe + auto-trigger

**Files:**
- Modify: `backend/services/knowledge_service.py` — `compute_readiness()` adds a `runtime` key and, when missing + KB enabled, fires a tracked provisioning task.
- Test: `tests/test_runtime_readiness.py`

**Interfaces:**
- Consumes: `ensure_onnxruntime_importable` (Task 3), `select_runtime_host_class` (Task 1), `get_runtime_provisioner` (Task 2), the existing `backend.services.background_tasks.track_background_task` (verify the exact import path used by `model_assets` callers in `ai.py`).
- Produces: `compute_readiness()` result gains `"runtime": {"ok": bool, "state": str, "host": str}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_runtime_readiness.py
import pytest

from backend.services import knowledge_service as ks


@pytest.mark.asyncio
async def test_readiness_includes_runtime_probe(monkeypatch):
    monkeypatch.setattr(ks, "ensure_onnxruntime_importable", lambda: "bundled")
    result = await ks.compute_readiness()
    assert "runtime" in result
    assert result["runtime"]["ok"] is True
    assert result["runtime"]["state"] in ("bundled", "done")


@pytest.mark.asyncio
async def test_readiness_runtime_missing_reports_not_ok(monkeypatch):
    monkeypatch.setattr(ks, "ensure_onnxruntime_importable", lambda: "missing")
    monkeypatch.setattr(ks, "select_runtime_host_class", lambda: "cpu")
    result = await ks.compute_readiness()
    assert result["runtime"]["ok"] is False
    assert result["runtime"]["state"] in ("missing", "downloading")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_runtime_readiness.py -o addopts="" -q`
Expected: FAIL (`KeyError: 'runtime'`).

- [ ] **Step 3: Write minimal implementation**

Add imports to `backend/services/knowledge_service.py`:
```python
from backend.services.onnx_runtime_loader import ensure_onnxruntime_importable
from backend.services.onnx_runtime_manifest import select_runtime_host_class
from backend.services.onnx_runtime_provision import get_runtime_provisioner
```
Add a helper and call it inside `compute_readiness()` (merge into the returned dict):
```python
def _runtime_probe() -> dict:
    """Runtime readiness: bundled (dev) or downloaded => ok; otherwise report the
    provisioner's live download state so the UI can show progress."""
    result = ensure_onnxruntime_importable()
    if result in ("bundled", "loaded"):
        return {"ok": True, "state": result, "host": select_runtime_host_class()}
    prov_status = get_runtime_provisioner().status()
    return {"ok": False, "state": prov_status["state"] if prov_status["state"] != "idle" else "missing",
            "host": select_runtime_host_class()}
```
In `compute_readiness()`, add `"runtime": _runtime_probe()` to the returned dict.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_runtime_readiness.py -o addopts="" -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/knowledge_service.py tests/test_runtime_readiness.py
git commit -m "feat(runtime): readiness runtime probe (bundled/loaded/missing)"
```

---

### Task 6: Wire the bootstrap + auto-trigger into startup and the embedder path

**Files:**
- Modify: `backend/main.py` — call `ensure_onnxruntime_importable()` during startup (after logging is configured, before serving).
- Modify: `backend/services/knowledge_service.py` — in `_ensure_embedder()` (the lazy embedder builder), before importing/building the embedder: call `ensure_onnxruntime_importable()`; if it returns `"missing"`, kick off `track_background_task(get_runtime_provisioner().ensure(select_runtime_host_class()), name="runtime_provision")` and raise the existing "not ready" signal (mirror how a missing embedding model is surfaced — reuse `EmbeddingModelMissing` sibling or add a `RuntimeMissing` that the `/ask` + index paths already translate into an SSE/readiness state).
- Test: `tests/test_embedder_runtime_gate.py`

**Interfaces:**
- Consumes: Task 3 loader, Task 2 provisioner, Task 1 selector, existing `track_background_task`.
- Produces: `_ensure_embedder()` no-ops the loader in dev; in a packaged/missing state it triggers provisioning and signals not-ready instead of crashing.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_embedder_runtime_gate.py
import pytest

from backend.services import knowledge_service as ks


@pytest.mark.asyncio
async def test_ensure_embedder_triggers_provision_when_runtime_missing(monkeypatch):
    calls = {}
    monkeypatch.setattr(ks, "ensure_onnxruntime_importable", lambda: "missing")
    monkeypatch.setattr(ks, "select_runtime_host_class", lambda: "directml")

    async def fake_ensure(host):
        calls["host"] = host

    monkeypatch.setattr(ks.get_runtime_provisioner(), "ensure", fake_ensure)
    monkeypatch.setattr(ks, "track_background_task", lambda coro, name=None: calls.setdefault("tracked", True) or __import__("asyncio").ensure_future(coro))

    svc = ks.get_knowledge_service()
    with pytest.raises(ks.RuntimeMissing):
        await svc._ensure_embedder()
    assert calls.get("tracked") is True
```

Note: adjust to the real `_ensure_embedder` signature/singleton accessor discovered in the file; if `_ensure_embedder` needs a service argument, construct via the test-friendly constructor already used in `knowledge_service` tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest tests/test_embedder_runtime_gate.py -o addopts="" -q`
Expected: FAIL (`AttributeError: RuntimeMissing` / loader not called).

- [ ] **Step 3: Write minimal implementation**

In `backend/services/knowledge_service.py`, define the signal (near `EmbeddingModelMissing`):
```python
class RuntimeMissing(Exception):
    """Raised when the ONNX runtime hasn't been downloaded yet; provisioning was triggered."""
```
At the top of `_ensure_embedder()` (before any embedder import/build):
```python
_loader = ensure_onnxruntime_importable()
if _loader == "missing":
    host = select_runtime_host_class()
    track_background_task(get_runtime_provisioner().ensure(host), name="runtime_provision")
    raise RuntimeMissing(f"onnx runtime provisioning started for host={host}")
```
Ensure the `/ask` and index-rebuild handlers translate `RuntimeMissing` the same way they handle `EmbeddingModelMissing` (a readiness/SSE "not ready", not a 500) — mirror those existing handlers.

In `backend/main.py`, in the startup path (after `configure_logging(...)`, before/at server startup):
```python
from backend.services.onnx_runtime_loader import ensure_onnxruntime_importable
ensure_onnxruntime_importable()  # dev: no-op; packaged: load a downloaded runtime if present
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest tests/test_embedder_runtime_gate.py -o addopts="" -q`
Expected: PASS.

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `uv run python -m pytest tests/ -o addopts="" -m "not integration" -q`
Expected: all pass except the pre-existing `test_startup.py::test_frontend_compilation` (env-only, unrelated).

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/services/knowledge_service.py tests/test_embedder_runtime_gate.py
git commit -m "feat(runtime): bootstrap at startup + gate embedder on runtime, auto-trigger provisioning"
```

---

### Task 7: Exclude onnxruntime from the PyInstaller bundle

**Files:**
- Modify: `tooling/build_windows.spec` — add `"onnxruntime"` to `Analysis(excludes=[...])`; leave numpy + tokenizers bundled.

**Interfaces:** none (build config).

- [ ] **Step 1: Modify the spec**

In `tooling/build_windows.spec`, change the `Analysis(...)` call's `excludes=[]` to:
```python
    excludes=['onnxruntime'],
```
(If `packages_to_collect` or `collect_all` includes `onnxruntime` transitively, ensure it is not in that list; `pysaka` collect must not re-add it — verify in Step 2.)

- [ ] **Step 2: Build and verify onnxruntime is NOT bundled**

Run: `powershell -ExecutionPolicy Bypass -File .\build.ps1`
Then verify:
```bash
test ! -d dist/SakaDesk/_internal/onnxruntime && echo "OK: onnxruntime excluded" || echo "FAIL: still bundled"
ls dist/SakaDesk/_internal/ | grep -iE "numpy|tokenizers" && echo "OK: numpy/tokenizers still present"
```
Expected: "OK: onnxruntime excluded" and numpy/tokenizers present.

- [ ] **Step 3: Commit**

```bash
git add tooling/build_windows.spec
git commit -m "build(runtime): exclude onnxruntime from the bundle (downloaded on demand)"
```

- [ ] **Step 4: Target-hardware manual verification (RTX 3090)**

Install the rebuilt exe (or run `dist/SakaDesk/SakaDesk.exe`), enable the KB, and confirm via `%LOCALAPPDATA%\SakaDesk\logs\debug.log`:
- `runtime_loader.runtime_missing` → `onnx_runtime.provision_started host_class=directml` → `onnx_runtime.provision_complete` → `runtime_loader.loaded_downloaded` → `onnx_embedder.provider_selected provider=DmlExecutionProvider`.
- The index builds and a KB question returns grounded answers.

---

## Notes for the implementer
- Discover exact call sites before editing: `compute_readiness` (Task 5) and `_ensure_embedder` (Task 6) live in `backend/services/knowledge_service.py`; read their current bodies and the `EmbeddingModelMissing` handling in `backend/api/ai.py` (`/ask`, index rebuild) and mirror it for `RuntimeMissing`.
- `track_background_task` import path: copy it from `backend/api/ai.py`'s existing model-download usage.
- Keep dev green: because onnxruntime is in the venv, `ensure_onnxruntime_importable()` returns `"bundled"` in every test/dev run, so provisioning never fires except in the Task-2/3 unit tests (which inject a `runtime_dir` and a stubbed `find_spec`).
