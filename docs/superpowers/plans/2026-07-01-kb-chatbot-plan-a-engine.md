# KB Chatbot — Plan A: pysaka Engine + CLI Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, UI-agnostic member knowledge-base engine in `pysaka.knowledge` and a `saka-cli` harness that answers grounded, cited questions over locally-synced blogs + messages — validated by a golden-eval gate.

**Architecture:** A pure `pysaka.knowledge` subpackage (entity/alias/index/retrieve/agent) depends only on stdlib + existing `beautifulsoup4` + `pyahocorasick`. Heavy runtime (onnxruntime Granite embedder, numpy vector store) is an **opt-in `pysaka[embeddings]` extra** that provides concrete `Embedder`/`VectorStore` implementations injected at the edge — so the core stays lean and 100%-unit-testable with fakes. `saka-cli` installs the extra and adds `--kb-index`/`--ask` flags that scan the `output/` tree, drive the engine, and print cited answers. Plan B (SakaDesk `/api/ai` + React UI + deep-link wiring) is separate.

**Tech Stack:** Python 3.9+ (async), `uv`, `pytest`+`pytest-asyncio` (`asyncio_mode=auto`), `pytest-cov`, `syrupy`, `time-machine`, `hypothesis`, `beautifulsoup4`, `pyahocorasick`, `structlog`; extra: `onnxruntime`, `numpy`, `tokenizers`. Design spec: `SakaDesk/docs/superpowers/specs/2026-07-01-knowledge-base-chatbot-design.md`.

## Global Constraints
- **uv only.** Every command is `uv run …`; add deps with `uv add` (never `pip`). `uv.lock` is source of truth. (pysaka and saka-cli are **separate** repos — run `uv` inside each.)
- **pysaka purity:** `pysaka.knowledge` core imports **stdlib + beautifulsoup4 + pyahocorasick + structlog only**. **No numpy / onnxruntime / network** in core — those live behind the `[embeddings]` extra (`pysaka.knowledge.backends.*`) and are injected via Protocols.
- **Python floor 3.9:** every module starts `from __future__ import annotations`; PEP 604 unions (`str | None`) allowed only under that import; use `typing.Protocol`, `collections.abc` types.
- **Style:** ruff line-length 120, target py39; dataclasses with `field(default_factory=…)`; `logger = structlog.get_logger(__name__)`; **no `print()`** except CLI interactive prompts; **no `assert`** for validation/security; all file I/O `encoding="utf-8"`; `pathlib.Path` only.
- **Time:** UTC internally; freeze with `time-machine` in temporal tests.
- **Coverage:** 100% of `pysaka.knowledge` core (the `[embeddings]` backends and CLI I/O are integration-tested, not held to 100%).
- **i18n/data:** content is Japanese; test fixtures must include CJK + emoji; **never commit real paid/personal data** — golden fixtures are synthetic (§M4).

---

## Shared Contracts (canonical signatures — every task uses these verbatim)

`pysaka/src/pysaka/knowledge/models.py`:
```python
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime

CanonicalId = str  # f"{group}:{blogId}" — stable, group-scoped, deterministic (D8)

@dataclass
class Member:
    canonical_id: CanonicalId       # f"{group}:{blog_id}"
    group: str                      # "hinatazaka46"
    name: str                       # canonical kanji, e.g. "金村 美玖"
    name_hiragana: str
    name_romaji: str
    generation: int
    status: str                     # "active" | "graduated"
    blog_id: str                    # == members.json blogId (blog-system id)
    message_group_id: int | None = None
    message_member_id: int | None = None
    aliases: list[str] = field(default_factory=list)

@dataclass
class SourceRef:                    # mirrors the app's search-result shape (spec §9.2)
    service: str
    kind: str                       # "blog" | "message"
    blog_id: str | None = None      # kind=blog
    member_id: int | None = None    # kind=blog: blog-system id; kind=message: message member_id
    group_id: int | None = None     # kind=message
    group_name: str | None = None
    member_name: str | None = None
    message_id: int | None = None
    is_group_chat: bool = False

@dataclass
class Document:
    doc_id: str                     # "blog:<svc>:<blog_id>" | "msg:<svc>:<canon_id>:<message_id>"
    source_ref: SourceRef
    author_id: CanonicalId
    group: str
    timestamp: datetime             # UTC, tz-aware
    type: str                       # blog|text_msg|picture_msg|video_msg|voice_msg
    is_favorite: bool
    text: str                       # cleaned; "" for caption-less media
    has_text: bool
    mentions: list[CanonicalId] = field(default_factory=list)

@dataclass
class Chunk:
    chunk_id: str                   # f"{doc_id}#{n}"
    doc_id: str
    text: str                       # unit of lexical/vector indexing
    context_text: str               # text + neighbor window (embedding context only)

@dataclass
class Scope:
    service: str
    group_ids: list[int] = field(default_factory=list)
    member_id: CanonicalId | None = None

@dataclass
class SearchFilters:
    scope: Scope
    author_id: CanonicalId | None = None
    mentions_id: CanonicalId | None = None
    query: str | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None
    type: str | None = None
    has_text: bool | None = None
    sort: str = "relevant"          # "relevant" | "recent"
    limit: int = 10

@dataclass
class Hit:
    doc_id: str
    source_ref: SourceRef
    author: str                     # canonical author name
    timestamp: datetime
    snippet: str
    score: float

@dataclass
class Citation:
    doc_id: str
    source_ref: SourceRef
    quoted_snippet: str             # verbatim JP substring of the cited doc's cleaned text
    member: str
    timestamp: datetime

@dataclass
class AnswerSentence:
    text: str
    citation_ids: list[str]         # doc_ids supporting this sentence

@dataclass
class Answer:
    sentences: list[AnswerSentence]
    citations: list[Citation]
    no_evidence: bool = False
```

