# KB Chatbot — Plan B: SakaDesk Integration + UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Depends on Plan A** (`2026-07-01-kb-chatbot-plan-a-engine.md`) being implemented and available via the editable `../pysaka` — Plan B imports the `pysaka.knowledge` public API and does NOT reimplement the engine.

**Goal:** Ship the member knowledge-base chatbot inside SakaDesk: a `/api/ai/ask` two-pass SSE endpoint driving the pysaka engine, knowledge indexing hooked into the existing sync pipeline, and a React `AiFeature` chat UI whose citation chips deep-link to the exact blog/message via the app's existing navigation.

**Architecture:** `backend/services/knowledge_service.py` wires the pure `pysaka.knowledge` engine (registry, aliases, retriever, agent, validator) to SakaDesk's paths/keyring/settings, injecting a SakaDesk-supplied `OnnxEmbedder` (`pysaka[embeddings]`), a sqlite-backed `VectorStore`/document persistence (`knowledge_index.db`), and a `GeminiLLMClient` (the existing `GeminiProvider` HTTP pattern extended with function-calling). A new `api/ai.py` router exposes ask/index endpoints; indexing piggybacks the two existing sync hooks. The frontend gains `features/ai/` (chat + citation chips), a shared `navigateToSource()` util (extracted from `SearchModal`), and a "Knowledge base" subsection in the AI settings tab.

**Tech Stack:** FastAPI + uvicorn, `httpx`, `structlog`, `sqlite3` (stdlib), `pysaka[embeddings]` (onnxruntime + numpy + Granite R2); React 18 + TS + Zustand + Vite + Tailwind, `react-i18next`, `lucide-react`; tests: `pytest`+`TestClient` (backend, `asyncio_mode=strict`), `vitest`+`@testing-library/react` (frontend). Spec: `docs/superpowers/specs/2026-07-01-knowledge-base-chatbot-design.md`.

## Global Constraints
- **uv only** in the SakaDesk repo (`uv run …`, `uv add …`); commit via `uv run git commit` (pre-commit not on PATH otherwise).
- **Python 3.12** floor here (vs pysaka 3.9); `from __future__ import annotations` still used per repo style. **Heavy deps (onnxruntime/numpy) belong here**, not in pysaka core — SakaDesk installs `pysaka[embeddings]`.
- **Reuse, don't reinvent:** the keyring key group is `"llm_provider_api_key"` (shared with translation); provider/model come from `settings.json` (`translation_provider`/`translation_model`). **No new provider config** — the KB reuses the AI tab's key/model.
- **Style:** `structlog` (`logger = structlog.get_logger(__name__)`); **no `print()`**; **no `assert`** for validation; all file I/O `encoding="utf-8"`; `pathlib.Path`; ruff/mypy per repo config.
- **Async:** FastAPI async endpoints; offload blocking (embedding, sqlite, file reads) via `asyncio.to_thread`/executors — never block the loop.
- **i18n:** all user-facing strings in `i18n/locales/{en,ja,zh-CN,zh-TW,yue}.json` via `t()`; dates UTC internally, "past month" resolved from a request `tz`.
- **Coverage:** backend `fail_under=80`; frontend vitest threshold ≥ 25% (repo defaults) — new modules should meet or beat these.
- **Privacy:** questions + retrieved snippets go to the user's own provider; keys in keyring only, never logged; mask `%%%`/PII.
- **Grounding is non-negotiable:** the endpoint returns only validated, cited answers (or `no_evidence`), never un-cited claims.

---

## Shared Contracts (Plan A → Plan B seams)

From `pysaka.knowledge` (Plan A public API): `MemberRegistry`, `AliasTable`, `DocumentStore`, `HybridRetriever`, `KnowledgeAgent`, `validate`, `MentionDetector`, `chunk_documents`, `ingest_blog`, `ingest_messages`, and models `Document`, `Member`, `Citation`, `Answer`, `Scope`, `SearchFilters`, `Hit`, `SourceRef`; protocols `Embedder`, `VectorStore`, `LexicalIndex`, `LLMClient`; `llm.LLMResponse`, `llm.ToolCall`; `tools.TOOL_SCHEMAS`, `tools.ToolRunner`; backends `NumpyVectorStore`, `OnnxEmbedder`.

