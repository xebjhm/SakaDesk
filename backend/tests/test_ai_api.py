"""Tests for `/api/ai` -- two-pass SSE `/ask`, index status/rebuild, hardware
suggestion, and LLM config endpoints.

`get_knowledge_service` is patched with an `AsyncMock` per test (mirroring
`test_search_api.py`'s `_mock_search_service` pattern) so these tests never touch
the real pysaka engine, sqlite store, or ONNX embedder -- only the HTTP contract
of `backend/api/ai.py` is under test.
"""

from __future__ import annotations

import asyncio
import copy
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

import backend.api.ai as ai_module
from backend.main import app
from backend.services.llm_client import LLMBackendError
from backend.services.settings_store import _SETTINGS_DEFAULTS, load_config
from pysaka.knowledge.models import Answer, AnswerSentence, Citation, Scope, SourceRef

client = TestClient(app)


def _validated_answer() -> Answer:
    """A grounded, already-VALIDATED answer with one blog citation (JP content)."""
    return Answer(
        sentences=[AnswerSentence("焼肉を食べた", ["blog:hinatazaka46:1"])],
        citations=[
            Citation(
                doc_id="blog:hinatazaka46:1",
                source_ref=SourceRef(
                    service="hinatazaka46", kind="blog", blog_id="1", member_id=12
                ),
                quoted_snippet="焼肉たべた",
                member="金村 美玖",
                timestamp=datetime(2026, 3, 3, tzinfo=timezone.utc),
            )
        ],
    )


def _message_answer() -> Answer:
    """A grounded answer citing a message (group chat) doc."""
    return Answer(
        sentences=[
            AnswerSentence("グループでライブの話をした", ["msg:hinatazaka46:1"])
        ],
        citations=[
            Citation(
                doc_id="msg:hinatazaka46:1",
                source_ref=SourceRef(
                    service="hinatazaka46",
                    kind="message",
                    group_id=94,
                    group_name="日向坂46",
                    member_id=58,
                    member_name="佐藤 花",
                    message_id=500001,
                    is_group_chat=True,
                ),
                quoted_snippet="ライブ楽しかった",
                member="佐藤 花",
                timestamp=datetime(2026, 3, 3, tzinfo=timezone.utc),
            )
        ],
    )


def _no_evidence_answer() -> Answer:
    return Answer(sentences=[], citations=[], no_evidence=True)


def _mock_knowledge_service() -> MagicMock:
    """`get_knowledge_service()`-shaped mock: `ask`/`rebuild` async, `status` sync."""
    svc = MagicMock()
    svc.ask = AsyncMock(return_value=_validated_answer())
    svc.status = MagicMock(
        return_value={"service": None, "document_count": 3, "by_type": {"blog": 3}}
    )
    svc.rebuild = AsyncMock(return_value=3)
    return svc


