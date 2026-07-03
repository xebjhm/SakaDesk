# Design: Member Knowledge-Base Chatbot (grounded, cited)

- **Date:** 2026-07-01
- **Status:** Approved design — revised after adversarial review; ready for implementation planning
- **Primary repo:** SakaDesk (product/feature owner). Pure engine lives in **pysaka**; also usable by **saka-cli**.
- **Feature branch:** `feat/kb-chatbot` (off `dev`)

> **Revision note (post-review).** This spec was reviewed against the live codebase by four adversarial lenses (codebase-accuracy, architecture-feasibility, deps/purity, completeness). Material corrections folded in: blog FTS5 **already exists and is sync-wired** (not new work); it is **2 ID keyspaces, not 3**; the DB is `search_index.db`; the embedding runtime is **inverted out of pysaka** behind an `Embedder` protocol; query **scope**, **streaming vs. validation**, **canonical key**, **conversation state**, and the **grounding-validator mechanism** are now pinned; the product promise is reframed as **grounded best-effort with explicit partial-ness**. See §17 for the full disposition.

---

## 1. Goal

Let a SakaDesk user ask natural-language questions about idol **members**, answered **only from facts** in their locally-synced **blogs** and **messages**, where every answer carries **citations that jump to the exact blog/message in the app**.

Representative questions (the design targets this *class*, not a fixed FAQ):

- "When is the last time member A mentioned member B?"
- "Where did A and B go on their last outing?"
- "What food did A eat in the past month?"
- "Does A like food X?"

These are **temporal + relational + aggregate** queries over a **growing** corpus. That shape drives every choice below.

**Product promise (honest framing).** The bot returns **grounded best-effort** answers with **explicit partial-ness**: every claim is cited and verifiable, but for enumerate/aggregate/superlative questions it says "here's what I found," not "here is everything." It never fabricates and never answers without a reference. See §7.6 for why "complete/authoritative" is not achievable in v1 and what would raise the ceiling.

## 2. Scope & non-goals (v1)

**In:** blog body text, message text + photo/video **captions**, and voice **transcripts that already exist**; grounded Q&A with clickable citations; nickname/alias resolution; temporal/relational/aggregate queries as best-effort.

**Out (v1), each accommodated by pluggable interfaces:**
- **Vision understanding** — captioning/OCR of caption-less images, video-frame understanding. **Consequence to accept or revisit:** dish identity and outing location frequently live *in the photo/video* while the caption is vague/emoji (see §4.1 coverage data), so the **food** and **outing** examples are served only when the fact is in text/caption. On-demand vision (call a vision model on candidate images at query time) is the recommended **v1.1** mitigation and is the one item flagged for your decision (§16).
- **Bulk voice transcription** at index time (we index transcripts the user already generated; bulk is a later opt-in).
- **Index-time LLM fact-extraction** as default (future *premium* strategy behind the same `Indexer` interface).
- **New LLM provider config** — reuse the existing AI-settings provider/model/keyring (Gemini + hidden OpenAI). No Anthropic in v1.
- Chit-chat: no evidence ⇒ say so.

## 3. Key decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Shipped SakaDesk feature** (end users, own key, own archive) | Sets free-tier & privacy constraints |
| D2 | Default = **Local Hybrid retrieval**; index/retrieval is a **pluggable strategy** | Free-tier-safe & private; premium extraction can drop in later |
| D3 | **Agentic tool-use** engine (not single-shot RAG) | Only way to serve temporal/relational/aggregate |
| D4 | **Nicknames:** user-provided **source-of-truth alias file** + **auto-derived seed** + optional offline internet-mining | Deterministic, extensible; seed removes the hard human-prerequisite |
| D5 | **Text-first v1** (blog text + message text/captions + existing voice transcripts) | Cheap, local-first; vision is pluggable v1.1 (§16) |
| D6 | **Pure engine in pysaka**; heavy/native runtime (embeddings, vector store) **injected from SakaDesk** | Architecture-purity + lean MIT SDK published to PyPI |
| D7 | **Grounded best-effort** product promise with explicit partial-ness | Only honest stance given recall limits on a growing corpus |
| D8 | **Canonical member key = synthetic stable id**; all source IDs attached as attributes | Avoids cross-keyspace/cross-group collisions |
| D9 | **One design spec, two implementation plans** (A: engine+CLI; B: integration+UI) | Focused build/review cycles |