New SakaDesk seams (defined by this plan):
```python
# backend/services/knowledge_service.py
class KnowledgeService:
    async def index_members(self, members_with_changes: list[tuple[dict, dict]], service: str) -> int: ...
    async def index_blogs_for_service(self, service: str) -> int: ...
    async def ask(self, question: str, scope: Scope, tz: str,
                  history: list[dict] | None = None) -> Answer: ...   # already validated
    def status(self, service: str | None = None) -> dict: ...          # {indexed, total, is_rebuilding, last_built}
    async def rebuild(self, service: str) -> None: ...
def get_knowledge_service() -> KnowledgeService: ...                    # singleton, mirrors get_search_service()
```
```typescript
// frontend/src/utils/navigateToSource.ts
export interface CitationReference {
  type: 'blog' | 'message';
  service: string;
  blogId?: string; memberId?: number;                       // blog
  groupId?: number; groupName?: string; memberName?: string; messageId?: number; isGroupChat?: boolean; // message
}
export function navigateToSource(ref: CitationReference): void;
// frontend/src/features/ai/api.ts
export interface AskCitation { docId: string; ref: CitationReference; snippet: string; member: string; timestamp: string; }
export interface AskAnswer { sentences: {text: string; citationIds: string[]}[]; citations: AskCitation[]; noEvidence: boolean; }
export function askKnowledge(service: string, question: string, tz: string,
  onProgress: (label: string) => void): Promise<AskAnswer>;   // consumes the two-pass SSE
```
The SSE `source_ref`→`CitationReference` shape is exactly the search-result shape (spec §9.2), so `navigateToSource` is shared by search and chat.

## File Structure (created/modified by this plan)
```
SakaDesk/backend/
  services/knowledge_store.py     NEW  SqliteKnowledgeStore: persist docs+vectors+mentions (knowledge_index.db)
  services/llm_client.py          NEW  GeminiLLMClient (function-calling) impl of pysaka LLMClient
  services/knowledge_service.py   NEW  wires pysaka engine; index/ask/status/rebuild; get_knowledge_service()
  services/settings_store.py      MOD  +knowledge_base defaults
  services/sync_service.py        MOD  +bg knowledge-index hook (~line 553)
  services/blog_service.py        MOD  +bg knowledge-index hook (~line 1343)
  services/transcription_service.py MOD +enqueue parent doc re-index on transcript write
  api/ai.py                       NEW  POST /api/ai/ask (SSE), GET /index/status, POST /index/rebuild
  main.py                         MOD  include_router(ai.router, prefix="/api/ai")
SakaDesk/frontend/src/
  utils/navigateToSource.ts       NEW  shared deep-link util
  features/search/SearchModal.tsx MOD  handleNavigate → calls navigateToSource
  features/ai/api.ts              NEW  SSE ask client + types
  features/ai/AiFeature.tsx       NEW  chat feature (mirrors BlogsFeature)
  features/ai/components/ChatWindow.tsx, CitationChip.tsx  NEW
  features/ai/index.ts            NEW  barrel export
  config/features.ts              MOD  add 'ai' to SERVICE_FEATURES
  shell/components/ContentArea.tsx MOD  case 'ai' → <AiFeature/>
  shell/components/SettingsModal.tsx MOD  +KnowledgeBaseStatus subsection in AiTab
  i18n/locales/*.json (×5)        MOD  +ai.* and settings.knowledgeBase strings
SakaDesk/pyproject.toml           MOD  ensure pysaka[embeddings] extra installed
```

---

## Milestone B0 — Backend engine wiring