`pysaka/src/pysaka/knowledge/protocols.py`:
```python
from __future__ import annotations
from typing import Protocol, runtime_checkable

@runtime_checkable
class Embedder(Protocol):
    dim: int
    def embed(self, texts: list[str], kind: str = "passage") -> list[list[float]]: ...

@runtime_checkable
class VectorStore(Protocol):
    def add(self, ids: list[str], vectors: list[list[float]]) -> None: ...
    def remove(self, ids: list[str]) -> None: ...
    def search(self, vector: list[float], k: int,
               allowed_ids: set[str] | None = None) -> list[tuple[str, float]]: ...

@runtime_checkable
class LexicalIndex(Protocol):
    def add(self, chunk_id: str, text: str) -> None: ...
    def remove(self, chunk_ids: list[str]) -> None: ...
    def search(self, query: str, k: int,
               allowed_ids: set[str] | None = None) -> list[tuple[str, float]]: ...

@dataclass  # in models.py; shown here for context
class ToolCall:  # noqa
    name: str
    arguments: dict

@runtime_checkable
class LLMClient(Protocol):
    async def chat(self, messages: list[dict], tools: list[dict] | None = None) -> "LLMResponse": ...
```
(`ToolCall`, `LLMResponse` are defined in Task 12.)

## File Structure (created by this plan)

```
pysaka/src/pysaka/knowledge/
  __init__.py            public API exports
  models.py              dataclasses above (Task 1)
  cleaner.py             HTML→text, %%% sentinel, canonical normalization (Task 2)
  ingest.py              blog.json / messages.json → Document[] (Task 3)
  registry.py            MemberRegistry: members.json → Member[], 2-keyspace reconcile (Task 4)
  aliases.py             AliasTable: seed derivation + curated loader (Task 5)
  mentions.py            Aho-Corasick mention detection + short-kana guard (Task 6)
  protocols.py           Embedder/VectorStore/LexicalIndex/LLMClient (Task 7)
  chunking.py            message/blog chunking + neighbor window (Task 8)
  store.py               DocumentStore (persist Documents; filter helpers) (Task 9)
  lexical.py             PureLexicalIndex (BM25-lite, kana-normalized) (Task 10)
  retrieve.py            HybridRetriever (RRF fusion + structured filters) (Task 11)
  llm.py                 LLMResponse/ToolCall types + FakeLLMClient (Task 12)
  tools.py               resolve_member/search/get_document/aggregate tool layer (Task 13)
  agent.py               bounded planner loop → Answer (Task 14)
  validator.py           grounding validator (Task 15)
  backends/__init__.py   [embeddings extra] concrete impls (Task 16)
  backends/onnx_embedder.py   Granite R2 via onnxruntime  (Task 16)
  backends/numpy_store.py     numpy flat cosine VectorStore (Task 16)
pysaka/tests/knowledge/  one test module per source module
saka-cli/src/saka_cli/kb.py     KB command module (Task 17)
saka-cli/src/saka_cli/cli.py    +flags & dispatch (Task 17)
pysaka/tests/knowledge/golden/  synthetic fixtures + eval (Task 18)
```

---

## Milestone M0 — Foundations (pure, no external services)

### Task 1: Models + package scaffold
**Files:**
- Create: `pysaka/src/pysaka/knowledge/__init__.py`, `pysaka/src/pysaka/knowledge/models.py`
- Test: `pysaka/tests/knowledge/test_models.py`

**Interfaces:**
- Produces: all dataclasses in *Shared Contracts* (`Member`, `SourceRef`, `Document`, `Chunk`, `Scope`, `SearchFilters`, `Hit`, `Citation`, `AnswerSentence`, `Answer`, type alias `CanonicalId`).

- [ ] **Step 1: Write the failing test**
```python
# pysaka/tests/knowledge/test_models.py
from __future__ import annotations
from datetime import datetime, timezone
from pysaka.knowledge.models import Document, SourceRef, Member

def test_document_defaults_and_fields():
    ref = SourceRef(service="hinatazaka46", kind="blog", blog_id="68177", member_id=12)
    doc = Document(
        doc_id="blog:hinatazaka46:68177", source_ref=ref, author_id="hinatazaka46:12",
        group="hinatazaka46", timestamp=datetime(2026, 3, 3, tzinfo=timezone.utc),
        type="blog", is_favorite=False, text="今日は焼肉", has_text=True,
    )
    assert doc.mentions == []            # default_factory
    assert doc.source_ref.kind == "blog"

def test_member_canonical_id_shape():
    m = Member(canonical_id="hinatazaka46:12", group="hinatazaka46", name="金村 美玖",
               name_hiragana="かねむら みく", name_romaji="Kanemura Miku",
               generation=2, status="active", blog_id="12")
    assert m.canonical_id == f"{m.group}:{m.blog_id}"
    assert m.aliases == []
```

- [ ] **Step 2: Run — expect fail (module missing)**
Run: `cd pysaka && uv run pytest tests/knowledge/test_models.py -v`
Expected: FAIL `ModuleNotFoundError: pysaka.knowledge`

- [ ] **Step 3: Implement** — create `pysaka/src/pysaka/knowledge/__init__.py` (empty for now) and `models.py` containing exactly the dataclasses from *Shared Contracts* (copy verbatim; `from __future__ import annotations` at top).

- [ ] **Step 4: Run — expect pass**
Run: `cd pysaka && uv run pytest tests/knowledge/test_models.py -v` → PASS