## 4. Data landscape (verified against code)

### 4.1 On-disk content & coverage
- **Blogs:** `output/<service>/blogs/<member>/<YYYYMMDD_id>/blog.json` (~7,768). `meta{id, member_name, title, published_at, url}` + `content.html`. Group-level `blogs/index.json` maps **blog-system member id** → name → blog metadata.
- **Messages:** `output/<service>/messages/<group_id> <group>/<member_id> <member>/messages.json`. Each `{id, timestamp(UTC "…Z"), type: text|picture|video|voice, is_favorite, content(nullable), media_file?, width?, height?, media_duration?}`.
- **Voice transcripts:** `transcriptions.json` **sidecars** next to `messages.json`, **generated on-demand** by the existing Transcription feature (⇒ many voice messages have none yet; see §6.5 re-index trigger).
- **Coverage reality (sampled):** ≈67% of messages are text, ≈33% media; **video message `content` is ~100% empty**; picture captions usually exist but are often vague/emoji ("🍜", "今日のランチ🥰"); voice is text only where a transcript sidecar exists. ⇒ text-first is high-value but **cannot** answer facts that live only in images/video (§2, §16).

### 4.2 The `%%%` token
Message `content` contains `%%%` = the **subscriber's own name** substitution. It is **not** a member. Normalize to a neutral sentinel excluded from index/embeddings/mention-detection; render as "you" only at display time.

### 4.3 Member ID keyspaces (corrected: **two**, not three)
- **Blog keyspace:** `members.json` `blogId` **is** the blog-system member id — the same key used in `blogs/index.json`. Verified: 29/30 hinatazaka `blogId`s match blog-index keys exactly, 0 name mismatches ⇒ **members.json ↔ blogs is a direct numeric join on `blogId`**.
- **Message keyspace:** `group_id` / `member_id` from the message paths — a **disjoint** numbering (金村 美玖 = `blogId 12` but message `group_id 34 / member_id 58`). This is the only join that needs **name-based reconciliation** (normalized kanji name).
- `MemberRegistry` therefore assigns a **synthetic canonical id** (D8) and attaches `{blogId, message_group_id, message_member_id, generation, status, group}`; the blog side is a direct join, only the message side is name-reconciled.

### 4.4 Existing infrastructure (verified) to reuse
- **AI settings tab** (`frontend/src/shell/components/SettingsModal.tsx` `AiTab`): provider **Gemini** (OpenAI present-but-hidden), model, API key in **OS keyring**, Test Connection, target language (en/zh-TW/zh-CN/yue). Endpoints `/api/translation/*`.
- **LLM provider abstraction** `backend/services/translation_service.py` — `GeminiProvider`, `OpenAIProvider`, exposing only `translate()`/`check_connection()`. **No tool/function-calling exists anywhere today** ⇒ the agent/tool-calling layer (§8) is **greenfield**.
- **SQLite FTS5 index** at **`get_app_data_dir()/search_index.db`** (`~/.SakaDesk` on Linux/Mac, `%LOCALAPPDATA%\SakaDesk` on Windows): **both** `search_messages`/`search_messages_fts` **and** `search_blogs`/`search_blogs_fts` (trigram tokenizer, katakana→hiragana normalization) with insert/delete/update triggers, full-build + incremental workers — **already sync-wired** (messages: `sync_service.py:543`; blogs: `blog_service.py:1336`). ⇒ Lexical indexing of blogs **is done**; do not re-build it.
- **`ai` FeatureId already stubbed** in `frontend/src/config/features.ts` (Bot icon, "AI Agent"/"AIエージェント"), **not yet** in `SERVICE_FEATURES`.
- **Deep-linking already works** (see §9), verified.
- Stack: FastAPI + uvicorn (127.0.0.1) backend; React 18 + TS + Zustand + Vite + Tailwind frontend; pywebview desktop shell.

## 5. Architecture & dependency placement