class TestAskSSE:
    """POST /api/ai/ask -- two-pass SSE stream."""

    def test_ask_streams_progress_then_answer_event(self):
        with patch("backend.api.ai.get_knowledge_service") as g:
            g.return_value = AsyncMock()
            g.return_value.ask.return_value = _validated_answer()
            r = client.post(
                "/api/ai/ask",
                json={
                    "question": "何を食べた?",
                    "service": "hinatazaka46",
                    "tz": "Asia/Tokyo",
                },
            )
        assert r.status_code == 200
        assert "text/event-stream" in r.headers["content-type"]
        body = r.text
        progress_idx = body.index("event: progress")
        answer_idx = body.index("event: answer")
        assert progress_idx < answer_idx
        assert "blog:hinatazaka46:1" in body
        assert "焼肉を食べた" in body

    def test_ask_answer_serializes_blog_citation_ref(self):
        with patch("backend.api.ai.get_knowledge_service") as g:
            g.return_value = AsyncMock()
            g.return_value.ask.return_value = _validated_answer()
            r = client.post(
                "/api/ai/ask",
                json={
                    "question": "何を食べた?",
                    "service": "hinatazaka46",
                    "tz": "Asia/Tokyo",
                },
            )
        answer_line = next(
            line
            for line in r.text.splitlines()
            if line.startswith("data:") and "blog:hinatazaka46:1" in line
        )
        assert '"type": "blog"' in answer_line or '"type":"blog"' in answer_line
        assert "hinatazaka46" in answer_line
        assert '"blogId"' in answer_line
        assert '"memberId"' in answer_line
        # Outer envelope is camelCase (Finding 2): `docId`, not `doc_id`.
        assert '"docId"' in answer_line
        assert '"doc_id"' not in answer_line

    def test_ask_answer_serializes_message_citation_ref(self):
        with patch("backend.api.ai.get_knowledge_service") as g:
            g.return_value = AsyncMock()
            g.return_value.ask.return_value = _message_answer()
            r = client.post(
                "/api/ai/ask",
                json={
                    "question": "何を話した?",
                    "service": "hinatazaka46",
                    "group_ids": [94],
                    "tz": "Asia/Tokyo",
                },
            )
        answer_line = next(
            line
            for line in r.text.splitlines()
            if line.startswith("data:") and "msg:hinatazaka46:1" in line
        )
        assert "message" in answer_line
        assert '"groupId"' in answer_line
        assert '"messageId"' in answer_line
        assert '"isGroupChat"' in answer_line
        # Outer envelope is camelCase (Finding 2): `citationIds`, not `citation_ids`.
        assert '"citationIds"' in r.text
        assert '"citation_ids"' not in r.text

    def test_ask_no_evidence_streams_minimal_payload(self):
        with patch("backend.api.ai.get_knowledge_service") as g:
            g.return_value = AsyncMock()
            g.return_value.ask.return_value = _no_evidence_answer()
            r = client.post(
                "/api/ai/ask",
                json={
                    "question": "存在しない話題は?",
                    "service": "hinatazaka46",
                    "tz": "Asia/Tokyo",
                },
            )
        assert r.status_code == 200
        assert '"noEvidence": true' in r.text or '"noEvidence":true' in r.text
        # No leaked sentences/citations keys alongside a no-evidence answer.
        answer_data_line = next(
            line
            for line in r.text.splitlines()
            if line.startswith("data:") and "noEvidence" in line
        )
        assert "sentences" not in answer_data_line

    def test_ask_llm_backend_error_streams_error_event_not_500(self):
        with patch("backend.api.ai.get_knowledge_service") as g:
            g.return_value = AsyncMock()
            g.return_value.ask.side_effect = LLMBackendError(
                "OpenAI-compatible LLM backend at http://x returned HTTP 500: boom"
            )
            r = client.post(
                "/api/ai/ask",
                json={
                    "question": "何を食べた?",
                    "service": "hinatazaka46",
                    "tz": "Asia/Tokyo",
                },
            )
        assert r.status_code == 200  # stream already started; error is in-band
        assert "event: error" in r.text
        # No raw exception/stacktrace text (which could leak internals) in the body.
        assert "Traceback" not in r.text

    def test_ask_generic_failure_streams_error_event(self):
        with patch("backend.api.ai.get_knowledge_service") as g:
            g.return_value = AsyncMock()
            g.return_value.ask.side_effect = RuntimeError("boom")
            r = client.post(
                "/api/ai/ask",
                json={
                    "question": "何を食べた?",
                    "service": "hinatazaka46",
                    "tz": "Asia/Tokyo",
                },
            )
        assert r.status_code == 200
        assert "event: error" in r.text

    def test_ask_invalid_tz_returns_422(self):
        with patch("backend.api.ai.get_knowledge_service") as g:
            g.return_value = AsyncMock()
            r = client.post(
                "/api/ai/ask",
                json={
                    "question": "何を食べた?",
                    "service": "hinatazaka46",
                    "tz": "Not/A_Zone",
                },
            )
        assert r.status_code == 422
        g.return_value.ask.assert_not_called()

    def test_ask_invalid_service_returns_400(self):
        with patch("backend.api.ai.get_knowledge_service") as g:
            g.return_value = AsyncMock()
            r = client.post(
                "/api/ai/ask",
                json={
                    "question": "何を食べた?",
                    "service": "not_a_real_group",
                    "tz": "Asia/Tokyo",
                },
            )
        assert r.status_code == 400


class TestIndexStatus:
    """GET /api/ai/index/status."""

    def test_returns_mocked_status(self):
        svc = _mock_knowledge_service()
        with patch("backend.api.ai.get_knowledge_service", AsyncMock(return_value=svc)):
            r = client.get("/api/ai/index/status", params={"service": "hinatazaka46"})
        assert r.status_code == 200
        assert r.json() == {
            "service": None,
            "document_count": 3,
            "by_type": {"blog": 3},
        }
        svc.status.assert_called_once_with("hinatazaka46")

    def test_status_without_service_param(self):
        svc = _mock_knowledge_service()
        with patch("backend.api.ai.get_knowledge_service", AsyncMock(return_value=svc)):
            r = client.get("/api/ai/index/status")
        assert r.status_code == 200
        svc.status.assert_called_once_with(None)