### Task 1: Install `pysaka[embeddings]` + SqliteKnowledgeStore
**Files:** Modify `SakaDesk/pyproject.toml` (dependency `"pysaka[embeddings]>=0.5.0"`; `uv sync`); Create `backend/services/knowledge_store.py`; Test `backend/tests/test_knowledge_store.py`.
**Interfaces:**
- Consumes: pysaka `Document`, `VectorStore` protocol, `NumpyVectorStore`.
- Produces: `SqliteKnowledgeStore(db_path: Path)` that (a) implements the pysaka `VectorStore` protocol backed by a persisted numpy matrix (blobs in sqlite, loaded into a `NumpyVectorStore` in memory), and (b) persists `Document` rows (`upsert_documents`, `get_document`, `all_documents`, `documents_for_service`, `content_hash` dedupe) + a `mentions` table. Separate DB `get_app_data_dir()/knowledge_index.db` (decoupled from `search_index.db`).

- [ ] **Step 1: Failing test** — round-trip: upsert 2 `Document`s + vectors, reopen store from the same path, `get_document` returns them and `VectorStore.search` finds the nearest. Uses a real tmp sqlite file.
```python
# backend/tests/test_knowledge_store.py (excerpt)
import pytest
from pathlib import Path
from backend.services.knowledge_store import SqliteKnowledgeStore
from pysaka.knowledge.models import Document, SourceRef

def _doc(i):
    from datetime import datetime, timezone
    return Document(doc_id=f"blog:hinatazaka46:{i}", source_ref=SourceRef(service="hinatazaka46", kind="blog", blog_id=str(i), member_id=12),
                    author_id="hinatazaka46:12", group="hinatazaka46", timestamp=datetime(2026,3,3,tzinfo=timezone.utc),
                    type="blog", is_favorite=False, text=f"焼肉{i}", has_text=True)

def test_persist_and_reload(tmp_path: Path):
    p = tmp_path / "knowledge_index.db"
    s = SqliteKnowledgeStore(p)
    s.upsert_documents([_doc(1), _doc(2)])
    s.add(["blog:hinatazaka46:1", "blog:hinatazaka46:2"], [[1.0,0.0],[0.0,1.0]])
    s.close()
    s2 = SqliteKnowledgeStore(p)
    assert s2.get_document("blog:hinatazaka46:1").text == "焼肉1"
    assert s2.search([1.0,0.0], k=1)[0][0] == "blog:hinatazaka46:1"
```
- [ ] **Step 2: Run — expect fail.** `cd SakaDesk && uv run pytest backend/tests/test_knowledge_store.py -v`
- [ ] **Step 3: Implement** `knowledge_store.py` (sqlite schema: `kb_documents`, `kb_vectors(id, dim, vec BLOB)`, `kb_mentions`; WAL like `search_service`; load vectors into a `NumpyVectorStore` on init; `add`/`remove`/`search` delegate to it and persist). Offload sqlite in service layer via `to_thread`.
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit** — `feat(kb): sqlite-backed knowledge store (docs+vectors+mentions)`

### Task 2: GeminiLLMClient (function-calling adapter)
**Files:** Create `backend/services/llm_client.py`; Test `backend/tests/test_llm_client.py`.
**Interfaces:**
- Consumes: pysaka `LLMClient` protocol, `llm.LLMResponse`, `llm.ToolCall`; the existing keyring loader pattern (`get_token_manager`, group `"llm_provider_api_key"`).
- Produces: `GeminiLLMClient(api_key: str, model: str)` implementing `async chat(messages, tools=None) -> LLMResponse` — builds the Gemini `generateContent` payload with `tools=[{"functionDeclarations": schemas}]`, parses `functionCall` parts into `ToolCall`s (else returns `.text`); a JSON-plan fallback when `tools` unsupported. Reuse the `GeminiProvider` httpx + error style. Also `build_llm_client_from_settings() -> GeminiLLMClient | None` (reads provider/model from settings + key from keyring; `None` if unconfigured).

- [ ] **Step 1: Failing test** — with `respx` mocking `generativelanguage.googleapis.com`, a response containing a `functionCall` part → `chat(...)` returns `LLMResponse(tool_calls=[ToolCall(name="search", arguments={...})])`; a text response → `.text` set, `tool_calls==[]`; `isinstance(client, LLMClient)`.
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement** `llm_client.py`.
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit** — `feat(kb): Gemini LLMClient adapter with function-calling`

