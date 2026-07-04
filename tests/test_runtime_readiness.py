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