- [ ] **Step 5: Commit**
```bash
cd pysaka && uv run git add src/pysaka/knowledge/__init__.py src/pysaka/knowledge/models.py tests/knowledge/test_models.py
uv run git commit -m "feat(knowledge): core dataclasses for KB engine"
```

### Task 2: Text cleaner (HTML→text, `%%%`, canonical normalization)
**Files:** Create `pysaka/src/pysaka/knowledge/cleaner.py`; Test `pysaka/tests/knowledge/test_cleaner.py`
**Interfaces:**
- Consumes: nothing.
- Produces: `SUBSCRIBER_SENTINEL: str` (`""`), `normalize_text(s: str) -> str` (NFKC + width-fold + whitespace-collapse + `%%%`→sentinel), `html_to_text(html: str) -> str` (bs4 `get_text("\n")` then `normalize_text`), `strip_sentinel(s: str) -> str` (sentinel→"you"/removed for display).

- [ ] **Step 1: Failing test**
```python
# pysaka/tests/knowledge/test_cleaner.py
from __future__ import annotations
from pysaka.knowledge.cleaner import html_to_text, normalize_text, SUBSCRIBER_SENTINEL, strip_sentinel

def test_html_to_text_strips_markup_and_keeps_paragraphs():
    html = '<div><p>うだるような暑さ</p><p>焼肉たべた🍖</p></div>'
    assert html_to_text(html) == "うだるような暑さ\n焼肉たべた🍖"

def test_percent_token_becomes_sentinel_not_literal():
    assert SUBSCRIBER_SENTINEL in normalize_text("%%%元気？")
    assert "%%%" not in normalize_text("%%%元気？")

def test_normalize_is_nfkc_and_width_folded():
    assert normalize_text("ﾗｰﾒﾝ　１２３") == "ラーメン 123"

def test_strip_sentinel_renders_you():
    assert strip_sentinel(SUBSCRIBER_SENTINEL + "元気？") == "you元気？"
```

- [ ] **Step 2: Run — expect fail.** `cd pysaka && uv run pytest tests/knowledge/test_cleaner.py -v`

- [ ] **Step 3: Implement**
```python
# pysaka/src/pysaka/knowledge/cleaner.py
from __future__ import annotations
import re, unicodedata
from bs4 import BeautifulSoup

SUBSCRIBER_SENTINEL = ""   # private-use char; never in real content
_WS = re.compile(r"[ \t　]+")
_NL = re.compile(r"\n{2,}")

def normalize_text(s: str) -> str:
    s = s.replace("%%%", SUBSCRIBER_SENTINEL)
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = "\n".join(_WS.sub(" ", line).strip() for line in s.split("\n"))
    return _NL.sub("\n", s).strip()

def html_to_text(html: str) -> str:
    text = BeautifulSoup(html, "html.parser").get_text("\n")
    return normalize_text(text)

def strip_sentinel(s: str, replacement: str = "you") -> str:
    return s.replace(SUBSCRIBER_SENTINEL, replacement)
```
Note: NFKC folds full-width `１２３`→`123` and half-width `ﾗｰﾒﾝ`→`ラーメン`; test expectation matches.

- [ ] **Step 4: Run — expect pass.** Same command → PASS
- [ ] **Step 5: Commit** — `feat(knowledge): text cleaner with %%% sentinel + NFKC normalization`

### Task 3: Ingest blog.json / messages.json → Document[]
**Files:** Create `pysaka/src/pysaka/knowledge/ingest.py`; Test `pysaka/tests/knowledge/test_ingest.py`
**Interfaces:**
- Consumes: `Document`, `SourceRef` (Task 1); `html_to_text`, `normalize_text` (Task 2); a `resolve_author(name: str, group: str) -> str` callback (canonical id lookup, provided by registry — for this task inject a simple `Callable[[str, str], str]`).
- Produces: `ingest_blog(blog_json: dict, service: str, resolve: Callable[[str,str],str]) -> Document`; `ingest_messages(messages_json: dict, service: str, resolve) -> list[Document]`.

- [ ] **Step 1: Failing test** — cover: blog HTML→text + doc_id/source_ref; a text message; a caption-less picture message (`content=None` → `has_text=False`, `text=""`, still a Document); `%%%` normalized.
```python
# pysaka/tests/knowledge/test_ingest.py
from __future__ import annotations
from pysaka.knowledge.ingest import ingest_blog, ingest_messages

RESOLVE = lambda name, svc: f"{svc}:12"  # stub author resolver

def test_ingest_blog_builds_document():
    blog = {"meta": {"id": "68177", "member_name": "金村 美玖",
                      "published_at": "2026-03-03T20:11:00+09:00",
                      "url": "https://x/68177"},
            "content": {"html": "<p>焼肉たべた</p>"}}
    doc = ingest_blog(blog, "hinatazaka46", RESOLVE)
    assert doc.doc_id == "blog:hinatazaka46:68177"
    assert doc.text == "焼肉たべた" and doc.has_text
    assert doc.source_ref.kind == "blog" and doc.source_ref.blog_id == "68177"
    assert doc.timestamp.tzinfo is not None  # tz-aware UTC

def test_ingest_messages_text_and_captionless_media():
    mj = {"member": {"id": 58, "name": "金村 美玖", "group_id": 34},
          "messages": [
            {"id": 1, "timestamp": "2025-08-11T17:00:33Z", "type": "text",
             "is_favorite": False, "content": "%%%元気？"},
            {"id": 2, "timestamp": "2025-08-12T10:20:41Z", "type": "picture",
             "is_favorite": False, "content": None, "media_file": "x.jpg"},
          ]}
    docs = ingest_messages(mj, "hinatazaka46", RESOLVE)
    assert docs[0].has_text and "%%%" not in docs[0].text
    assert docs[1].has_text is False and docs[1].text == ""
    assert docs[1].source_ref.message_id == 2 and docs[1].type == "picture_msg"
```

- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement** `ingest.py`:
```python
from __future__ import annotations
from datetime import datetime, timezone
from typing import Callable
from .cleaner import html_to_text, normalize_text
from .models import Document, SourceRef

_TYPE = {"text": "text_msg", "picture": "picture_msg", "video": "video_msg", "voice": "voice_msg"}

def _to_utc(ts: str) -> datetime:
    ts = ts.replace("Z", "+00:00") if ts.endswith("Z") else ts
    return datetime.fromisoformat(ts).astimezone(timezone.utc)

def ingest_blog(blog_json: dict, service: str, resolve: Callable[[str, str], str]) -> Document:
    meta, html = blog_json["meta"], blog_json.get("content", {}).get("html", "")
    text = html_to_text(html)
    ref = SourceRef(service=service, kind="blog", blog_id=str(meta["id"]),
                    member_id=int(meta["id"]) if str(meta.get("member_id", "")).isdigit() else None)
    return Document(doc_id=f"blog:{service}:{meta['id']}", source_ref=ref,
                    author_id=resolve(meta["member_name"], service), group=service,
                    timestamp=_to_utc(meta["published_at"]), type="blog",
                    is_favorite=False, text=text, has_text=bool(text))

def ingest_messages(messages_json: dict, service: str, resolve: Callable[[str, str], str]) -> list[Document]:
    member = messages_json["member"]
    gid, mid, mname = member.get("group_id"), member["id"], member["name"]
    author = resolve(mname, service)
    out: list[Document] = []
    for m in messages_json.get("messages", []):
        raw = normalize_text(m["content"]) if m.get("content") else ""
        mtype = _TYPE.get(m["type"], "text_msg")
        ref = SourceRef(service=service, kind="message", group_id=gid,
                        member_id=mid, member_name=mname, message_id=m["id"])
        out.append(Document(doc_id=f"msg:{service}:{author}:{m['id']}", source_ref=ref,
                            author_id=author, group=service, timestamp=_to_utc(m["timestamp"]),
                            type=mtype, is_favorite=bool(m.get("is_favorite")),
                            text=raw, has_text=bool(raw)))
    return out
```

- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit** — `feat(knowledge): ingest blogs/messages into Document model`

### Task 4: MemberRegistry (members.json → Member[], 2-keyspace reconcile, new-member provision)
**Files:** Create `pysaka/src/pysaka/knowledge/registry.py`; Test `pysaka/tests/knowledge/test_registry.py`
**Interfaces:**
- Consumes: `Member` (Task 1).
- Produces: `MemberRegistry` with `.from_members_json(data: dict, group: str) -> MemberRegistry`, `.resolve_author(name: str, group: str) -> CanonicalId` (name-normalized; **auto-provisions** an entry for an unknown author keyed by kanji name), `.link_message_ids(group_id: int, member_id: int, name: str)`, `.get(canonical_id) -> Member | None`, `.all() -> list[Member]`, `.unaliased() -> list[Member]`.

- [ ] **Step 1: Failing test** — from a members.json, `resolve_author("金村 美玖", g)` → `"hinatazaka46:12"`; spaces/width variations normalize; unknown author auto-provisions a synthetic entry (canonical name = its default alias) and appears in `.all()`.
```python
# pysaka/tests/knowledge/test_registry.py
from __future__ import annotations
from pysaka.knowledge.registry import MemberRegistry

MEMBERS = {"meta": {"group": "hinatazaka"}, "members": [
    {"blogId": "12", "nameKanji": "金村 美玖", "nameHiragana": "かねむら みく",
     "nameRomaji": "Kanemura Miku", "generation": 2, "status": "active"}]}

def test_resolve_author_by_normalized_name():
    reg = MemberRegistry.from_members_json(MEMBERS, "hinatazaka46")
    assert reg.resolve_author("金村　美玖", "hinatazaka46") == "hinatazaka46:12"  # full-width space
    assert reg.get("hinatazaka46:12").generation == 2

def test_unknown_author_autoprovisions():
    reg = MemberRegistry.from_members_json(MEMBERS, "hinatazaka46")
    cid = reg.resolve_author("新加入 太郎", "hinatazaka46")
    assert reg.get(cid).name == "新加入 太郎"
    assert reg.get(cid) in reg.unaliased()
```

- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement** — normalize names by NFKC + removing all whitespace for the lookup key; canonical_id = `f"{group}:{blogId}"`; auto-provision uses `f"{group}:auto:{normkey}"` and marks the member as unaliased. (Full code in the module; keep `resolve_author` deterministic and side-effecting only on first unknown.)

- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit** — `feat(knowledge): MemberRegistry with name reconciliation + auto-provision`

### Task 5: AliasTable (seed derivation + curated loader)
**Files:** Create `pysaka/src/pysaka/knowledge/aliases.py`; Test `pysaka/tests/knowledge/test_aliases.py`
**Interfaces:**
- Consumes: `MemberRegistry`, `Member`.
- Produces: `AliasTable` with `.seed_from_registry(reg) -> AliasTable` (derives kanji, kanji-no-space, hiragana, romaji, given-name-only), `.load_curated(data: dict)` (merges the §6.4 file, keyed by canonical_id), `.aliases_for(canonical_id) -> list[str]`, `.entries(group) -> list[tuple[str, CanonicalId]]` (alias→member for the scan), `.resolve(text, scope) -> list[CanonicalId]` (nickname→members, group-scoped).

