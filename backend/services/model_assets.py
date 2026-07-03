"""In-app download of the pinned embedding-model ONNX assets (Product-wave Task 4, item 3).

Streams `granite-embedding-278m-multilingual`'s `model.onnx` + `tokenizer.json`
from a PINNED manifest (exact Hugging Face resolve URLs + sha256 + size, see
`_GRANITE_278M_MANIFEST`) into a temp directory, sha256-verifying each file as it
streams, then atomically renaming the whole temp dir into
``<app-data>/models/<name>/`` once every asset verifies -- so
`knowledge_service._build_embedder` can never see a partial or corrupt model dir;
it only ever exists once fully verified.

**Manifest provenance.** The pinned hashes were computed directly from the files
already installed on the reference dev machine
(``~/.SakaDesk/models/granite-embedding-278m-multilingual/``), NOT re-fetched or
recomputed from Hugging Face's (mutable) listing at download time -- so a
tampered/corrupted upstream file is caught by a hash MISMATCH, not silently
trusted. Verified via the HF tree API that `model.onnx` and `tokenizer.json` are
top-level files in the repo (no ``onnx/`` subdirectory, despite that being a
common HF layout for other models):
https://huggingface.co/ibm-granite/granite-embedding-278m-multilingual

**Revision pin (P-4 review, Finding 4 -- supply chain).** The manifest URLs
resolve a specific commit sha (``/resolve/<sha>/...``), NOT `/resolve/main/`:
`main` is a mutable ref an upstream maintainer can force-push or overwrite at
any time, which would silently start serving different bytes at the SAME url
this manifest already pins a sha256 for -- pinning the sha closes that
supply-chain gap (the sha256 check alone only catches a mismatch AFTER a
1GB+ download, this avoids ever fetching from a ref that could have moved).

    To refresh (e.g. onto a newer upstream revision with new pinned hashes):
    1. `curl https://huggingface.co/api/models/ibm-granite/granite-embedding-278m-multilingual`
       and read the top-level `"sha"` field -- that's the commit to pin.
    2. Download `model.onnx` + `tokenizer.json` at that commit and compute
       their sha256 (`sha256sum`) + byte size -- these become the new
       `sha256`/`size_bytes` in `_GRANITE_278M_MANIFEST` below.
    3. Replace the sha in both `url` fields below with the one from step 1.
    Never bump the sha alone without also recomputing the hashes in step 2 --
    a different commit is presumptively different bytes.

**Progress + status.** `ModelDownloadManager` is a small process-wide singleton
(mirrors `KnowledgeService`'s) tracking ONE in-flight download at a time;
`GET /api/ai/models/download/status` polls `status()` rather than folding this
into `/readiness` -- download progress changes many times a second while
installed-or-not is a coarse boolean, so keeping them separate lets the frontend
poll progress fast without re-running the (cheap, but not free) readiness probes
every tick. This is a deliberate choice documented here per the brief's
"pick one, document" instruction.

**Range-resume is explicitly OUT of scope for this (M-sized) task.** A leftover
partial temp dir from a killed/crashed previous attempt is discarded and the
download restarts from byte zero -- "resume" here means "cleanly start over
without stale/corrupt partial files confusing verification", not an HTTP
`Range:` resume of a partially-downloaded file.
"""

from __future__ import annotations

import asyncio
import hashlib
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx
import structlog

from backend.services.platform import get_app_data_dir

logger = structlog.get_logger(__name__)

_CHUNK_SIZE = 1024 * 1024  # 1 MiB
_DOWNLOAD_TIMEOUT = httpx.Timeout(30.0, read=120.0)


@dataclass(frozen=True)
class ModelAsset:
    """One file in a `ModelManifest`: where to fetch it and its pinned sha256."""

    filename: str
    url: str
    sha256: str
    size_bytes: int


@dataclass(frozen=True)
class ModelManifest:
    """A pinned, named set of `ModelAsset`s -- everything `OnnxEmbedder` needs."""

    name: str
    assets: tuple[ModelAsset, ...]

    @property
    def total_bytes(self) -> int:
        return sum(asset.size_bytes for asset in self.assets)


# Pinned to the `ibm-granite/granite-embedding-278m-multilingual` commit sha
# current as of this manifest's last refresh (2026-07-03) -- see the module
# docstring's "Revision pin" section for the refresh procedure and why `main`
# (a mutable ref) is deliberately never used here.
_PINNED_REVISION = "a9cb5338491faf32b73dd17b714a31821c021bbf"