```
pysaka/  (pure, UI-agnostic, lean MIT SDK, py3.9+, published to PyPI)
  entity/     MemberRegistry (synthetic ids + name reconciliation) · AliasTable (+seed, %%%)
  index/      Indexer / Embedder / VectorStore  ── PROTOCOLS ONLY (no native runtime)
  retrieve/   Retriever protocol → HybridRetriever (lexical ⊕ vector, RRF)  [pure algorithm]
  agent/      LLMClient protocol · tool schemas · planner loop · grounding validator
  deps: pure-Python only (reuse existing beautifulsoup4; + pyahocorasick* for alias scan)

SakaDesk/  (GPL-3.0, py3.12, owns paths/keyring/sync; ships the pywebview app)
  backend/services/knowledge_service.py   wires pysaka engine; supplies concrete
      OnnxEmbedder (onnxruntime + e5) and VectorStore (numpy flat) implementations
  backend/services/embedding_service.py   model load/verify/cache (SakaDesk-only)
  backend/api/ai.py                        /api/ai/ask (stream), /api/ai/index/*
  frontend/features/ai/                    AiFeature chat + citation chips
  frontend/(shared) navigateToSource()     citation → in-app jump (refactored from search)
  data/members/*.json  +  data/aliases/*.json   (alias file = your source of truth)
```

**Embedding dependency is inverted (fixes the purity violation).** pysaka defines `Embedder.embed(texts) -> list[vector]` and `VectorStore` **protocols**; SakaDesk supplies the concrete `onnxruntime` + model implementation and injects it — exactly mirroring the `LLMClient` injection. pysaka keeps only pure logic (chunking, RRF, mention detection, entity resolution) and stays unit-testable with a fake `Embedder`.

**Dependency-placement matrix:**

| Dependency | Repo | License | Note |
|---|---|---|---|
| `beautifulsoup4` (HTML→text) | pysaka (already present) | MIT-compatible | reuse; **forbid** GPL `html2text` in pysaka |
| `pyahocorasick`* (alias scan) | pysaka core | BSD-3 | verify py3.9 + wheels; fallback `ahocorasick_rs` (MIT) or pure-Python trie |
| `onnxruntime` + embedding model (**Granite R2 multilingual**) | **SakaDesk backend only** | Apache-2.0 | native+heavy; never a pysaka dep (would bloat all PyPI consumers, risks py3.9) |
| vector search (**numpy flat**) | SakaDesk backend | BSD | numpy arrives with onnxruntime; no sqlite-vec/hnswlib by default (§6.6) |

**Pluggability (D2):** `Indexer`/`Retriever`/`Embedder`/`VectorStore` are protocols. Default = lexical (existing FTS5) ⊕ vector (injected embedder + numpy store). Future premium = `ExtractionIndexer`. Lexical-only is the built-in fallback (with the EN/ZH caveat in §10).

## 6. Data model & indexing

### 6.1 Canonical document
```
Document
  doc_id       blog:<service>:<blog_id>  |  msg:<service>:<canonical_member_id>:<message_id>
  source_ref   §9.2 (mirrors the search-result shape for drop-in navigation)
  author_id    synthetic canonical member id (D8)
  group        service/group
  timestamp    UTC (blog published_at | message timestamp)
  type         blog | text_msg | picture_msg | video_msg | voice_msg
  is_favorite  bool
  text         cleaned text (§6.2) — MAY be empty for caption-less media
  has_text     bool (false ⇒ metadata-only doc: retrievable by date/type, citable, not embedded)
  mentions     [canonical member ids]  (alias-form references only; §6.4)
```
**Caption-less media** (common; §4.1) become **metadata-only Documents** (`has_text=false`): retrievable via date/type filters and citable ("the last picture A sent"), but not embedded and never quoted. This keeps temporal/"last post" queries answerable while honoring the no-vision non-goal.

### 6.2 Text extraction & cleaning
- **Blog:** `beautifulsoup4` `get_text(separator="\n")` → paragraph-preserving plain text (**no new dep**).
- **Message:** `content` may be `null` → metadata-only doc (§6.1). `%%%` → neutral sentinel (excluded from index/embeddings/mentions; "you" at display).
- **Voice:** transcript from `transcriptions.json` sidecar when present.
- **Canonical normalization (single source of truth for indexing AND the validator, §7.3):** NFKC, full/half-width folding, whitespace collapse, `%%%`→sentinel. `get_document` returns this exact canonical text so validator substring/fuzzy matches are well-defined.

### 6.3 Chunking (concrete)
- **Tokenizer:** the embedding model's own tokenizer (e5/bge) defines token counts.
- **Message** = one chunk; embedding context = **±1 neighboring message** (context only; each chunk keeps its own `source_ref`).
- **Blog** = **400-token** chunks on paragraph boundaries, **~15% overlap**; each chunk carries the parent `source_ref` + chunk offset.