### Task 3: KnowledgeService (wire the pysaka engine)
**Files:** Create `backend/services/knowledge_service.py`; Test `backend/tests/test_knowledge_service.py`.
**Interfaces:** Produces `KnowledgeService` + `get_knowledge_service()` per *Shared Contracts*. Loads `MemberRegistry`/`AliasTable` from `SakaDesk/data/members/*.json` + `data/aliases/*.json`; builds `MentionDetector`; constructs `OnnxEmbedder` (model dir from settings/app-data) + `SqliteKnowledgeStore` (as `VectorStore` + persistence) + `HybridRetriever` (with pysaka `PureLexicalIndex` for v1) + `KnowledgeAgent(GeminiLLMClient, ToolRunner)`. `index_members`/`index_blogs_for_service` read files via `path_resolver`, ingest→mention-detect→embed→persist (idempotent by `content_hash`). `ask` runs the agent then `validate` and returns the validated `Answer`.
- **Indexing reads:** blogs at `resolve_service_path(service)/"blogs"/**/blog.json`; messages via `resolve_member_path(...)/messages.json` for each changed member; voice transcripts from `transcriptions.json` sidecars.

- [ ] **Step 1: Failing test** — inject a `FakeEmbedder` + `FakeLLMClient` (scripted) via constructor params; index a tiny in-memory members set + one messages file (tmp), then `ask("when did A mention B", scope, tz)` returns a validated `Answer` whose citation `doc_id` was surfaced; a question with no matches → `Answer(no_evidence=True)`. Patch `data/members` to a fixture.
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement** `knowledge_service.py` (constructor accepts optional `embedder`/`llm`/`store` for tests; `get_knowledge_service()` builds the real ones).
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit** — `feat(kb): KnowledgeService wiring pysaka engine into SakaDesk`