class TestIndexRebuild:
    """POST /api/ai/index/rebuild."""

    def test_schedules_rebuild_and_returns_ok(self):
        svc = _mock_knowledge_service()
        with patch("backend.api.ai.get_knowledge_service", AsyncMock(return_value=svc)):
            r = client.post("/api/ai/index/rebuild", json={"service": "hinatazaka46"})
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_rebuild_invalid_service_returns_400(self):
        svc = _mock_knowledge_service()
        with patch("backend.api.ai.get_knowledge_service", AsyncMock(return_value=svc)):
            r = client.post("/api/ai/index/rebuild", json={"service": "nope"})
        assert r.status_code == 400
        svc.rebuild.assert_not_called()


class TestHardwareSuggestion:
    """GET /api/ai/hardware-suggestion."""

    def test_returns_hardware_and_suggestion(self):
        fake_hw = {
            "ram_gb": 32.0,
            "gpu": "RTX 4090",
            "vram_gb": 24.0,
            "platform": "Linux",
        }
        fake_suggestion = {
            "recommended": "local",
            "local_model": "qwen3:32b",
            "tier": "T2",
            "reason": "plenty of VRAM",
        }
        with (
            patch(
                "backend.api.ai.detect_hardware", return_value=fake_hw
            ) as mock_detect,
            patch(
                "backend.api.ai.suggest_llm_backend", return_value=fake_suggestion
            ) as mock_suggest,
        ):
            r = client.get("/api/ai/hardware-suggestion")
        assert r.status_code == 200
        assert r.json() == {"hardware": fake_hw, "suggestion": fake_suggestion}
        mock_detect.assert_called_once()
        mock_suggest.assert_called_once_with(fake_hw)


class TestConfig:
    """GET/PUT /api/ai/config."""

    def test_get_config_returns_llm_block(self, tmp_path, monkeypatch):
        settings_path = tmp_path / "settings.json"
        monkeypatch.setattr(
            "backend.services.settings_store.get_settings_path", lambda: settings_path
        )
        r = client.get("/api/ai/config")
        assert r.status_code == 200
        data = r.json()
        assert data["backend"] == "cloud"
        assert "base_url" in data
        assert "model" in data

    def test_put_config_valid_persists_and_invalidates(self, tmp_path, monkeypatch):
        settings_path = tmp_path / "settings.json"
        monkeypatch.setattr(
            "backend.services.settings_store.get_settings_path", lambda: settings_path
        )

        with patch(
            "backend.api.ai.invalidate_llm_client", AsyncMock()
        ) as mock_invalidate:
            r = client.put(
                "/api/ai/config",
                json={
                    "backend": "local",
                    "base_url": "http://localhost:11434/v1",
                    "model": "qwen2.5:14b",
                },
            )
        assert r.status_code == 200
        assert r.json() == {"ok": True}
        mock_invalidate.assert_awaited_once()

        r2 = client.get("/api/ai/config")
        assert r2.json() == {
            "backend": "local",
            "base_url": "http://localhost:11434/v1",
            "model": "qwen2.5:14b",
        }

    def test_put_config_does_not_alias_shared_defaults(self, tmp_path, monkeypatch):
        """Finding 3 regression: PUT /config with a new `llm` block must copy
        `knowledge_base` before mutating it, not alias the shared
        `_SETTINGS_DEFAULTS["knowledge_base"]` dict.

        `settings.json` doesn't exist yet in this tmp dir, so `load_config()`'s
        shallow `{**_SETTINGS_DEFAULTS, **json.load(f)}` merge (see
        `settings_store._read_file`) hands the endpoint's `_update` callback the
        very same `knowledge_base` dict object that lives on the module-level
        `_SETTINGS_DEFAULTS`. If `_update` mutated it in place, this PUT would
        corrupt `_SETTINGS_DEFAULTS` for the rest of the process.
        """
        settings_path = tmp_path / "settings.json"
        monkeypatch.setattr(
            "backend.services.settings_store.get_settings_path", lambda: settings_path
        )
        original_kb_defaults = copy.deepcopy(_SETTINGS_DEFAULTS["knowledge_base"])

        with patch("backend.api.ai.invalidate_llm_client", AsyncMock()):
            r = client.put(
                "/api/ai/config",
                json={
                    "backend": "local",
                    "base_url": "http://localhost:11434/v1",
                    "model": "qwen2.5:14b",
                },
            )
        assert r.status_code == 200

        # The module-level defaults dict itself must be byte-for-byte untouched.
        assert _SETTINGS_DEFAULTS["knowledge_base"] == original_kb_defaults

        # A fresh `load_config()` read sees the PUT's `llm` change, but the
        # OTHER `knowledge_base` fields are still exactly the defaults.
        config = asyncio.run(load_config())
        kb = config["knowledge_base"]
        assert kb["enabled"] == original_kb_defaults["enabled"]
        assert kb["embedding_model"] == original_kb_defaults["embedding_model"]
        assert kb["last_built"] == original_kb_defaults["last_built"]
        assert kb["llm"] == {
            "backend": "local",
            "base_url": "http://localhost:11434/v1",
            "model": "qwen2.5:14b",
        }

    def test_put_config_invalid_backend_returns_4xx(self, tmp_path, monkeypatch):
        settings_path = tmp_path / "settings.json"
        monkeypatch.setattr(
            "backend.services.settings_store.get_settings_path", lambda: settings_path
        )

        r = client.put(
            "/api/ai/config",
            json={"backend": "carrier-pigeon", "base_url": "http://x", "model": "m"},
        )
        assert 400 <= r.status_code < 500

    def test_put_config_empty_base_url_returns_4xx(self, tmp_path, monkeypatch):
        settings_path = tmp_path / "settings.json"
        monkeypatch.setattr(
            "backend.services.settings_store.get_settings_path", lambda: settings_path
        )

        r = client.put(
            "/api/ai/config",
            json={"backend": "cloud", "base_url": "  ", "model": "m"},
        )
        assert 400 <= r.status_code < 500