### 6.4 Entity / alias layer
- **`MemberRegistry`** — synthetic canonical ids (D8); blog side direct-joined on `blogId`, message side name-reconciled (§4.3). **New members** auto-provision on sync from `data/members/<group>.json`; a document whose author isn't yet registered auto-provisions an entry keyed by kanji name with the canonical name as its default alias (never dropped/uncited). Index status surfaces an **"unaliased members"** warning.
- **`AliasTable`** — keyed by **synthetic canonical id**, scoped **per group** (nicknames collide across groups). Sources, in precedence: (1) **auto-derived seed** (kanji, hiragana, romaji, given-name-only — removes the human prerequisite), (2) **your curated source-of-truth file** (recall-improving, not required), (3) optional offline **internet-mining** build script that only *proposes*. Schema:
  ```json
  {
    "meta": { "group": "hinatazaka", "updated": "2026-07-01", "source": "seed+curated" },
    "members": {
      "canon_0xxxx": {
        "canonical": "金村 美玖",
        "ids": { "blogId": "12", "message_group_id": 34, "message_member_id": 58 },
        "aliases": ["みくちゃん", "みく", "Miku", "かねむらみく"],
        "origin": "seed|curated|mined"
      }
    }
  }
  ```
- **Mention detection (index time):** Aho-Corasick multi-pattern scan over the group's aliases → `mentions=[…]`. **Precision-oriented, not recall-complete** — it captures only *alias-form* references; pronouns/first-name-only/pure-context references ("今日は3人で…") are **not** detected (this bounds §7.2's "mention" questions; see §7.6). Guards: author's own aliases → self-mention flag; alias → 2 members stores both; **short-kana guard** (2-char kana aliases require length/boundary/context heuristics to avoid substring false-positives in boundary-free Japanese); `%%%` never a member.

### 6.4a Reference data types (provided under `data/knowledge/<service>/`)
The user-provided source-of-truth (§16.2) is richer than a flat alias list, so each type gets its own representation, all keyed to canonical member ids and generated by `scripts/build_<group>_kb.py`:
- **`aliases.json`** → the `AliasTable` (§6.4): unioned with auto-seed for `resolve_member` + mention detection.
- **`call_names.json`** → a **directional** caller→callee→names graph. Two uses beyond aliases: (a) the agent answers *"how does A call B"* directly; (b) **higher-precision mention detection** — when scanning member A's own text, resolve a nickname using A's *specific* call-names for the target rather than the global alias union, which defuses common-word collisions (e.g. `桜`, `なお`, `ゆう`). Recommend the mention detector consult call-names when the document author is known.
- **`units.json`** → pair/combi/unit registry: resolves *"the [unit] pair"* → members and answers *"what combis is A in / who is [unit]"*.
- **glossary** (deferred) → when extracted safely, each term becomes a **reference `Document`** (`type:"reference"`) with an external `source_ref` (wiki URL), so terms flow through the same retrieval + citation pipeline and the agent cites a definition to its source. Extraction must throttle for 429s and verify every related member against the registry.