### Task 4: Settings `knowledge_base` subsection
**Files:** Modify `backend/services/settings_store.py` (`_SETTINGS_DEFAULTS`); Test `backend/tests/test_settings.py` (extend).
**Interfaces:** Adds defaults: `"knowledge_base": {"enabled": False, "embedding_model": "granite-embedding-311m-multilingual-r2", "last_built": None}` (provider/model/key reuse translation's).
- [ ] **Step 1: Failing test** — `load_config()` on a fresh file exposes `knowledge_base.enabled is False`; `update_config` can flip it.
- [ ] **Step 2–4:** implement; run → PASS.
- [ ] **Step 5: Commit** — `feat(kb): knowledge_base settings defaults`

---

## Milestone B1 — Backend API + sync hooks

### Task 5: `/api/ai/ask` (two-pass SSE) + index endpoints
**Files:** Create `backend/api/ai.py`; Modify `backend/main.py` (import + `include_router(ai.router, prefix="/api/ai", tags=["ai"])`); Test `backend/tests/test_ai_api.py`.
**Interfaces:**
- Consumes: `get_knowledge_service`, pysaka `Scope`; the `_provider_http_error` error-mapping style.
- Produces: `router = APIRouter()`; `POST /ask` `{question, service, group_ids?, member_id?, tz, conversation_id?}` → `StreamingResponse(media_type="text/event-stream")` emitting `event: progress` lines during the agent run (tool labels), then one `event: answer` with the **validated** `{sentences, citations}` (or `{no_evidence: true}`); `GET /index/status?service=` → `KnowledgeService.status()`; `POST /index/rebuild` `{service}` → kicks `rebuild` as a background task, returns `{ok: true}`. Grounding runs server-side **before** the `answer` event (two-pass: progress streams live, the answer is emitted only after `validate`).

- [ ] **Step 1: Failing test** — patch `get_knowledge_service` with an `AsyncMock` whose `ask` returns a canned validated `Answer`; `TestClient` POST `/api/ai/ask` → 200, `text/event-stream`, body contains a `progress` event then an `answer` event whose JSON carries citations. A `no_evidence` answer streams `{"no_evidence": true}`. `GET /index/status` returns the mocked status.
```python
# backend/tests/test_ai_api.py (excerpt)
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from backend.main import app
client = TestClient(app)

def test_ask_streams_answer_event():
    from pysaka.knowledge.models import Answer, AnswerSentence, Citation, SourceRef
    from datetime import datetime, timezone
    ans = Answer(sentences=[AnswerSentence("焼肉を食べた", ["blog:hinatazaka46:1"])],
                 citations=[Citation("blog:hinatazaka46:1", SourceRef("hinatazaka46","blog",blog_id="1",member_id=12),
                                     "焼肉たべた","金村 美玖", datetime(2026,3,3,tzinfo=timezone.utc))])
    with patch("backend.api.ai.get_knowledge_service") as g:
        g.return_value = AsyncMock(); g.return_value.ask.return_value = ans
        r = client.post("/api/ai/ask", json={"question":"何を食べた?","service":"hinatazaka46","tz":"Asia/Tokyo"})
    assert r.status_code == 200 and "text/event-stream" in r.headers["content-type"]
    assert "event: answer" in r.text and "blog:hinatazaka46:1" in r.text
```
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement** `ai.py` (SSE generator: yield progress; call `svc.ask`; serialize `Answer` incl. `source_ref` → citation-reference shape; yield answer event; map provider errors to a terminal `event: error`). Register router in `main.py`.
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit** — `feat(kb): /api/ai/ask two-pass SSE + index status/rebuild`

### Task 6: Sync + transcript index hooks
**Files:** Modify `backend/services/sync_service.py` (~line 553), `backend/services/blog_service.py` (~line 1343), `backend/services/transcription_service.py` (after a transcript is written); Test `backend/tests/test_kb_hooks.py`.
**Interfaces:** Adds a background `asyncio.create_task(_bg_index_knowledge())` calling `get_knowledge_service().index_members(...)` / `.index_blogs_for_service(service)` alongside the existing search-index task (non-fatal on error, logged). Transcription: after writing `transcriptions.json`, enqueue the parent member's re-index so voice transcripts get indexed (they aren't covered by the sync hook).
- [ ] **Step 1: Failing test** — patch `get_knowledge_service` and assert the hook schedules `index_members`/`index_blogs_for_service` (spy on the AsyncMock) after a simulated sync/backup completes; assert a transcript write triggers a re-index enqueue.
- [ ] **Step 2–4:** implement (mirror the existing `_bg_index` pattern exactly); run → PASS.
- [ ] **Step 5: Commit** — `feat(kb): index hooks on sync, blog backup, and transcript write`

---

## Milestone B2 — Frontend chat UI + deep-linking

### Task 7: Extract `navigateToSource` (shared deep-link) + refactor SearchModal
**Files:** Create `frontend/src/utils/navigateToSource.ts`; Modify `frontend/src/features/search/SearchModal.tsx` (`handleNavigate` calls `navigateToSource`); Test `frontend/src/utils/__tests__/navigateToSource.test.ts`.
**Interfaces:** Produces `navigateToSource(ref: CitationReference)` (per *Shared Contracts*) — the exact store-action sequence currently in `SearchModal.handleNavigate` (setSelectedServices/setTargetBlog|setTargetMessageId + setSelectedConversation/setActiveFeature/setActiveService/triggerConversationNavigation). Refactor is **behavior-preserving**; existing search snapshot/integration tests must still pass.
- [ ] **Step 1: Failing test** — call `navigateToSource({type:'message', service, groupId, groupName, memberId, memberName, messageId})` with a mocked `useAppStore.getState()`; assert `setTargetMessageId(messageId)` + `setActiveFeature(service,'messages')` were called; a blog ref calls `setTargetBlog`.
- [ ] **Step 2: Run — expect fail.** `cd SakaDesk/frontend && npx vitest run src/utils/__tests__/navigateToSource.test.ts` (or `uv`-equivalent per repo script).
- [ ] **Step 3: Implement** the util; **then** refactor `SearchModal.handleNavigate` to build a `CitationReference` and call it (keep the `<mark>`-term extraction for blogs in SearchModal, pass through).
- [ ] **Step 4: Run — expect pass** + run the existing SearchModal tests to confirm no regression.
- [ ] **Step 5: Commit** — `refactor(frontend): shared navigateToSource used by search`

