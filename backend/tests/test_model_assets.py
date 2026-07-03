"""Tests for `backend/services/model_assets.py` -- in-app embedding-model download.

Network calls are mocked with `respx` (never a real HF request); `ModelDownloadManager`
is constructed with an isolated `tmp_path` `models_dir` so nothing touches real
app-data. Progress/cancellation are unit-tested against `_download_one` directly with
a hand-rolled fake client -- deterministic (no timing races), since the fake async
generator and the consumer run in the same task with no real concurrency.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import pytest
import respx

from backend.services.model_assets import (
    ChecksumMismatch,
    DownloadCancelled,
    DownloadStatus,
    ModelAsset,
    ModelDownloadManager,
    ModelManifest,
    get_manifest,
    get_model_download_manager,
)

_TEST_ASSET_A = ModelAsset(
    filename="model.onnx",
    url="https://example.invalid/model.onnx",
    sha256=hashlib.sha256(b"fake-onnx-weights").hexdigest(),
    size_bytes=len(b"fake-onnx-weights"),
)
_TEST_ASSET_B = ModelAsset(
    filename="tokenizer.json",
    url="https://example.invalid/tokenizer.json",
    sha256=hashlib.sha256(b"fake-tokenizer").hexdigest(),
    size_bytes=len(b"fake-tokenizer"),
)
_TEST_MANIFEST = ModelManifest(name="test-model", assets=(_TEST_ASSET_A, _TEST_ASSET_B))


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


def test_get_manifest_returns_pinned_granite_manifest() -> None:
    manifest = get_manifest("granite-embedding-278m-multilingual")
    assert manifest is not None
    assert {a.filename for a in manifest.assets} == {"model.onnx", "tokenizer.json"}
    assert all(len(a.sha256) == 64 for a in manifest.assets)
    assert manifest.total_bytes == sum(a.size_bytes for a in manifest.assets)


def test_get_manifest_returns_none_for_unknown_model() -> None:
    assert get_manifest("not-a-real-model") is None


def test_manifest_urls_are_pinned_to_a_commit_sha_not_the_mutable_main_ref() -> None:
    """Finding 4 (P-4 review), supply chain: `main` is a mutable ref an
    upstream maintainer can force-push/overwrite at any time, silently
    serving different bytes at the SAME url this manifest pins a sha256
    for -- the sha256 check alone only catches that AFTER a 1GB+ download.
    Every asset url must instead resolve a specific, immutable commit."""
    manifest = get_manifest("granite-embedding-278m-multilingual")
    assert manifest is not None
    for asset in manifest.assets:
        assert "/resolve/main/" not in asset.url
        assert "/resolve/" in asset.url
        revision = asset.url.split("/resolve/", 1)[1].split("/", 1)[0]
        # A git commit sha is 40 lowercase-hex characters -- not a movable
        # ref name like "main"/"master".
        assert len(revision) == 40
        assert all(c in "0123456789abcdef" for c in revision)


def test_download_status_as_dict_shape() -> None:
    status = DownloadStatus(
        state="downloading", model="m", bytes_done=1, bytes_total=2, reason=None
    )
    assert status.as_dict() == {
        "state": "downloading",
        "model": "m",
        "bytesDone": 1,
        "bytesTotal": 2,
        "reason": None,
    }


# ---------------------------------------------------------------------------
# Progress + cancellation -- unit-tested against `_download_one` directly
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, chunks: list[bytes], on_before_chunk=None) -> None:
        self._chunks = chunks
        self._on_before_chunk = on_before_chunk

    def raise_for_status(self) -> None:
        pass

    async def aiter_bytes(self, chunk_size: int):
        for chunk in self._chunks:
            if self._on_before_chunk is not None:
                self._on_before_chunk()
            yield chunk


class _FakeStreamCtx:
    def __init__(self, response: _FakeResponse) -> None:
        self._response = response

    async def __aenter__(self) -> _FakeResponse:
        return self._response

    async def __aexit__(self, *exc_info: object) -> bool:
        return False


class _FakeClient:
    def __init__(self, response: _FakeResponse) -> None:
        self._response = response

    def stream(self, method: str, url: str) -> _FakeStreamCtx:
        return _FakeStreamCtx(self._response)


@pytest.mark.asyncio
async def test_download_one_reports_incremental_progress(tmp_path: Path) -> None:
    manager = ModelDownloadManager(models_dir=tmp_path / "models")
    manager._status = DownloadStatus(state="downloading", model="t", bytes_total=9)
    asset = ModelAsset(
        filename="f.bin",
        url="https://example.invalid/f.bin",
        sha256=hashlib.sha256(b"abcdefghi").hexdigest(),
        size_bytes=9,
    )
    observed_before_each_chunk: list[int] = []

    def _record() -> None:
        observed_before_each_chunk.append(manager.status()["bytesDone"])

    response = _FakeResponse([b"abc", b"def", b"ghi"], on_before_chunk=_record)
    tmp_dir = tmp_path / "download-tmp"
    tmp_dir.mkdir(parents=True)

    await manager._download_one(_FakeClient(response), asset, tmp_dir)

    # bytesDone reflects only PRIOR chunks at the moment each new chunk is about
    # to be produced -- proof progress advances incrementally, not 0 -> 100 in one jump.
    assert observed_before_each_chunk == [0, 3, 6]
    assert manager.status()["bytesDone"] == 9
    assert (tmp_dir / "f.bin").read_bytes() == b"abcdefghi"


@pytest.mark.asyncio
async def test_download_one_raises_checksum_mismatch_on_bad_hash(
    tmp_path: Path,
) -> None:
    manager = ModelDownloadManager(models_dir=tmp_path / "models")
    manager._status = DownloadStatus(state="downloading", model="t", bytes_total=3)
    asset = ModelAsset(
        filename="f.bin",
        url="https://example.invalid/f.bin",
        sha256="0" * 64,  # deliberately wrong
        size_bytes=3,
    )
    response = _FakeResponse([b"abc"])
    tmp_dir = tmp_path / "download-tmp"
    tmp_dir.mkdir(parents=True)

    with pytest.raises(ChecksumMismatch):
        await manager._download_one(_FakeClient(response), asset, tmp_dir)


@pytest.mark.asyncio
async def test_download_one_stops_writing_once_cancelled_mid_stream(
    tmp_path: Path,
) -> None:
    manager = ModelDownloadManager(models_dir=tmp_path / "models")
    manager._status = DownloadStatus(state="downloading", model="t", bytes_total=6)
    asset = ModelAsset(
        filename="f.bin",
        url="https://example.invalid/f.bin",
        sha256=hashlib.sha256(b"abcdef").hexdigest(),
        size_bytes=6,
    )
    call_count = {"n": 0}

    def _cancel_after_first_chunk() -> None:
        call_count["n"] += 1
        if call_count["n"] == 2:  # about to produce the SECOND chunk
            manager.cancel()

    response = _FakeResponse(
        [b"abc", b"def"], on_before_chunk=_cancel_after_first_chunk
    )
    tmp_dir = tmp_path / "download-tmp"
    tmp_dir.mkdir(parents=True)

    with pytest.raises(DownloadCancelled):
        await manager._download_one(_FakeClient(response), asset, tmp_dir)

    # Only the first chunk was ever written -- the second was never persisted.
    assert (tmp_dir / "f.bin").read_bytes() == b"abc"


def test_cancel_returns_false_when_nothing_running(tmp_path: Path) -> None:
    manager = ModelDownloadManager(models_dir=tmp_path / "models")
    assert manager.cancel() is False


# ---------------------------------------------------------------------------
# `start()` / `_run()` -- full flow via respx-mocked httpx
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_start_raises_for_unknown_model(tmp_path: Path) -> None:
    manager = ModelDownloadManager(models_dir=tmp_path / "models")
    with pytest.raises(ValueError, match="no pinned manifest"):
        await manager.start("not-a-real-model")


@pytest.mark.asyncio
async def test_start_raises_when_already_in_progress(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import backend.services.model_assets as mod

    monkeypatch.setitem(mod._MANIFESTS, "test-model", _TEST_MANIFEST)
    manager = ModelDownloadManager(models_dir=tmp_path / "models")
    manager._status = DownloadStatus(state="downloading", model="test-model")
    with pytest.raises(RuntimeError, match="already in progress"):
        await manager.start("test-model")


@pytest.mark.asyncio
@respx.mock
async def test_start_downloads_verifies_and_atomically_installs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import backend.services.model_assets as mod

    monkeypatch.setitem(mod._MANIFESTS, "test-model", _TEST_MANIFEST)
    respx.get(_TEST_ASSET_A.url).mock(
        return_value=httpx.Response(200, content=b"fake-onnx-weights")
    )
    respx.get(_TEST_ASSET_B.url).mock(
        return_value=httpx.Response(200, content=b"fake-tokenizer")
    )
    models_dir = tmp_path / "models"
    manager = ModelDownloadManager(models_dir=models_dir)

    await manager.start("test-model")

    status = manager.status()
    assert status["state"] == "done"
    assert status["bytesDone"] == status["bytesTotal"]
    target = models_dir / "test-model"
    assert (target / "model.onnx").read_bytes() == b"fake-onnx-weights"
    assert (target / "tokenizer.json").read_bytes() == b"fake-tokenizer"
    # No leftover temp/partial directory once installed.
    assert not (models_dir / ".test-model.download").exists()


@pytest.mark.asyncio
@respx.mock
async def test_checksum_mismatch_sets_error_state_and_cleans_up(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import backend.services.model_assets as mod

    monkeypatch.setitem(mod._MANIFESTS, "test-model", _TEST_MANIFEST)
    respx.get(_TEST_ASSET_A.url).mock(
        return_value=httpx.Response(200, content=b"WRONG CONTENT, WRONG HASH")
    )
    respx.get(_TEST_ASSET_B.url).mock(
        return_value=httpx.Response(200, content=b"fake-tokenizer")
    )
    models_dir = tmp_path / "models"
    manager = ModelDownloadManager(models_dir=models_dir)

    await manager.start("test-model")

    status = manager.status()
    assert status["state"] == "error"
    assert status["reason"] == "checksum_mismatch"
    # Neither the target dir nor a leftover partial temp dir exist.
    assert not (models_dir / "test-model").exists()
    assert not (models_dir / ".test-model.download").exists()


@pytest.mark.asyncio
@respx.mock
async def test_http_failure_sets_error_state_and_cleans_up(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import backend.services.model_assets as mod

    monkeypatch.setitem(mod._MANIFESTS, "test-model", _TEST_MANIFEST)
    respx.get(_TEST_ASSET_A.url).mock(return_value=httpx.Response(404))
    models_dir = tmp_path / "models"
    manager = ModelDownloadManager(models_dir=models_dir)

    await manager.start("test-model")

    status = manager.status()
    assert status["state"] == "error"
    assert status["reason"] == "download_failed"
    assert not (models_dir / "test-model").exists()
    assert not (models_dir / ".test-model.download").exists()


@pytest.mark.asyncio
async def test_mkdir_failure_before_any_network_call_sets_error_not_stuck_downloading(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Finding 4 (P-4 review): a failure creating `models_dir`/the temp
    download dir (permission denied, disk full, ...) must land in the
    terminal `"error"` state, never leave `status()` stuck reporting
    `"downloading"` forever. The mkdir/rmtree preamble used to run BEFORE
    the try/except in `_run` -- any exception there propagated straight out
    of the background task with no state ever recorded, so the UI's poller
    would show a phantom in-progress download that had already silently
    died. Simulated here with a plain FILE sitting where `models_dir` needs
    to be a directory (`Path.mkdir(exist_ok=True)` raises `FileExistsError`
    for a non-directory occupant) -- same "preamble raises before any
    network call" code path a real permission/disk error would hit.
    """
    import backend.services.model_assets as mod

    monkeypatch.setitem(mod._MANIFESTS, "test-model", _TEST_MANIFEST)
    models_dir = tmp_path / "models"
    models_dir.write_text("not a directory", encoding="utf-8")
    manager = ModelDownloadManager(models_dir=models_dir)

    await manager.start("test-model")

    status = manager.status()
    assert status["state"] == "error"
    assert status["reason"] == "download_failed"