- [ ] **Step 1: Failing test** — seed produces romaji + given-name ("美玖"), curated merge adds "みくちゃん"; `resolve("みく", scope)` → `["hinatazaka46:12"]`; cross-group collision returns both only when scope spans groups.
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement** (seed rules; curated schema exactly per spec §6.4; group-scoped resolve).
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit** — `feat(knowledge): AliasTable seed derivation + curated loader`

### Task 6: Mention detection (Aho-Corasick + short-kana guard)
**Files:** Create `pysaka/src/pysaka/knowledge/mentions.py`; Test `pysaka/tests/knowledge/test_mentions.py`. Add dep: `cd pysaka && uv add pyahocorasick`.
**Interfaces:**
- Consumes: `AliasTable`, `SUBSCRIBER_SENTINEL`.
- Produces: `MentionDetector(alias_entries: list[tuple[str, CanonicalId]])` with `.detect(text: str, author_id: CanonicalId) -> list[CanonicalId]` (excludes author self-mentions; excludes sentinel; **short-kana guard**: aliases ≤2 kana require a boundary/context check).

- [ ] **Step 1: Failing test**
```python
# pysaka/tests/knowledge/test_mentions.py
from __future__ import annotations
from pysaka.knowledge.mentions import MentionDetector

ENTRIES = [("みくちゃん", "g:12"), ("かとし", "g:20"), ("みく", "g:12")]

def test_detects_alias_mention_excluding_self():
    d = MentionDetector(ENTRIES)
    assert d.detect("今日はかとしと会った", author_id="g:12") == ["g:20"]

def test_self_mention_excluded():
    d = MentionDetector(ENTRIES)
    assert d.detect("みくちゃんです", author_id="g:12") == []

def test_short_kana_guard_avoids_substring_false_positive():
    d = MentionDetector(ENTRIES)
    # "みく" must NOT fire inside an unrelated word like "みくびる"
    assert "g:12" not in d.detect("みくびるのは良くない", author_id="g:99")
```

- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement** — build `ahocorasick.Automaton`; on each hit, if `len(alias) <= 2` and alias is all kana, require the following char to be a non-kana boundary (or the alias be surrounded by non-word chars); dedupe; drop author.
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit** — `feat(knowledge): Aho-Corasick mention detection with short-kana guard`

---

## Milestone M1 — Index & retrieval (pure)

### Task 7: Protocols
**Files:** Create `pysaka/src/pysaka/knowledge/protocols.py`; Test `pysaka/tests/knowledge/test_protocols.py`
**Interfaces:** Produces `Embedder`, `VectorStore`, `LexicalIndex`, `LLMClient` (verbatim from *Shared Contracts*).
- [ ] **Step 1: Failing test** — a `FakeEmbedder` (returns deterministic vectors) passes `isinstance(x, Embedder)` (runtime_checkable).
- [ ] **Step 2–4:** implement protocols; run → PASS.
- [ ] **Step 5: Commit** — `feat(knowledge): Embedder/VectorStore/LexicalIndex/LLMClient protocols`

### Task 8: Chunking
**Files:** Create `pysaka/src/pysaka/knowledge/chunking.py`; Test `test_chunking.py`
**Interfaces:**
- Consumes: `Document`, `Chunk`.
- Produces: `chunk_documents(docs: list[Document], max_tokens: int = 400, overlap: float = 0.15, count_tokens: Callable[[str], int] | None = None) -> list[Chunk]`. Messages → 1 chunk each with `context_text` = prev+self+next (same author, ≤ gap); blogs → paragraph-boundary windows of ~`max_tokens` with `overlap`. Default token count = whitespace+CJK-char heuristic (pure) so core needs no tokenizer.
- [ ] **Step 1: Failing test** — a long blog yields >1 chunk with overlap; a message yields exactly 1 chunk whose `context_text` includes its neighbor; caption-less docs (`has_text=False`) yield **no** chunk.
- [ ] **Step 2–4:** implement; run → PASS.
- [ ] **Step 5: Commit** — `feat(knowledge): document chunking with neighbor context`

### Task 9: DocumentStore
**Files:** Create `pysaka/src/pysaka/knowledge/store.py`; Test `test_store.py`
**Interfaces:**
- Consumes: `Document`, `SearchFilters`, `Scope`.
- Produces: `DocumentStore` with `.upsert(docs)`, `.get(doc_id) -> Document | None`, `.filter(filters: SearchFilters) -> list[Document]` (applies scope/author/mentions/date/type/has_text; `sort=recent` orders by timestamp desc), `.content_hash(doc) -> str`, in-memory dict + optional `save_json(path)/load_json(path)` (utf-8).
- [ ] **Step 1: Failing test** — filter by `author_id`, by `mentions_id`, by `date_from/date_to` (freeze with time-machine), `sort=recent` returns newest first, `has_text=True` excludes metadata-only docs.
- [ ] **Step 2–4:** implement; run → PASS.
- [ ] **Step 5: Commit** — `feat(knowledge): DocumentStore with structured filters`

