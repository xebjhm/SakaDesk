"""Regression tests for the in-app model-asset download (backend/services/model_assets.py)."""

import hashlib

import httpx
import pytest
import respx

from backend.services import model_assets
from backend.services.model_assets import (
    ModelAsset,
    ModelDownloadManager,
    ModelManifest,
)


@pytest.mark.asyncio
@respx.mock
async def test_download_follows_huggingface_redirect(tmp_path, monkeypatch):
    """A Hugging Face ``/resolve/`` URL 302-redirects to a CDN that serves the
    real bytes. The download must FOLLOW that redirect and fetch the content.

    Regression: httpx does not follow redirects by default, so without
    ``follow_redirects=True`` the client streamed the (empty) 302 body, the
    sha256 never matched, and the failure surfaced as a misleading
    ``checksum_mismatch``.
    """
    body = b"granite-onnx-bytes" * 5000
    sha = hashlib.sha256(body).hexdigest()
    resolve_url = "https://huggingface.co/test-org/test-model/resolve/deadbeef/model.bin"
    cdn_url = "https://cdn.example.com/xet-bridge/model.bin"

    manifest = ModelManifest(
        name="test-model",
        assets=(
            ModelAsset(
                filename="model.bin", url=resolve_url, sha256=sha, size_bytes=len(body)
            ),
        ),
    )
    monkeypatch.setitem(model_assets._MANIFESTS, "test-model", manifest)

    respx.get(resolve_url).mock(
        return_value=httpx.Response(302, headers={"location": cdn_url})
    )
    respx.get(cdn_url).mock(return_value=httpx.Response(200, content=body))

    # Construct with the PRODUCTION default http client factory (the code under test).
    manager = ModelDownloadManager(models_dir=tmp_path)
    await manager.start("test-model")

    status = manager.status()
    assert status["state"] == "done", f"expected done, got {status}"
    assert (tmp_path / "test-model" / "model.bin").read_bytes() == body