class TestAskDisconnect:
    """`_ask_event_stream` client-disconnect handling (Finding 1).

    Drives the SSE generator directly (`TestClient`/ASGI can't simulate a
    mid-stream disconnect) with a duck-typed fake `Request` and a slow mocked
    `svc.ask` that holds a plain `asyncio.Lock` standing in for
    `KnowledgeService._store_lock`.
    """

    @pytest.mark.asyncio
    async def test_disconnect_stops_stream_but_lets_ask_finish_and_release_lock(self):
        lock = asyncio.Lock()

        async def slow_ask(question, scope, tz, history):
            async with lock:
                await asyncio.sleep(0.2)
            return _validated_answer()

        svc = AsyncMock()
        svc.ask = AsyncMock(side_effect=slow_ask)

        class FakeRequest:
            """Duck-types `fastapi.Request`'s `is_disconnected()`: connected on
            the first heartbeat poll, gone from the second poll onward."""

            def __init__(self) -> None:
                self.disconnect_calls = 0

            async def is_disconnected(self) -> bool:
                self.disconnect_calls += 1
                return self.disconnect_calls > 1

        fake_request = FakeRequest()
        scope = Scope(service="hinatazaka46", group_ids=[], member_id=None)

        tasks_before = set(ai_module._pending_ask_tasks)
        with (
            patch("backend.api.ai.get_knowledge_service", AsyncMock(return_value=svc)),
            patch("backend.api.ai._HEARTBEAT_INTERVAL_S", 0.01),
        ):
            events = [
                event
                async for event in ai_module._ask_event_stream(
                    fake_request, "何を食べた?", scope, ZoneInfo("Asia/Tokyo")
                )
            ]

        # The stream stopped as soon as the disconnect was observed: the
        # immediate "thinking" event plus (at most) one heartbeat made it out,
        # but no more heartbeats after that, and no terminal `event: answer`
        # (the ask is still running in the background at this point).
        assert events, "expected at least the immediate progress event"
        assert all("event: progress" in e for e in events)
        assert all("event: answer" not in e for e in events)
        assert fake_request.disconnect_calls >= 1

        # The ask task was detached (NOT cancelled) into the module-level
        # registry when the generator returned early.
        new_tasks = set(ai_module._pending_ask_tasks) - tasks_before
        assert len(new_tasks) == 1
        task = new_tasks.pop()
        assert not task.cancelled()

        # It must be allowed to run to natural completion and release the lock
        # on its own -- proving the lock isn't left permanently held by an
        # orphaned/cancelled worker.
        answer = await asyncio.wait_for(asyncio.shield(task), timeout=2)
        assert answer is not None
        assert not task.cancelled()
        assert not lock.locked()
        svc.ask.assert_awaited_once()

        # The done-callback retrieves the task's result/exception and
        # self-discards it from the registry (no leaked reference, no
        # "exception was never retrieved" warning).
        await asyncio.sleep(0)
        assert task not in ai_module._pending_ask_tasks
