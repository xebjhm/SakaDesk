"""`_ensure_embedder()` gates on the ONNX runtime being importable (Task 6,
on-demand runtime provisioning plan).

Adapted from the plan's Step 1 sketch to the REAL `KnowledgeService` shape:
- `_ensure_embedder` is a private instance method on `KnowledgeService`, built
  via the same `KnowledgeService(store=..., embedder=None, llm=...)`
  constructor every other `backend/tests/test_knowledge_service.py` test uses
  (there is no bare, argument-less "test-friendly" constructor — the plan's
  note to "construct via the test-friendly constructor already used in
  knowledge_service tests" points at exactly this pattern).
- `ks.get_runtime_provisioner()` returns the module-level singleton directly
  (not a coroutine to await), so the fake `.ensure` is patched onto that
  object, matching `onnx_runtime_provision.RuntimeProvisioner.ensure`'s real
  `async def ensure(self, host_class: str) -> None` signature (positional
  host, not a bare callable).
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from backend.services import knowledge_service as ks
from backend.services.knowledge_store import SqliteKnowledgeStore


@pytest.mark.asyncio
async def test_ensure_embedder_triggers_provision_when_runtime_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = {}
    monkeypatch.setattr(ks, "ensure_onnxruntime_importable", lambda: "missing")
    monkeypatch.setattr(ks, "select_runtime_host_class", lambda: "directml")

    async def fake_ensure(host):
        calls["host"] = host

    monkeypatch.setattr(ks.get_runtime_provisioner(), "ensure", fake_ensure)

    tracked_tasks = []

    def fake_track(coro, *, name=None):
        calls["tracked"] = True
        calls["tracked_name"] = name
        task = asyncio.ensure_future(coro)
        tracked_tasks.append(task)
        return task

    monkeypatch.setattr(ks, "track_background_task", fake_track)

    store = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    svc = ks.KnowledgeService(store=store, embedder=None, llm=None)

    with pytest.raises(ks.RuntimeMissing):
        await svc._ensure_embedder()

    assert calls.get("tracked") is True
    assert calls.get("tracked_name") == "runtime_provision"

    # Let the tracked background task actually run so `fake_ensure` records
    # its host and the test doesn't leak a pending task.
    await asyncio.gather(*tracked_tasks)
    assert calls.get("host") == "directml"


@pytest.mark.asyncio
async def test_ensure_embedder_does_not_gate_when_runtime_bundled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Dev/test baseline: onnxruntime lives in the venv, so the loader
    reports "bundled" and `_ensure_embedder` behaves exactly as it did before
    this task (a missing embedding MODEL still returns `False`, never
    `RuntimeMissing`) -- the runtime gate must be a no-op here."""
    monkeypatch.setattr(ks, "ensure_onnxruntime_importable", lambda: "bundled")

    store = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    svc = ks.KnowledgeService(store=store, embedder=None, llm=None)

    result = await svc._ensure_embedder()

    assert result is False  # no model dir on disk; NOT a RuntimeMissing raise
