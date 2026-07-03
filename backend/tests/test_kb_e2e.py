"""End-to-end wiring test for the KB chatbot -- Plan B Task 11.

Drives a REAL `KnowledgeService` (real `SqliteKnowledgeStore`, real pysaka
`ingest_messages` / `MentionDetector` / `HybridRetriever` / `KnowledgeAgent` /
`validate`; only the embedder and the LLM are fakes) over a synthetic tmp
corpus, through the actual `/api/ai/ask` SSE endpoint (`TestClient`, with
`get_knowledge_service` patched to return this wired instance -- mirrors
`test_ai_api.py`'s patch point). This proves the full stack fits together:
ingest -> mention-detect -> persist -> retrieve -> agent -> validate -> SSE ->
deep-linkable citation.

Unlike `test_knowledge_service.py` (Task 3), which monkeypatches
`resolve_messages_file` directly to a fixed path, this test builds a REAL
`output/` tree (`<display_name>/messages/<gid name>/<mid name>/messages.json`)
and patches only `path_resolver.get_output_dir` -- so `index_members` here
also exercises the real on-disk path resolution (`resolve_service_path` ->
`find_folder_by_id` -> `resolve_messages_file`), not just the service layer.

Both questions below use `sort="recent"`, which `HybridRetriever.search`
short-circuits before embedding anything (see `pysaka.knowledge.retrieve`) --
so the exact vectors `FakeEmbedder` hands back for index-time chunk text are
never read at ask-time; a single fixed vector for every text is sufficient
and keeps the corpus free to grow without hand-maintaining a vectors dict.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.services.knowledge_service import KnowledgeService
from backend.services.knowledge_store import SqliteKnowledgeStore
from pysaka.knowledge.llm import FakeLLMClient, LLMResponse, ToolCall

_SERVICE = "hinatazaka46"
_GROUP_ID = 94
_GROUP_NAME = "日向坂46"
_MEMBER_A_MSG_ID = 145
_MEMBER_A_NAME = "佐藤 花"
_MEMBER_B_NAME = "鈴木 愛"
_MENTION_MSG_ID = 500002
# Author canonical id == f"{service}:{blogId}" for member A (blogId "10" in the
# roster fixture below); doc_id == f"msg:{service}:{author}:{message_id}" (see
# pysaka `ingest_messages`).
_AUTHOR_A_CID = f"{_SERVICE}:10"
_DOC_ID_MENTION = f"msg:{_SERVICE}:{_AUTHOR_A_CID}:{_MENTION_MSG_ID}"
_MENTION_TEXT = "鈴木 愛とライブに行きました"

client = TestClient(app)


class FakeEmbedder:
    """Deterministic embedder: a fixed dim-2 vector for any text.

    Both `ask()`s in this test use `sort="recent"`, which short-circuits
    `HybridRetriever.search` before it embeds anything -- so the actual
    vector values produced for index-time chunk text are never read at
    ask-time. A single fixed vector for any input is sufficient here.
    """

    dim = 2

    def embed(self, texts: list[str], kind: str = "passage") -> list[list[float]]:
        return [[1.0, 0.0] for _ in texts]


def _write_roster(data_dir: Path) -> None:
    """A tiny 2-member roster fixture: A (blogId 10) and B (blogId 20); A
    mentions B in one of her synced messages (see `_write_synced_messages`).
    """
    members = {
        "meta": {"group": "hinatazaka"},
        "members": [
            {
                "blogId": "10",
                "nameKanji": _MEMBER_A_NAME,
                "nameHiragana": "さとう はな",
                "nameRomaji": "Sato Hana",
                "generation": 5,
                "status": "active",
            },
            {
                "blogId": "20",
                "nameKanji": _MEMBER_B_NAME,
                "nameHiragana": "すずき あい",
                "nameRomaji": "Suzuki Ai",
                "generation": 5,
                "status": "active",
            },
        ],
    }
    members_dir = data_dir / "members"
    members_dir.mkdir(parents=True, exist_ok=True)
    # Roster file is data/members/<short>.json ("46" stripped from the service id).
    (members_dir / "hinatazaka.json").write_text(
        json.dumps(members, ensure_ascii=False), encoding="utf-8"
    )


def _write_synced_messages(output_dir: Path) -> None:
    """A REAL synced `output/` tree for member A: one message mentions B, plus
    two distractor messages that mention neither member. Member B has no
    synced folder at all -- her `search`/`author` filter surfaces zero docs.
    """
    member_dir = (
        output_dir
        / _GROUP_NAME
        / "messages"
        / f"{_GROUP_ID} {_GROUP_NAME}"
        / f"{_MEMBER_A_MSG_ID} {_MEMBER_A_NAME}"
    )
    member_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "member": {
            "id": _MEMBER_A_MSG_ID,
            "name": _MEMBER_A_NAME,
            "group_id": _GROUP_ID,
        },
        "messages": [
            {
                "id": 500001,
                "timestamp": "2026-06-10T09:00:00Z",
                "type": "text",
                "is_favorite": False,
                "content": "今日は晴れです",
            },
            {
                "id": _MENTION_MSG_ID,
                "timestamp": "2026-06-15T09:30:00Z",
                "type": "text",
                "is_favorite": False,
                "content": _MENTION_TEXT,
            },
            {
                "id": 500003,
                "timestamp": "2026-06-20T09:00:00Z",
                "type": "text",
                "is_favorite": False,
                "content": "美味しいラーメンを食べました",
            },
        ],
    }
    (member_dir / "messages.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )


async def _build_indexed_service(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, llm: FakeLLMClient
) -> KnowledgeService:
    """Build a REAL `KnowledgeService` over a tmp store + fixture data dir, and
    index member A's REAL synced `output/` tree through the real
    `path_resolver` (only `get_output_dir` is patched; folder-id resolution
    downstream of it runs for real).
    """
    data_dir = tmp_path / "data"
    _write_roster(data_dir)

    output_dir = tmp_path / "output"
    _write_synced_messages(output_dir)
    monkeypatch.setattr(
        "backend.services.path_resolver.get_output_dir", lambda: output_dir
    )

    store = SqliteKnowledgeStore(tmp_path / "knowledge_index.db")
    svc = KnowledgeService(
        store=store, embedder=FakeEmbedder(), llm=llm, data_dir=data_dir
    )

    group = {"id": _GROUP_ID, "name": _GROUP_NAME}
    member_a = {"id": _MEMBER_A_MSG_ID, "name": _MEMBER_A_NAME}
    changed = await svc.index_members([(group, member_a)], _SERVICE)
    assert changed == 3, "expected all 3 of A's messages to be freshly indexed"
    return svc


def _sse_events(body: str) -> list[tuple[str, dict]]:
    """Parse an SSE response body (`_format_sse`'s `event: ...\\ndata: ...\\n\\n`
    blocks) into `[(event_name, data_dict), ...]`.
    """
    events: list[tuple[str, dict]] = []
    for block in body.split("\n\n"):
        if not block.strip():
            continue
        event_name = ""
        data: dict = {}
        for line in block.splitlines():
            if line.startswith("event:"):
                event_name = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data = json.loads(line[len("data:") :].strip())
        if event_name:
            events.append((event_name, data))
    return events


def test_ask_e2e_over_synthetic_corpus(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Full stack, one synthetic corpus, two questions:

    1. "when did A last mention B" -- scripted `resolve_member` -> `search`
       (author=A, mentions=B, sort=recent) -> a final answer citing the
       doc_id that `search` surfaced. Asserts the SSE `answer` event carries a
       citation whose `ref` is a deep-linkable MESSAGE reference (the fields
       `navigateToSource` needs: `messageId`, `groupId`, etc.).
    2. A question about B, who has no synced/indexed messages at all: her
       `search` (author=B) surfaces zero hits, but the scripted model still
       (wrongly) cites A's mention-of-B doc_id from question 1 -- a doc_id
       this turn's search never surfaced (`KnowledgeAgent.ask` resets its
       `surfaced` doc_id set fresh on every call). The grounding validator
       must drop that ungrounded citation, streaming `noEvidence: true`.
    """
    script = [
        # -- Q1: "when did 佐藤花 last mention 鈴木愛" --
        LLMResponse(
            tool_calls=[
                ToolCall("resolve_member", {"text": _MEMBER_B_NAME}, id="call_1")
            ]
        ),
        LLMResponse(
            tool_calls=[
                ToolCall(
                    "search",
                    {
                        "author": _MEMBER_A_NAME,
                        "mentions": _MEMBER_B_NAME,
                        "sort": "recent",
                        "limit": 5,
                    },
                    id="call_2",
                )
            ]
        ),
        LLMResponse(
            text=json.dumps(
                {
                    "sentences": [
                        {"text": _MENTION_TEXT, "citation_ids": [_DOC_ID_MENTION]}
                    ]
                }
            )
        ),
        # -- Q2: about 鈴木愛, who has zero indexed messages --
        LLMResponse(
            tool_calls=[
                ToolCall("resolve_member", {"text": _MEMBER_B_NAME}, id="call_3")
            ]
        ),
        LLMResponse(
            tool_calls=[
                ToolCall(
                    "search",
                    {"author": _MEMBER_B_NAME, "sort": "recent", "limit": 5},
                    id="call_4",
                )
            ]
        ),
        # Hallucinated: cites Q1's doc_id, which this turn's search never surfaced.
        LLMResponse(
            text=json.dumps(
                {
                    "sentences": [
                        {"text": _MENTION_TEXT, "citation_ids": [_DOC_ID_MENTION]}
                    ]
                }
            )
        ),
    ]
    svc = asyncio.run(
        _build_indexed_service(tmp_path, monkeypatch, FakeLLMClient(script))
    )

    with (
        patch("backend.api.ai.get_knowledge_service") as mock_get_svc,
        # Task 3's `kb_enabled()` guard runs before `_run_ask` ever reaches
        # `get_knowledge_service()` -- this e2e test is about the ask/grounding
        # pipeline, not the enabled gate (covered separately in test_ai_api.py
        # and test_knowledge_service.py), so the KB must read as enabled here.
        patch("backend.api.ai.kb_enabled", new=AsyncMock(return_value=True)),
    ):
        mock_get_svc.return_value = svc

        r1 = client.post(
            "/api/ai/ask",
            json={
                "question": (
                    f"{_MEMBER_A_NAME}が{_MEMBER_B_NAME}について最後に話したのはいつ?"
                ),
                "service": _SERVICE,
                "tz": "Asia/Tokyo",
            },
        )
        r2 = client.post(
            "/api/ai/ask",
            json={
                "question": f"{_MEMBER_B_NAME}について教えて",
                "service": _SERVICE,
                "tz": "Asia/Tokyo",
            },
        )

    # --- Q1: grounded answer with a deep-linkable message citation ---
    assert r1.status_code == 200
    events1 = _sse_events(r1.text)
    event_names1 = [name for name, _ in events1]
    assert "progress" in event_names1
    assert event_names1.index("progress") < event_names1.index("answer")
    answer1 = dict(events1)["answer"]

    assert answer1["noEvidence"] is False
    assert answer1["sentences"], "expected at least one sentence in the answer"
    assert answer1["sentences"][0]["text"] == _MENTION_TEXT
    assert answer1["citations"], "expected at least one surviving citation"
    citation = answer1["citations"][0]
    assert citation["docId"] == _DOC_ID_MENTION
    ref = citation["ref"]
    assert ref["type"] == "message"
    assert ref["service"] == _SERVICE
    assert ref["messageId"] == _MENTION_MSG_ID
    assert ref["groupId"] == _GROUP_ID
    assert ref["memberId"] == _MEMBER_A_MSG_ID
    assert ref["memberName"] == _MEMBER_A_NAME
    assert "isGroupChat" in ref
    # Regression guard for the deep-link 404: `groupName` must be the real
    # synced group name (matches the on-disk `"<id> <name>"` folder), not
    # null -- a null here makes `navigateToSource` build a literal "<gid>
    # null" path that `messages_by_path` can't resolve.
    assert ref["groupName"] == _GROUP_NAME

    # --- Q2: absent-evidence question -> validator drops the hallucinated citation ---
    assert r2.status_code == 200
    events2 = _sse_events(r2.text)
    answer2 = dict(events2)["answer"]
    assert answer2 == {"noEvidence": True}