### 6.5 Indexing pipeline & incrementality
Piggyback the **existing sync hook** that already runs FTS5 indexing. Lexical (messages+blogs) is **already done** in `search_index.db`; the **new** per-doc work into the knowledge store:
1. compute a **cross-lingual embedding** via the **injected `Embedder`** (SakaDesk `onnxruntime` impl). **Default model: `ibm-granite/granite-embedding-311m-multilingual-r2`** (Apache-2.0; explicit cross-lingual training incl. Japanese; ships ONNX/OpenVINO for CPU; 768-dim, ~150 MB int8; ~65 Multilingual-MTEB retrieval). Apply **model-specific input formatting** (Granite needs no prefix; e5 needs `query:`/`passage:`) + NFKC. **Footprint downshift:** `granite-embedding-97m-multilingual-r2` (384-dim, best sub-100M, ~3× faster backfill). **Quality opt-in:** `bge-m3` (MIT, 1024-dim). All behind the pluggable `Embedder`; the golden eval (§11) chooses empirically before ship. Offloaded to an executor (async hygiene).
2. run **mention detection** (§6.4).
3. store `mentions`, `has_text`, embedding vector.
- **Incremental & idempotent**, keyed on `doc_id + content_hash(cleaned text)`; deletions reconciled against source (tombstone rows removed when the source doc disappears).
- **On-demand voice transcripts:** hook the Transcription feature to **enqueue the parent doc for re-index** on transcript creation (the sync hook alone won't fire); backfill also detects sidecars newer than their indexed doc.
- **Backfill:** first run processes the corpus once (text-only ≈ tens of thousands of docs → minutes–low hours CPU), surfaced via `/api/ai/index/status`.
- **Model distribution:** ship the int8 ONNX as a **GitHub Release asset**, **SHA256-pinned**, verified on load; vendor the model's MIT LICENSE/NOTICE. **Download/verify failure → lexical-only fallback** (degraded for non-JP queries, §10).

### 6.6 Storage
Extend `search_index.db` with knowledge columns/tables (`mentions`, `has_text`, embeddings) **or** a sibling `knowledge.db` under `get_app_data_dir()` — reusing the existing `search_blogs`/`search_messages` rows rather than duplicating text. **Vector search = numpy brute-force cosine** over the (tens-of-thousands × 384/768-dim) matrix (sub-50 ms; numpy ships with onnxruntime) ⇒ **no sqlite-vec/hnswlib** by default (avoids loadable-extension/PyInstaller and index↔DB-consistency risk). ANN (hnswlib) only if measured latency later warrants; document the rebuild/consistency story if adopted. Registry + aliases load from JSON into memory.

## 7. Query engine

### 7.1 Tools (bounded loop: ≤6 tool steps + 1 synth + 1 repair)
- `resolve_member(text, scope)` → `[{canonical_id, canonical_name, confidence, aliases}]`. `scope` (see §8) constrains to the active service's group(s) so per-group nickname collisions don't fan out.
- `search(scope, author?, mentions?, query?, date_from?, date_to?, type?, has_text?, sort=recent|relevant, limit)` → hits `{doc_id, source_ref, author, timestamp, snippet, score}`. Structured filters → SQL constraints; ranking = hybrid (existing FTS5 ⊕ numpy-vector, **RRF k=60**, equal weight).
- `get_document(doc_id)` → **canonical cleaned text** (§6.2) for exact quoting.
- `aggregate(scope, filters, group_by)` → counts / date-buckets for "how many"/"past-month". **Promoted to v1** (it's the enumerate class of two headline questions).

### 7.2 Example → plan (with honest outcomes)
- **Last time A mentioned B** → resolve A,B → `search(author=A, mentions=B, sort=recent, limit=1)`. Answer caveated as **"the most recent reference I could detect"** (alias-form only, §6.4). Optional recall booster: LLM re-reads top-N recent A-docs for non-alias references.
- **Where did A & B go last** → co-mention is **one** signal combined with shared date-window + outing/location lexicon (query-expanded, EN/ZH→JP); `get_document` the candidates; **validator requires the location to appear in a cited snippet**; image-only outings are out of scope v1.
- **Food A ate past month** → `aggregate`/high-recall date-window scan over A's docs (multi-query expansion for food terms) → list dishes, each cited, with **"here's what I found (from text/captions)"** partial-ness; dish-only-in-photo out of scope v1.
- **Does A like X** → `search(author=A, query=X)` → `get_document` → sentiment from quotes → answer **or** "no evidence found."

### 7.3 Grounding contract (feasible, streaming-compatible)
- **Structured answer:** the model emits sentences that each carry explicit `citation_ids` (no post-hoc "detect a factual claim in prose" — that hard step is designed out).
- Each citation `{doc_id, source_ref, quoted_snippet, member, timestamp}`; **`quoted_snippet` MUST be an exact/near-exact substring of the cited document's canonical cleaned text** (§6.2), and **verbatim Japanese even when the prose answer is EN/ZH** (model instructed accordingly).
- **Validator** (runs before the answer is shown): (1) every `doc_id` was returned by a tool call **in this conversation** (with turn provenance — not just "this turn", so multi-turn reuse works, §7.5); (2) `quoted_snippet` matches its doc under the canonical normalization at **token-set ratio ≥ 0.9**; (3) any sentence lacking a valid citation is withheld. Empty retrieval → "no evidence found." Bounded **repair** ("cite only returned docs, quote verbatim JP"); withhold if still failing.
- **Streaming resolution (no contradiction):** **two-pass** — stream only tool-progress/"thinking" while the agent runs and validates **silently**; then stream the **already-validated** answer. UI shows a "verifying…"→"answer" transition; repair/withhold happens before any answer token is shown.

### 7.4 Cost (honest)
A bounded agent is **~3–6 LLM calls/question** (resolve → search → optional get_document → synth → maybe repair), later calls carrying retrieved context. Budget: hard cap on tool-steps; **prefer snippets over full documents**; cache resolved entities + tool results in the server-side session (§7.5). Validate the chosen provider's real **RPD/TPM** against expected load before claiming free-tier fit (≈500 questions/day × ~4 calls ⇒ ~2k calls/day + input tokens).

### 7.5 Conversation state (pinned)
Two distinct things: **message history** = client-side (§8); **agent working set** (resolved entities + tool results, for follow-ups) = **server-side session keyed by `conversation_id`, TTL'd**. The validator's provenance check (§7.3) accepts any doc surfaced earlier **in the same conversation**, so "and the month before?" reuse doesn't get false-rejected.

### 7.6 Known recall ceilings (documented, not hidden)
- **Mention detection is precision-first:** non-alias references are invisible; "last time A mentioned B" is a superlative, so a single miss = a confidently-wrong older citation → hence the **"reference I could detect"** caveat and the optional LLM-re-read booster.
- **Enumerate/aggregate** ("all the food this month") has no completeness guarantee without index-time extraction (deferred) → **partial-ness caveat**.
- **Vision gap:** facts only in images/video are unanswerable in v1 (§2, §16).
- **Cross-lingual lexical fallback** is degraded (§10).
These ceilings are surfaced to the user in-answer, and are the primary targets of the golden eval (§11) — the pysaka+CLI phasing (§14) exposes them before UI work.

## 8. API & provider abstraction
**New router `backend/api/ai.py` (`/api/ai`):**
- `POST /api/ai/ask` — `{question, scope, conversation_id?, tz}` → **two-pass stream** (tool-progress, then validated `{answer, citations[]}`).
- `GET /api/ai/index/status`, `POST /api/ai/index/rebuild`.
- `GET/POST /api/ai/history*` — client-side history (server keeps only the TTL'd working set, §7.5).

**`scope` type (pinned):** `{ service: string, group_ids: number[], member_id?: canonical_id }`. **Default** = the active service and its group(s); if a service maps to multiple groups, search all and disambiguate members by group. Lowered directly into `resolve_member`/`search` `scope`.

**`tz`:** the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone`, sent per request; the backend computes `date_from/date_to` from it (§13).

**Provider tool-calling (greenfield):** pysaka defines `LLMClient.chat(messages, tools) → tool_calls | text`; SakaDesk injects **Gemini/OpenAI** adapters (the two the AI tab exposes — **no Anthropic** in v1, per §2). Weak-tool-calling providers fall back to a JSON "plan" prompt. Reuses existing keyring/provider config; only *adds* a "Knowledge base" subsection (index status, rebuild, later: premium toggle).

## 9. Deep-linking (verified — reuse existing navigation)

### 9.1 Mechanism already exists and is battle-tested
- **Message jump:** `setSelectedConversation(...)` + `setTargetMessageId(id)` + `setActiveFeature/Service`. Messages load fully (`limit=0`); **Virtuoso already scrolls to `targetMessageId`** via `scrollToIndex`/`initialTopMostItemIndex` (`features/messages/…/MessageList.tsx`). Deep-in-history jump **works today**.
- **Blog jump:** `setTargetBlog({blogId, service, memberId})` + `setActiveFeature/Service`; opens in reader (`features/blogs/BlogsFeature.tsx:114`).
- **Cross-group jump** handled (adds service to `selectedServices`, switches active service).
- Canonical reusable code: `frontend/src/features/search/SearchModal.tsx:260-338` (`handleNavigate`).

**Must-build: ~nothing.** Small refactor: extract `handleNavigate` → shared `navigateToSource(ref)` so search + chat share one path.

### 9.2 `source_ref` schema (mirrors search-result shape)
```
blog:    { result_type:"blog",    service, blog_id, member_id }
message: { result_type:"message", service, group_id, group_name,
           member_id, member_name, message_id, is_group_chat }
```

## 10. Error handling & degradation
- No key/provider → prompt to configure AI tab. Rate-limit/quota/network → clear messages + backoff.
- Empty retrieval → **"no evidence found"** (first-class, not error). Hallucinated/unquotable citation → repair; else withhold.
- Index mid-backfill → "indexing X% — partial results." Embedding load/verify fails → **lexical-only fallback**.
- **Lexical-only + EN/ZH query is a dead end** (FTS5 is JP-only): mitigate with query-term translation/alias expansion or structured-filter-only answers, and **warn the user** the fallback is degraded for non-Japanese queries.
- New/unaliased member → auto-provisioned (§6.4), flagged in status. Ambiguous nickname → disambiguation prompt. Malformed data → cleaned/skipped, never fatal.
- No `assert` for security/control; structlog breadcrumbs; mask `%%%`/PII/credentials.

## 11. Testing (100% core coverage in pysaka)
- **Unit:** entity resolution (alias→member, ambiguity, `%%%`-exclusion, 2-keyspace reconciliation, synthetic-key stability, new-member auto-provision); Aho-Corasick mention detection incl. **short-kana false-positive** cases and self-mention; text cleaning (HTML via bs4, `%%%`, null→metadata-only); chunking.
- **Retrieval:** RRF (k=60) determinism; structured filters; `sort=recent`; metadata-only docs retrievable by date/type.
- **Agent:** **mocked `LLMClient`** → assert tool sequences per example; **structured-citation** answers; validator rejects fabricated `doc_id`s and non-substring/paraphrased quotes; **EN-answer/JP-snippet** case; multi-turn provenance reuse.
- **`time-machine`** (temporal + `tz`); **`syrupy`** (`{answer, citations[]}`); **`respx`** (provider adapters, incl. tool-calling); **i18n** CJK+emoji (non-ASCII aliases resolve; UTF-8).
- **Golden Q&A eval (the quality gate):** **synthetic fixtures checked in** that mimic real 3-shape ID/alias/`%%%`/kanji patterns (real paid/personal data is **never committed** — public repos); an optional **gitignored local run** over real data for the maintainer. Defines owner (Phase 2), size, expected-citation format, and a **numeric release gate** (citation precision/recall ≥ target). Includes **cross-lingual recall** and **alias-completeness sensitivity** cases.
- **SakaDesk:** `/api/ai/ask` two-pass stream; `navigateToSource` → correct store actions.

## 12. Security & privacy
Paid, personal data containing the subscriber's name (`%%%`). **Local-first indexing** keeps content on-device. LLM calls go to the **user's own** provider/key (same trust model as translation), with an **explicit UI notice** that questions + retrieved snippets are sent there. Keys in OS keyring only, never logged; `%%%`/PII/credentials masked; `get_document` reads only within the validated output dir (reuse `path_resolver`); secrets in `.env`.

## 13. i18n & time
All strings externalized (JA/EN/ZH per existing target languages). Dates **UTC internally**; "past month"/"last week" computed from the request's **`tz`** (§8). Answers in the UI/target language; **JP quoted verbatim**, optional one-click translate via the existing service.

## 14. Phased build (YAGNI)
| Phase | Repo | Deliverable |
|---|---|---|
| 0 Foundations | pysaka | `MemberRegistry` (synthetic id + 2-keyspace reconcile + new-member provision); `AliasTable` (auto-seed + curated) + `%%%`; `Document` (+metadata-only) + bs4 cleaning; **`Embedder`/`VectorStore`/`Indexer`/`Retriever`/`LLMClient` protocols**; unit tests |
| 1 Knowledge index | pysaka + SakaDesk | mention detection (Aho-Corasick + short-kana guard); SakaDesk `OnnxEmbedder` (e5-base, prefixes) + numpy `VectorStore`; extend `search_index.db`/sibling with `mentions`/`has_text`/vectors; **reuse existing FTS5 (do not rebuild blog lexical)**; sync hook + transcript re-index trigger + backfill + status; model ship/verify |
| 2 Retrieval + Agent | pysaka | `HybridRetriever` (RRF); tools incl. **`aggregate`**; agent loop (bounded); **structured-citation grounding validator** (two-pass); `LLMClient` + Gemini adapter; **golden evals + release gate** |
| 3 Integration | SakaDesk | `/api/ai/ask` two-pass stream; `knowledge_service` wiring (keyring/paths/sync); scope + `tz`; AI-tab "Knowledge base" subsection |
| 4 UI | frontend | `AiFeature` chat; citation chips; shared `navigateToSource`; wire `ai` into `SERVICE_FEATURES`; i18n |

**Deferred (pluggable):** vision/OCR + video frames (v1.1, §16), bulk voice transcription, index-time-extraction premium mode.
**CLI validation:** Phases 0–2 (pure engine) are exercisable through **`saka-cli`** on real data before any GUI — the real gate for the §7.6 recall ceilings.
**Implementation split:** Plan A = Phases 0–2; Plan B = Phases 3–4.

## 15. Concrete defaults (previously under-specified)
Embedding model `granite-embedding-311m-multilingual-r2` (Apache-2.0, int8 ONNX, 768-dim; downshift `granite-97m`, opt-in `bge-m3`) · vector = numpy flat cosine · RRF `k=60`, equal weight · blog chunk 400 tok / 15% overlap · message neighbor window ±1 · max tool-steps 6 (+1 synth +1 repair) · `content_hash` over cleaned text · fuzzy threshold token-set ratio ≥0.9 · canonical key = synthetic.

## 16. Open items
1. **RESOLVED — text-first v1.** Dish/location facts that live only in photos/video are **out of scope for v1**; the food/outing questions are answered from text/captions with a partial-ness caveat (§7.6). On-demand vision remains the pluggable **v1.1** path.
2. **RESOLVED — alias/reference data provided.** Consolidated under `data/knowledge/hinatazaka46/` (regenerated by `scripts/build_hinatazaka_kb.py`, see `data/knowledge/README.md`): `aliases.json` (flat alias→member), `call_names.json` (**directional** caller→callee→names from the official 五期生 table — richer than a flat list; raises mention-detection precision), and `units.json` (pair/combi/unit names→members). Glossary (`wikiwiki hinataword`) is deferred pending a rate-limit-safe, name-verified extraction (first pass hit 429s + mis-transcribed names). This extends the §6.4 model — see §6.4a.
3. **RESOLVED — embedding model.** Default `granite-embedding-311m-multilingual-r2` (Apache-2.0, ONNX/CPU, cross-lingual JP), shipped as a SHA256-pinned GitHub Release asset; `granite-97m` downshift and `bge-m3` opt-in behind the pluggable `Embedder`; golden eval confirms before ship.

## 17. Review disposition (what changed)
**Corrected facts:** blog FTS5 already exists & sync-wired (Phase-1 scope reduced); 2 keyspaces not 3; `search_index.db`; bs4 already present (no GPL `html2text`). **Design fixes:** embedder inverted out of pysaka behind a protocol + dependency-placement matrix; `scope` typed with a default; streaming resolved as two-pass vs. the validator; canonical key = synthetic (§6.4/§6.1 aligned); conversation working-set server-side with cross-turn provenance; validator uses structured per-sentence citations + pinned normalization/threshold; caption-less media = metadata-only docs; new-member auto-provision; on-demand-transcript re-index trigger; timezone via request `tz`; lexical-only EN/ZH degradation acknowledged; cost restated (~3–6 calls/q); embedding model selected after a landscape check — `granite-embedding-311m-multilingual-r2` (Apache-2.0, ONNX/CPU) default, `granite-97m`/`bge-m3` as swaps; `aggregate` promoted to v1; numpy flat vector (no sqlite-vec/hnswlib); golden eval = checked-in synthetic fixtures + numeric gate; Anthropic dropped; concrete defaults in §15. **Reframe:** product promise = grounded best-effort with explicit partial-ness (D7), with §7.6 documenting recall ceilings.

## 18. Appendix — verified references
`data/members/<group>.json` (+ `frontend/src/data/memberData.ts`) · `backend/services/search_service.py` (`search_messages`/`search_blogs` + `_fts`, workers; `search_index.db` at `get_app_data_dir()`) · `backend/services/blog_service.py:1336` + `sync_service.py:543` (index on sync) · `backend/services/translation_service.py` (Gemini/OpenAI; no tool-calling) · `backend/services/transcription_service.py` (JSON sidecars) · `frontend/src/features/search/SearchModal.tsx:260-338`, `store/appStore.ts`, `features/messages/…/MessageList.tsx` (Virtuoso) · `frontend/src/config/features.ts` (`ai`) · `backend/main.py` · `pysaka/pyproject.toml` (MIT, py3.9, beautifulsoup4).