### Task 10: PureLexicalIndex (BM25-lite, kana-normalized)
**Files:** Create `pysaka/src/pysaka/knowledge/lexical.py`; Test `test_lexical.py`
**Interfaces:**
- Consumes: `LexicalIndex` protocol, `normalize_text`.
- Produces: `PureLexicalIndex()` implementing `LexicalIndex`; character-trigram tokenizer over normalized text (matches the app's kata→hira intent — fold katakana→hiragana in a helper), BM25-lite scoring; `allowed_ids` restricts candidates.
- [ ] **Step 1: Failing test** — indexing 3 chunks, a query returns the most lexically-similar chunk first; katakana query matches hiragana content; `allowed_ids` filters.
- [ ] **Step 2–4:** implement (pure Python; no numpy — accumulate scores in dicts); run → PASS.
- [ ] **Step 5: Commit** — `feat(knowledge): pure-Python lexical index (BM25-lite, kana-folded)`

### Task 11: HybridRetriever (RRF fusion + structured filters)
**Files:** Create `pysaka/src/pysaka/knowledge/retrieve.py`; Test `test_retrieve.py`
**Interfaces:**
- Consumes: `DocumentStore`, `LexicalIndex`, `VectorStore`, `Embedder`, `SearchFilters`, `Hit`, `Chunk`.
- Produces: `HybridRetriever(store, lexical, vectors, embedder)` with `.index(chunks: list[Chunk])` and `.search(filters: SearchFilters) -> list[Hit]`. Applies structured filters via `store.filter` → candidate `allowed_ids` (doc→chunk mapping) → lexical + vector top-k → **RRF fuse (k=60, equal weight)** → map chunks back to docs → build `Hit` (snippet = best chunk text truncated). `sort=recent` bypasses ranking and orders candidates by timestamp.
- [ ] **Step 1: Failing test** — with a `FakeEmbedder`/`FakeVectorStore`, a query where lexical and vector disagree still returns a sensible RRF order; `author_id` filter constrains results; `sort=recent, limit=1` returns the newest matching doc (the "last time" case).
- [ ] **Step 2–4:** implement; run → PASS.
- [ ] **Step 5: Commit** — `feat(knowledge): HybridRetriever with RRF fusion + structured filters`

---

## Milestone M2 — Agent, tools, grounding

### Task 12: LLM types + FakeLLMClient
**Files:** Create `pysaka/src/pysaka/knowledge/llm.py`; Test `test_llm.py`
**Interfaces:**
- Produces: `@dataclass ToolCall{name:str, arguments:dict, id:str}`, `@dataclass LLMResponse{text:str|None, tool_calls:list[ToolCall]}`, and `FakeLLMClient(script: list[LLMResponse])` implementing `LLMClient` (returns scripted responses in order; records received messages/tools for assertions).
- [ ] **Step 1: Failing test** — `FakeLLMClient([...])` returns queued responses; `isinstance(fake, LLMClient)`.
- [ ] **Step 2–4:** implement; run → PASS.
- [ ] **Step 5: Commit** — `feat(knowledge): LLM response types + scriptable FakeLLMClient`

### Task 13: Tool layer
**Files:** Create `pysaka/src/pysaka/knowledge/tools.py`; Test `test_tools.py`
**Interfaces:**
- Consumes: `AliasTable`, `HybridRetriever`, `DocumentStore`, `Scope`, `SearchFilters`, `Hit`.
- Produces: `TOOL_SCHEMAS: list[dict]` (JSON tool defs for `resolve_member`, `search`, `get_document`, `aggregate`) and `ToolRunner(aliases, retriever, store)` with `.run(call: ToolCall, scope: Scope) -> dict` dispatching each tool; returns JSON-serializable results (hits carry `doc_id` + `source_ref` so the agent can cite). `aggregate` returns `{count, by_bucket}` for date-bucketed filters.
- [ ] **Step 1: Failing test** — `resolve_member({"text":"みく"})` → member list; `search({"author_id":..,"sort":"recent","limit":1})` → 1 hit; `get_document({"doc_id":..})` → text; `aggregate` returns counts. Assert `search` results include `doc_id` + `source_ref`.
- [ ] **Step 2–4:** implement; run → PASS.
- [ ] **Step 5: Commit** — `feat(knowledge): tool schemas + ToolRunner dispatch`

### Task 14: Agent planner loop
**Files:** Create `pysaka/src/pysaka/knowledge/agent.py`; Test `test_agent.py`
**Interfaces:**
- Consumes: `LLMClient`, `ToolRunner`, `TOOL_SCHEMAS`, `Scope`, `Answer`, `AnswerSentence`.
- Produces: `KnowledgeAgent(llm, tools, max_steps=6)` with `async .ask(question: str, scope: Scope, history: list[dict] | None = None) -> tuple[Answer, set[str]]` (returns the answer plus the set of `doc_id`s surfaced this conversation — for the validator). Loop: send question+tools → while response has tool_calls and steps<max: run tools, append results, re-call → final response must be the structured-answer JSON (`{sentences:[{text,citation_ids}]}`) → parse into `Answer`. Records every `doc_id` returned by any `search`/`get_document`.
- [ ] **Step 1: Failing test** — with a `FakeLLMClient` scripted as [resolve→search→final-structured-answer], `ask("when did A mention B", scope)` runs exactly the scripted tools and returns an `Answer` whose sentence `citation_ids` reference a surfaced `doc_id`; `max_steps` bound respected (a runaway script stops).
- [ ] **Step 2–4:** implement; run → PASS.
- [ ] **Step 5: Commit** — `feat(knowledge): bounded agent planner loop`

### Task 15: Grounding validator
**Files:** Create `pysaka/src/pysaka/knowledge/validator.py`; Test `test_validator.py`
**Interfaces:**
- Consumes: `Answer`, `AnswerSentence`, `Citation`, `DocumentStore`, `strip_sentinel`.
- Produces: `validate(answer: Answer, surfaced_doc_ids: set[str], store: DocumentStore, threshold: float = 0.9) -> Answer`. Rules: drop any sentence whose `citation_ids` include a doc **not** in `surfaced_doc_ids`; for each citation build a `Citation` and require `quoted_snippet` to match the cited doc's cleaned text at token-set ratio ≥ threshold (normalized per Task 2) — else drop the sentence; if all sentences dropped → `Answer(no_evidence=True)`. Pure Python token-set ratio (no external fuzzy dep).
- [ ] **Step 1: Failing test** — a fabricated `doc_id` sentence is dropped; a paraphrased (non-substring) quote is dropped; a verbatim-JP quote (EN prose sentence) passes; empty result → `no_evidence=True`.
- [ ] **Step 2–4:** implement; run → PASS.
- [ ] **Step 5: Commit** — `feat(knowledge): structured-citation grounding validator`

### Task 16: `[embeddings]` extra — Granite ONNX embedder + numpy store
**Files:** Create `pysaka/src/pysaka/knowledge/backends/__init__.py`, `backends/onnx_embedder.py`, `backends/numpy_store.py`; Test `pysaka/tests/knowledge/test_backends.py` (marked `@pytest.mark.integration`, excluded from the 100%-core gate). Add extra: edit `pysaka/pyproject.toml` `[project.optional-dependencies]` → `embeddings = ["onnxruntime>=1.17", "numpy>=1.24", "tokenizers>=0.15"]`; `uv sync --extra embeddings`.
**Interfaces:**
- Consumes: `Embedder`, `VectorStore` protocols.
- Produces: `NumpyVectorStore()` (flat cosine; implements `VectorStore`), `OnnxEmbedder(model_dir: Path, prefix_scheme: str = "granite")` (implements `Embedder`; applies model-specific input formatting — Granite: none; e5: `query:`/`passage:`; mean-pool + L2-normalize; runs under `onnxruntime`; `dim` from model). Model files loaded from a local dir (download/verify is Plan B / a helper script, not core).
- [ ] **Step 1: Failing test (unit, no model): `NumpyVectorStore`** — add 3 vectors, `search` returns nearest by cosine, `allowed_ids` filters, `remove` works. (Pure numpy; always runs.)
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement `numpy_store.py`.**
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Integration test `OnnxEmbedder`** — `@pytest.mark.integration`; skipped unless `SAKA_TEST_MODEL_DIR` env points to a model; asserts `embed(["焼肉"])` returns a `dim`-length normalized vector. (Documents the contract without shipping weights in CI.)
- [ ] **Step 6: Commit** — `feat(knowledge): [embeddings] extra — Granite ONNX embedder + numpy vector store`

---

## Milestone M3 — saka-cli harness

### Task 17: `saka-cli` `--kb-index` / `--ask`
**Files:** Create `saka-cli/src/saka_cli/kb.py`; Modify `saka-cli/src/saka_cli/cli.py` (`get_parser()` + `main()` dispatch); add i18n keys to `saka-cli/src/saka_cli/strings.py`; Test `saka-cli/tests/test_kb.py`. Deps: `cd saka-cli && uv add --optional embeddings 'pysaka[embeddings]'` (or ensure the editable pysaka provides the extra) — the CLI uses the real Granite embedder + numpy store.
**Interfaces:**
- Consumes: `pysaka.knowledge` public API (registry, aliases, ingest, chunking, store, lexical, retrieve, tools, agent, validator, backends), an `LLMClient` adapter over the user's configured provider (a minimal Gemini adapter lives in `kb.py` for the CLI; the shared adapter is formalized in Plan B).
- Produces: `KnowledgeBase(output_dir: Path, service: str)` with `.build_index()` (scan `output/<display>/**/messages.json` + `output/<display>/blogs/**/blog.json`, ingest, mention-detect, embed, persist under `output/.kb/<service>/`), and `async .ask(question) -> Answer`; `run_kb_command(...)` invoked from `main()`.
- **Group display-name mapping:** reuse `pysaka.client.GROUP_CONFIG` / `Group` to map `service` → the Japanese display dir (e.g. `hinatazaka46` → `日向坂46`).
- **Output:** cited answers via `logger.info(...)` (structlog); `--kb-format json` prints a JSON payload (`print()` allowed only for the machine-readable JSON path). Each printed citation shows member · date · snippet · a `source_ref` (so Plan B's UI can deep-link).

- [ ] **Step 1: Failing test** — build a `tmp_path` fake `output/日向坂46/messages/34 金村 美玖/58 金村 美玖/messages.json`; `KnowledgeBase(tmp_path, "hinatazaka46").build_index()` discovers it and produces a populated `DocumentStore`; assert doc count + that a text message is indexed. (Uses a `FakeEmbedder`/`FakeLLMClient` injected for the test — no network, no model.)
```python
# saka-cli/tests/test_kb.py (excerpt)
import json, pytest
from pathlib import Path
from saka_cli.kb import KnowledgeBase

@pytest.mark.asyncio
async def test_build_index_discovers_messages(tmp_path):
    d = tmp_path / "日向坂46" / "messages" / "34 金村 美玖" / "58 金村 美玖"
    d.mkdir(parents=True)
    (d / "messages.json").write_text(json.dumps({
        "member": {"id": 58, "name": "金村 美玖", "group_id": 34},
        "messages": [{"id": 1, "timestamp": "2025-08-11T17:00:33Z",
                      "type": "text", "is_favorite": False, "content": "焼肉たべた"}]
    }, ensure_ascii=False), encoding="utf-8")
    kb = KnowledgeBase(tmp_path, "hinatazaka46", embedder=_FakeEmbedder())
    await kb.build_index()
    assert kb.store.get("msg:hinatazaka46:hinatazaka46:auto") is None  # sanity
    assert any(doc.text == "焼肉たべた" for doc in kb.store.all())
```
(`_FakeEmbedder` defined in the test file; members.json for the group is loaded from a fixture or the real `SakaDesk/data/members` copy vendored into the test.)

- [ ] **Step 2: Run — expect fail.** `cd saka-cli && uv run pytest tests/test_kb.py -v`
- [ ] **Step 3: Implement** `kb.py` (`KnowledgeBase`, `run_kb_command`) + wire `--ask/--kb-index/--kb-format` into `get_parser()` and dispatch in `main()` before the sync path, guarded by `args.service`.
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Snapshot test** the `--help` output including new flags (`syrupy`, following `test_cli_snapshots.py`); run `uv run pytest tests/ -v`.
- [ ] **Step 6: Commit** — `feat(cli): kb index + ask commands over synced data`

---

## Milestone M4 — Golden-eval quality gate

### Task 18: Synthetic golden fixtures + eval runner
**Files:** Create `pysaka/tests/knowledge/golden/corpus.json` (synthetic blogs+messages mimicking real 3-shape IDs / aliases / `%%%` / kanji + emoji), `golden/cases.json` (question → expected `doc_id` citations + expected `no_evidence` cases), `golden/members.json`, `golden/aliases.json`; Create `pysaka/tests/knowledge/test_golden.py`.
**Interfaces:**
- Consumes: full engine (registry, aliases, ingest, chunking, store, lexical, retrieve, tools, agent, validator) with a **deterministic `FakeEmbedder`** + a **rule-based `ScriptedLLMClient`** (maps known questions → tool plans + structured answers) so the gate is deterministic and offline.
- Produces: `run_golden() -> dict` computing **citation precision/recall** vs expected; `test_golden_gate` asserts precision ≥ 0.9 and recall ≥ 0.7 (numbers documented in spec §11) and that `no_evidence` cases return `no_evidence=True`. Includes cross-lingual (EN question → JP corpus) and alias-completeness-sensitivity cases.
- [ ] **Step 1: Write fixtures** (synthetic; CJK+emoji; ≥ 2 members, ≥ 12 docs, ≥ 6 cases incl. "last mention", "food past month", a "no evidence" case, an EN query).
- [ ] **Step 2: Write failing `test_golden.py`** (imports a not-yet-written `run_golden`). Run → FAIL.
- [ ] **Step 3: Implement `run_golden`** in `test_golden.py` (or a small `pysaka/src/pysaka/knowledge/eval.py`, exported) wiring the engine end-to-end over the fixtures.
- [ ] **Step 4: Run — expect pass** (tune the `ScriptedLLMClient` plans until the gate passes honestly; do NOT relax thresholds to pass — fix retrieval/validator instead).
Run: `cd pysaka && uv run pytest tests/knowledge/test_golden.py -v`
- [ ] **Step 5: Commit** — `test(knowledge): synthetic golden-eval gate (citation precision/recall)`

### Task 19: Public API + coverage gate + docs
**Files:** Modify `pysaka/src/pysaka/knowledge/__init__.py` (export public surface), `pysaka/README.md` (short "Knowledge engine" section), `pysaka/CHANGELOG.md`.
**Interfaces:** Produces the documented public API: `MemberRegistry, AliasTable, DocumentStore, HybridRetriever, KnowledgeAgent, validate, Document, Member, Citation, Answer, Scope, SearchFilters` and protocols.
- [ ] **Step 1: Failing test** — `test_public_api.py` imports every name from `pysaka.knowledge` and asserts presence.
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement `__init__.py` exports; write README/CHANGELOG entries (zero-drift: match code).**
- [ ] **Step 4: Full core coverage run** — `cd pysaka && uv run pytest tests/knowledge -m 'not integration' --cov=pysaka.knowledge --cov-report=term-missing` → assert **100%** for core modules (backends excluded).
- [ ] **Step 5: Lint/type** — `cd pysaka && uv run ruff check src/pysaka/knowledge && uv run ruff format --check src/pysaka/knowledge && uv run mypy src/pysaka/knowledge`.
- [ ] **Step 6: Commit** — `feat(knowledge): public API, docs, 100% core coverage`

---

## Self-Review (spec coverage)
- Entity/alias/%%%/2-keyspace/synthetic-id → Tasks 1,2,4,5 ✅ · mention detection + short-kana guard → Task 6 ✅ · Document + metadata-only media → Tasks 1,3,8,9 ✅ · protocols + injected embedder (purity) → Tasks 7,16 ✅ · lexical (pure) + RRF hybrid + structured filters + sort=recent → Tasks 10,11 ✅ · agent bounded loop + tools + aggregate → Tasks 12,13,14 ✅ · structured-citation grounding validator (verbatim-JP substring, threshold, no-evidence) → Task 15 ✅ · Granite ONNX + numpy store extra → Task 16 ✅ · CLI harness over real `output/` + group display mapping + cited output → Task 17 ✅ · synthetic golden gate w/ precision/recall + cross-lingual + no-evidence → Task 18 ✅ · public API + 100% core coverage + lint/type → Task 19 ✅.
- **Deferred to Plan B (out of scope here, by design):** SakaDesk `/api/ai/*`, React `AiFeature`, `navigateToSource` deep-link wiring, sync-hook + transcript re-index trigger integration, provider-config reuse (the CLI ships a minimal Gemini adapter as a stand-in), streaming two-pass UX, timezone `tz` plumbing from the browser.
- **Note on lexical arm:** pysaka core uses its own pure `PureLexicalIndex`; SakaDesk's reuse of the existing `search_index.db` FTS5 is a Plan-B `LexicalIndex` adapter — the Protocol makes them interchangeable.
