# Knowledge-base reference data

Curated, canonical-ID-keyed reference data that grounds the member Q&A chatbot
(see `docs/superpowers/specs/2026-07-01-knowledge-base-chatbot-design.md`). This is
**source-of-truth** data the engine loads — distinct from the synced blogs/messages,
which are the *facts* the bot answers from.

Everything here is regenerated deterministically:

```bash
uv run python scripts/build_hinatazaka_kb.py
```

**Canonical member id** = `"<service>:<blogId>"` (e.g. `hinatazaka46:45`), joining
directly to `data/members/<group>.json` (`blogId`). Members not on the current roster
(graduated 1st–4th gen) appear by name with `canonical_id: null`.

## Data types & formats

Each source is a *different* data type, so each gets the representation that fits it.

### 1. `hinatazaka46/aliases.json` — flat alias → member (resolution & mentions)
Distinctive nicknames per member, keyed by canonical id. The engine **unions** these
with auto-derived seed aliases (kanji / hiragana / romaji / given-name), so bare
name forms are covered even if absent here.
```json
{ "members": { "hinatazaka46:45": {
    "canonical": "鶴崎 仁香", "blog_id": "45",
    "aliases": ["にこぼーの","世界遺産先生","にこ姉","ぼーの","仁香ちゃん", "..."],
    "origin": "curated" } } }
```
**Agent use:** feeds `resolve_member` (nickname → member) and `MentionDetector`.
⚠️ Some entries are short/common words (`桜`, `なお`, `ゆう`, `大野`) with high
false-positive risk — the engine's short-alias/boundary guard (Plan A, Task 6) and,
preferably, the **directional** table below must gate these.

### 2. `hinatazaka46/call_names.json` — directional: who calls whom what
The richest signal from your image: a **caller → callee → names** graph
(row = caller, column = callee; diagonal omitted), from the official 五期生
call-name table (2025-05-26), plus cross-gen edges and free-text notes.
```json
{ "edges": [ { "caller_id":"hinatazaka46:43","caller_name":"下田 衣珠季",
               "callee_id":"hinatazaka46:38","callee_name":"大野 愛実","names":["大野"] } ],
  "notes": ["下田：大野からは五期生で唯一「下田」と呼ばれてる。…"] }
```
**Agent use:** (a) directly answers *"how does A call B?"*; (b) **raises
mention-detection precision** — when scanning member A's own blog/message, resolve a
nickname using A's *specific* call-names for the target rather than the global alias
union (kills the common-word collisions above); (c) a citable relationship fact.

### 3. `hinatazaka46/units.json` — pair / unit / combi names → members
Named pairings (combis, trios, units), each mapped to its members.
```json
{ "units": [ { "unit_name":"末っ子まりん","kind":"trio",
    "members":[{"name":"大野 愛実","canonical_id":"hinatazaka46:38"}, "..."],
    "notes":"5期生最年少ユニット" } ] }
```
**Agent use:** resolve *"the [unit] pair/combi"* → members, and answer *"what is
[unit name]?"* / *"which combis is A in?"*. A curated selection from the source (not
exhaustive); `meta.unmatched_names` lists members off the current roster.

### 4. Glossary (`wikiwiki.jp/hinataword`) — **NOT yet built** (deliberately)
The Hinatazaka terminology wiki is a genuinely useful 4th data type (fan/idol
vocabulary, catchphrases, song/segment references). It is **not** committed here
because the first automated pass (a) was **rate-limited (HTTP 429)** to ~10% of the
wiki (the あ section only), and (b) **mis-transcribed several member names**
(e.g. 正源司陽子 → "神宮司花野", 髙橋未来虹 → "高橋未々二", 山下葉留花 → "山下陽架").
Shipping fabricated names would poison a citations product.

**Planned format when extracted safely:** each term becomes a **reference `Document`**
(`type: "reference"`) with an external `source_ref` (the wiki URL), so glossary terms
flow through the *same* retrieval + citation pipeline as blogs/messages — the agent
can retrieve and cite a definition to its wiki page. Extraction must throttle to
respect 429s and **verify every `related_member` against the canonical registry**,
dropping/flagging unmatched names.

## Provenance
| File | Source | Date |
|---|---|---|
| `call_names.json` | Official 日向坂46 五期生 relay-blog 呼び名 table (user-provided image) | 2025-05-26 |
| `aliases.json` | Derived from `call_names.json` ∪ hinatafan.com/262 given-names | 2025-05-26 |
| `units.json` | sakamichidatabase.penguinelegy.com/hinatazaka46-pairunitname/ | 2026 |
| glossary | wikiwiki.jp/hinataword (pending safe extraction) | — |

## Adding another group
Add a `build_<group>_kb.py` (or generalize the generator) that reads
`data/members/<group>.json` and writes `data/knowledge/<service>/`. The engine loads
`data/knowledge/<service>/{aliases,call_names,units}.json` per group.
