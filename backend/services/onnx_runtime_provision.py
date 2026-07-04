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