@pytest.mark.asyncio
@respx.mock
async def test_stale_partial_temp_dir_is_discarded_before_fresh_start(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A leftover `.{name}.download` dir from a previous crashed attempt must
    not corrupt a fresh restart (Range-resume is explicitly out of scope --
    see module docstring; this asserts the "start clean" half of that)."""
    import backend.services.model_assets as mod

    monkeypatch.setitem(mod._MANIFESTS, "test-model", _TEST_MANIFEST)
    respx.get(_TEST_ASSET_A.url).mock(
        return_value=httpx.Response(200, content=b"fake-onnx-weights")
    )
    respx.get(_TEST_ASSET_B.url).mock(
        return_value=httpx.Response(200, content=b"fake-tokenizer")
    )
    models_dir = tmp_path / "models"
    stale_tmp = models_dir / ".test-model.download"
    stale_tmp.mkdir(parents=True)
    (stale_tmp / "model.onnx").write_bytes(b"leftover garbage from a crash")
    manager = ModelDownloadManager(models_dir=models_dir)

    await manager.start("test-model")

    assert manager.status()["state"] == "done"
    assert (
        models_dir / "test-model" / "model.onnx"
    ).read_bytes() == b"fake-onnx-weights"


@pytest.mark.asyncio
@respx.mock
async def test_start_cancelled_between_assets_sets_cancelled_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import backend.services.model_assets as mod

    monkeypatch.setitem(mod._MANIFESTS, "test-model", _TEST_MANIFEST)
    respx.get(_TEST_ASSET_A.url).mock(
        return_value=httpx.Response(200, content=b"fake-onnx-weights")
    )
    # Mocked (even though never actually reached with real content) so the
    # SECOND asset's real `_download_one` reaches its cancel-event check
    # inside the streaming loop instead of failing on an unmocked request.
    respx.get(_TEST_ASSET_B.url).mock(
        return_value=httpx.Response(200, content=b"fake-tokenizer")
    )
    models_dir = tmp_path / "models"
    manager = ModelDownloadManager(models_dir=models_dir)

    original_download_one = manager._download_one

    async def _download_one_then_cancel(client, asset, tmp_dir):
        await original_download_one(client, asset, tmp_dir)
        if asset is _TEST_ASSET_A:
            manager.cancel()

    manager._download_one = _download_one_then_cancel  # type: ignore[method-assign]

    await manager.start("test-model")

    status = manager.status()
    assert status["state"] == "cancelled"
    assert not (models_dir / "test-model").exists()
    assert not (models_dir / ".test-model.download").exists()


@pytest.mark.asyncio
@respx.mock
async def test_redownload_replaces_a_previously_installed_model(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import backend.services.model_assets as mod

    monkeypatch.setitem(mod._MANIFESTS, "test-model", _TEST_MANIFEST)
    respx.get(_TEST_ASSET_A.url).mock(
        return_value=httpx.Response(200, content=b"fake-onnx-weights")
    )
    respx.get(_TEST_ASSET_B.url).mock(
        return_value=httpx.Response(200, content=b"fake-tokenizer")
    )
    models_dir = tmp_path / "models"
    existing = models_dir / "test-model"
    existing.mkdir(parents=True)
    (existing / "stale-leftover-file").write_text("old install", encoding="utf-8")
    manager = ModelDownloadManager(models_dir=models_dir)

    await manager.start("test-model")

    assert manager.status()["state"] == "done"
    assert (existing / "model.onnx").read_bytes() == b"fake-onnx-weights"
    assert not (existing / "stale-leftover-file").exists()


def test_get_model_download_manager_returns_singleton() -> None:
    from backend.services import model_assets as mod

    mod._manager = None
    first = get_model_download_manager()
    second = get_model_download_manager()
    assert first is second
    mod._manager = None
