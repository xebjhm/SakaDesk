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