_GRANITE_278M_MANIFEST = ModelManifest(
    name="granite-embedding-278m-multilingual",
    assets=(
        ModelAsset(
            filename="model.onnx",
            url=(
                "https://huggingface.co/ibm-granite/granite-embedding-278m-multilingual"
                f"/resolve/{_PINNED_REVISION}/model.onnx"
            ),
            sha256="aefac97b384f92932a61a19900d41c870679d5b8e6ceb682768eb153d0e31c7d",
            size_bytes=1_112_413_925,
        ),
        ModelAsset(
            filename="tokenizer.json",
            url=(
                "https://huggingface.co/ibm-granite/granite-embedding-278m-multilingual"
                f"/resolve/{_PINNED_REVISION}/tokenizer.json"
            ),
            sha256="2a0d7366dd7780ea36cc42431dd74cd79289b783ab01acd33013fcc96865a8e9",
            size_bytes=9_081_351,
        ),
    ),
)

_MANIFESTS: dict[str, ModelManifest] = {
    _GRANITE_278M_MANIFEST.name: _GRANITE_278M_MANIFEST
}


def get_manifest(model_name: str) -> ModelManifest | None:
    """The pinned `ModelManifest` for `model_name`, or `None` if unknown/unpinned."""
    return _MANIFESTS.get(model_name)


DownloadState = Literal[
    "idle", "downloading", "verifying", "done", "error", "cancelled"
]


class DownloadCancelled(Exception):
    """Raised internally to unwind the streaming loop when `cancel()` fires."""


class ChecksumMismatch(RuntimeError):
    """Raised internally when a downloaded file's sha256 doesn't match the manifest."""


@dataclass
class DownloadStatus:
    """`ModelDownloadManager.status()`'s snapshot -- see `as_dict` for the wire shape."""

    state: DownloadState = "idle"
    model: str | None = None
    bytes_done: int = 0
    bytes_total: int = 0
    reason: str | None = None

    def as_dict(self) -> dict:
        return {
            "state": self.state,
            "model": self.model,
            "bytesDone": self.bytes_done,
            "bytesTotal": self.bytes_total,
            "reason": self.reason,
        }