### Task 8: `features/ai/api.ts` — SSE ask client
**Files:** Create `frontend/src/features/ai/api.ts`; Test `frontend/src/features/ai/__tests__/api.test.ts`.
**Interfaces:** Produces `askKnowledge(service, question, tz, onProgress)` (per *Shared Contracts*) using `fetch('/api/ai/ask', {method:'POST', body})` + `response.body.getReader()` to parse SSE (`event: progress` → `onProgress(label)`; `event: answer` → resolve `AskAnswer`; `event: error` → throw). Types `AskAnswer`/`AskCitation`/`CitationReference`.
- [ ] **Step 1: Failing test** — mock `fetch` returning a `ReadableStream` of two SSE events (progress then answer); assert `onProgress` called and the resolved `AskAnswer.citations[0].ref` has the message/blog fields.
- [ ] **Step 2–4:** implement; run → PASS.
- [ ] **Step 5: Commit** — `feat(frontend): AI ask SSE client`

### Task 9: `AiFeature` chat UI + registration
**Files:** Create `frontend/src/features/ai/AiFeature.tsx`, `components/ChatWindow.tsx`, `components/CitationChip.tsx`, `index.ts`; Modify `config/features.ts` (add `'ai'` to each `SERVICE_FEATURES` entry incl. `default`), `shell/components/ContentArea.tsx` (`case 'ai': return <AiFeature/>` + import); Test `frontend/src/features/ai/__tests__/AiFeature.test.tsx`.
**Interfaces:** `AiFeature` mirrors `BlogsFeature` (reads `activeService` from `useAppStore`, `useTranslation`, local thread state per spec §7.5 client-side history); input box → `askKnowledge` with `Intl.DateTimeFormat().resolvedOptions().timeZone`; renders streamed progress ("verifying…"), then answer sentences with inline `CitationChip`s; `CitationChip.onClick → navigateToSource(citation.ref)`. "No evidence found" rendered as a distinct non-error state. Tailwind + `lucide-react` (`Bot`, `Sparkles`), chip styling from the `SearchFilterBar` pattern.
- [ ] **Step 1: Failing test** — render `<AiFeature/>` with mocked `askKnowledge` resolving a 1-citation answer; type a question + submit; assert the answer text + a citation chip appear; clicking the chip calls a mocked `navigateToSource`. Mock `useAppStore` with `activeService`.
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement** the components; wire `SERVICE_FEATURES` + `ContentArea`.
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit** — `feat(frontend): AiFeature chat with citation deep-links`

### Task 10: Settings "Knowledge base" subsection + i18n
**Files:** Create `frontend/src/features/ai/components/KnowledgeBaseStatus.tsx`; Modify `shell/components/SettingsModal.tsx` (render it inside `AiTab`), `i18n/locales/{en,ja,zh-CN,zh-TW,yue}.json` (+`settings.knowledgeBase`, `settings.rebuildIndex`, `settings.kbIndexed`, `ai.title`, `ai.welcome`, `ai.placeholder`, `ai.send`, `ai.thinking`, `ai.verifying`, `ai.noEvidence`, `ai.sourceLabel`); Test `frontend/src/features/ai/__tests__/KnowledgeBaseStatus.test.tsx`.
**Interfaces:** `KnowledgeBaseStatus` GETs `/api/ai/index/status`, shows `{indexed}/{total}` + a rebuild button POSTing `/api/ai/index/rebuild`, polling status (reuse the existing search/backup polling idiom — no streaming needed here).
- [ ] **Step 1: Failing test** — render with mocked fetch status; click rebuild → POST fired; strings resolve via i18n (assert `t` keys exist in `en.json`).
- [ ] **Step 2–4:** implement + add all 5 locale files (Japanese/Chinese translations included — CJK, no `%%%`); run → PASS.
- [ ] **Step 5: Commit** — `feat(frontend): knowledge-base settings subsection + i18n`