class ModelDownloadManager:
    """Orchestrates one in-app model download at a time.

    `models_dir` and `http_client_factory` are injectable for tests (a tmp dir,
    and a factory that yields an `httpx.AsyncClient` respx can intercept) --
    production code uses `get_model_download_manager()`, which defaults both to
    the real app-data `models/` dir and a real `httpx.AsyncClient`.
    """

    def __init__(
        self,
        models_dir: Path | None = None,
        http_client_factory: Callable[[], httpx.AsyncClient] | None = None,
    ) -> None:
        self._models_dir_override = models_dir
        self._http_client_factory = http_client_factory or (
            # follow_redirects: HF /resolve/ URLs 302/307-redirect to a CDN
            # (us.aws.cdn.hf.co). httpx does NOT follow redirects by default, so
            # without this the download fails on the redirect instead of fetching
            # the real bytes.
            lambda: httpx.AsyncClient(
                timeout=_DOWNLOAD_TIMEOUT, follow_redirects=True
            )
        )
        self._status = DownloadStatus()
        self._cancel_event = asyncio.Event()
        self._lock = asyncio.Lock()

    def status(self) -> dict:
        """A JSON-serializable snapshot of the current/last download."""
        return self._status.as_dict()

    def _resolve_models_dir(self) -> Path:
        return (
            self._models_dir_override
            if self._models_dir_override is not None
            else get_app_data_dir() / "models"
        )

    async def start(self, model_name: str) -> None:
        """Download `model_name`'s pinned assets, verify, and atomically install them.

        Raises `ValueError` if `model_name` has no pinned manifest, `RuntimeError`
        if a download is already in flight. Meant to be scheduled as a background
        task (`track_background_task`) by the caller -- this coroutine runs the
        WHOLE download to completion (or failure/cancellation) itself; poll
        `status()` for progress rather than awaiting this directly from a request
        handler.
        """
        manifest = get_manifest(model_name)
        if manifest is None:
            raise ValueError(f"no pinned manifest for model {model_name!r}")
        async with self._lock:
            if self._status.state in ("downloading", "verifying"):
                raise RuntimeError("a model download is already in progress")
            self._status = DownloadStatus(
                state="downloading", model=model_name, bytes_total=manifest.total_bytes
            )
            self._cancel_event = asyncio.Event()
        await self._run(manifest)

    async def _run(self, manifest: ModelManifest) -> None:
        """Download, verify, and atomically install `manifest`'s assets.

        The mkdir/rmtree PREAMBLE (P-4 review, Finding 4) lives INSIDE this
        try/except, not before it: a permission-denied or disk-full failure
        creating `models_dir`/`tmp_dir` used to raise straight out of `start()`
        (called from `backend/api/ai.py`'s fire-and-forget background task),
        leaving `self._status.state` stuck at `"downloading"` forever -- the
        poller (`GET .../download/status`) would show an in-progress download
        that had already silently died, with no way for the UI to ever detect
        or recover from it. Every exception path below (including one raised
        by the preamble itself) now reaches the `except Exception` branch and
        records a terminal `"error"` state.
        """
        models_dir = self._resolve_models_dir()
        tmp_dir = models_dir / f".{manifest.name}.download"
        logger.info(
            "model_assets.download_started",
            model=manifest.name,
            assets=len(manifest.assets),
            total_bytes=manifest.total_bytes,
        )
        try:
            models_dir.mkdir(parents=True, exist_ok=True)
            # A leftover partial dir from a previous crashed/killed/cancelled
            # attempt is discarded -- see module docstring's "range-resume out
            # of scope" note.
            if tmp_dir.exists():
                shutil.rmtree(tmp_dir, ignore_errors=True)
            tmp_dir.mkdir(parents=True)

            async with self._http_client_factory() as client:
                for asset in manifest.assets:
                    await self._download_one(client, asset, tmp_dir)
            self._status.state = "verifying"
            target_dir = models_dir / manifest.name
            if target_dir.exists():
                # Re-download replacing a previously-installed copy.
                shutil.rmtree(target_dir)
            tmp_dir.rename(target_dir)  # atomic on the same filesystem
            self._status.state = "done"
            logger.info("model_assets.download_complete", model=manifest.name)
        except DownloadCancelled:
            self._status.state = "cancelled"
            logger.info("model_assets.download_cancelled", model=manifest.name)
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception as exc:  # noqa: BLE001 - must record a typed error state, never crash the task
            self._status.state = "error"
            self._status.reason = (
                "checksum_mismatch"
                if isinstance(exc, ChecksumMismatch)
                else "download_failed"
            )
            logger.error(
                "model_assets.download_failed", model=manifest.name, error=str(exc)
            )
            shutil.rmtree(tmp_dir, ignore_errors=True)

    async def _download_one(
        self, client: httpx.AsyncClient, asset: ModelAsset, tmp_dir: Path
    ) -> None:
        dest = tmp_dir / asset.filename
        hasher = hashlib.sha256()
        bytes_done_before = self._status.bytes_done
        downloaded = 0
        logger.info(
            "model_assets.asset_download_started",
            asset=asset.filename,
            url=asset.url,
            size_bytes=asset.size_bytes,
        )
        async with client.stream("GET", asset.url) as response:
            # Log the actual HTTP status BEFORE raise_for_status so a redirect
            # (302/307) or 4xx/5xx is visible in logs rather than surfacing only
            # as a generic downstream failure.
            if response.status_code != 200:
                logger.error(
                    "model_assets.asset_http_status",
                    asset=asset.filename,
                    status=response.status_code,
                    final_url=str(response.url),
                )
            response.raise_for_status()
            with dest.open("wb") as f:
                async for chunk in response.aiter_bytes(_CHUNK_SIZE):
                    if self._cancel_event.is_set():
                        raise DownloadCancelled()
                    f.write(chunk)
                    hasher.update(chunk)
                    downloaded += len(chunk)
                    self._status.bytes_done = bytes_done_before + downloaded
        digest = hasher.hexdigest()
        if digest != asset.sha256:
            raise ChecksumMismatch(
                f"{asset.filename}: expected sha256 {asset.sha256}, got {digest}"
            )
        logger.info(
            "model_assets.asset_verified", asset=asset.filename, bytes=downloaded
        )

    def cancel(self) -> bool:
        """Signal an in-flight download to stop at the next chunk boundary.

        Returns `True` if a download was actually running (and therefore
        cancelled), `False` if there was nothing to cancel -- callers (the
        `DELETE` endpoint) use this to distinguish "cancelled" from "nothing
        was happening".
        """
        if self._status.state not in ("downloading", "verifying"):
            return False
        self._cancel_event.set()
        return True


_manager: ModelDownloadManager | None = None


def get_model_download_manager() -> ModelDownloadManager:
    """The process-wide `ModelDownloadManager` singleton (mirrors
    `knowledge_service.get_knowledge_service`'s pattern, minus the async lock --
    this constructor is cheap, no I/O)."""
    global _manager
    if _manager is None:
        _manager = ModelDownloadManager()
    return _manager