---

## Milestone B3 — End-to-end, gates, docs

### Task 11: End-to-end wiring test (backend, fake providers)
**Files:** Create `backend/tests/test_kb_e2e.py`.
**Interfaces:** Builds a real `KnowledgeService` with a `FakeEmbedder` + scripted `FakeLLMClient` over a tmp `output/` tree + fixture `members.json`/`aliases.json`; drives `/api/ai/ask` through `TestClient` (patching `get_knowledge_service` to return the wired instance); asserts a "last time A mentioned B" question returns a citation whose `source_ref` deep-links (message fields present) and that a no-evidence question streams `no_evidence`.
- [ ] **Step 1: Write the test (fails first).** — [ ] **Step 2: Run → fail.** — [ ] **Step 3: fix wiring until green.** — [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** — `test(kb): end-to-end ask over synthetic corpus`

### Task 12: Gates + docs (zero-drift)
**Files:** Modify `SakaDesk/CHANGELOG.md`, `SakaDesk/README.md` (feature note); confirm no drift in the spec's verified refs.
- [ ] **Step 1: Backend gate** — `cd SakaDesk && uv run pytest backend/tests -q` (all pass, coverage ≥ 80).
- [ ] **Step 2: Frontend gate** — `cd SakaDesk/frontend && npx vitest run` (+ coverage ≥ threshold) and `npx tsc --noEmit`.
- [ ] **Step 3: Lint/type** — `cd SakaDesk && uv run ruff check backend && uv run mypy backend/api/ai.py backend/services/knowledge_service.py backend/services/knowledge_store.py backend/services/llm_client.py`.
- [ ] **Step 4: Manual smoke (documented, not automated)** — with a real key + a small synced group, `enable` KB, rebuild index, ask "when did A last mention B", click a citation → app jumps to the message and scrolls to it (verifies the reused nav path end-to-end).
- [ ] **Step 5: Docs + commit** — update CHANGELOG/README; `docs(kb): changelog + readme for knowledge-base chatbot`.

---

## Self-Review (spec coverage — Phases 3–4)
- `/api/ai/ask` streaming (two-pass) + index status/rebuild → Task 5 ✅ · `knowledge_service` wiring pysaka engine (not reinvented) → Task 3 ✅ · sqlite persistence for docs+vectors+mentions → Task 1 ✅ · Gemini function-calling `LLMClient` reusing keyring/model → Task 2 ✅ · settings subsection → Tasks 4,10 ✅ · sync-hook + transcript re-index trigger → Task 6 ✅ · scope + `tz` plumbed from browser → Tasks 5,9 ✅ · `AiFeature` chat + citation chips + `no_evidence` state → Task 9 ✅ · citation → in-app deep-link via shared `navigateToSource` (reuses verified nav) → Tasks 7,9 ✅ · `ai` wired into `SERVICE_FEATURES`/`ContentArea` → Task 9 ✅ · i18n across 5 locales → Task 10 ✅ · grounding validator enforced server-side before the answer event → Tasks 3,5 ✅ · gates/docs → Tasks 11,12 ✅.
- **Consistency with Plan A:** all engine types/protocols imported from `pysaka.knowledge` (no redefinition); the SSE citation shape == `SourceRef` == search-result shape == `CitationReference`, so one nav path serves both search and chat.
- **Deliberately deferred (v1.1+, per spec):** on-demand vision for image-only food/outing facts; index-time-extraction premium mode; bge-m3/97m model swaps (config-only, `Embedder` is pluggable); server-side conversation persistence (v1 keeps history client-side).
- **Prerequisite:** Plan A merged into the editable `../pysaka`; the `pysaka[embeddings]` extra provides `OnnxEmbedder`/`NumpyVectorStore` and the Granite model asset is fetched/verified (a small helper or manual step documented at first `rebuild`).
