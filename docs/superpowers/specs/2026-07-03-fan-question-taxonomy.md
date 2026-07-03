# Fan-Question Taxonomy — what real users will actually ask

> Written from the fan's seat, grounded in the real synced corpus (日向坂46 blogs + messages
> observed during live testing). Each category lists representative questions, the retrieval
> shape they exercise, **current support status**, and the optimization each one drives.
> This file seeds: golden-eval expansion, adaptive-routing classes, new agent tools,
> suggested-question chips, and premium-mode (vision/extraction) prioritization.

## Legend
- ✅ works today · 🟡 works but weak/slow · ❌ broken or impossible today
- Shape: `latest` (temporal point lookup) · `rel` (relationship) · `pref` (preference/habit)
  · `agg` (aggregation/stats) · `event` (activity recall) · `media` (needs vision/transcript)
  · `multi` (cross-member synthesis) · `meta` (nickname/terminology)

## 1. Temporal point lookups — the bread-and-butter `latest`
| Question | Status | Notes |
|---|---|---|
| 大野愛実が最後に坂井新奈について話したのはいつ? | ✅ | `search(author, mentions, sort=recent)` — flagship, verified live |
| 昨日○○は何か投稿してた? | ✅ (post P-2) | needs the tz/now anchor — was broken before pwave-2 |
| ○○が最後にブログを書いたのはいつ? | 🟡 | blogs unindexed until backup/rebuild (P-3 fixes initial build) |
**Drives:** adaptive routing — these need NO multi-step agent loop; a single structured
search + one synthesis turn answers them in ~1/3 the latency. Biggest cheap latency win.

## 2. Relationships & interactions — `rel` (the emotional core of fandom)
| Question | Status | Notes |
|---|---|---|
| まなみんとにぃなって仲いいの?どんな絡みがある? | 🟡 | mentions-filter search works; "how close overall" needs aggregation over the mention-edge table, not top-k hits |
| 大田美月がよく話題にするメンバーは誰? | 🟡 | possible via repeated aggregate calls; should be ONE tool call |
| ○○は△△のことを何て呼んでる? | ✅ data, 🟡 access | call_names.json HAS this curated; agent can't query it — needs a `call_name(a,b)` tool or roster-in-prompt |
| 二人の最近のやり取りを時系列で見たい | ❌ | no interaction-timeline tool; hits come unpaired |
**Drives:** the graph-lite verdict (architecture research angle D) — we already own a temporal
mention-edge table; elevate it with 2-3 tools: `interaction_stats(a,b)`, `interaction_timeline(a,b, range)`,
`call_name(a,b)`. No external GraphRAG needed for these shapes.

## 3. Preferences & habits — `pref` ("does she like X?")
| Question | Status | Notes |
|---|---|---|
| 大田美月はラーメン好き? | 🟡 | lexical hits on ラーメン + synthesis works when mentions are explicit; misses paraphrase (麺類/二郎系) without semantic recall + reranker |
| ○○がハマってる食べ物は最近何? | 🟡 | aggregate(query) counts keywords; "what's trending for her" needs top-terms or more-hits-into-context |
| ○○の好きな色/ブランド/口癖は? | 🟡 | pure retrieval+synthesis; quality = recall × model — reranker helps most here |
**Drives:** reranker stage (angle A), morphological/semantic recall (angle B), and the
optional index-time extraction premium mode (per original design §pluggable) for
preference profiles.

## 4. Aggregation & stats — `agg`
| Question | Status | Notes |
|---|---|---|
| 先月○○は何回メッセージくれた? | ✅ (post P-2) | aggregate + tz-correct calendar bucketing verified |
| 今月一番投稿が多かった五期生は? | 🟡 | needs per-author group_by compare — check aggregate's group_by author path |
| ○○が「ログインボーナス」って言った回数 | ✅ | aggregate(query) |
**Drives:** aggregate tool completeness (group_by author), and routing (agg questions are
single-tool + tiny synthesis — fast path).

## 5. Events & activities — `event` (the "date" question)
| Question | Status | Notes |
|---|---|---|
| AとBが最後に一緒に出かけたのはいつ?どこ? | 🟡 | needs co-mention + outing-vocabulary retrieval + synthesis; recall-bound; the original example question — make it a golden case |
| 新参者ライブについて○○は何て言ってた? | ✅ | verified live (ローソン/新参者 content retrieved well) |
| リレーブログ、今誰まで回った? | 🟡 | multi-doc recency reasoning; depends on blog indexing (P-3) |
**Drives:** reranker + hybrid recall; golden-eval expansion with event cases.

## 6. Media-dependent — `media` (honest ❌ today)
| Question | Status | Notes |
|---|---|---|
| ○○が昨日あげた写真、何の写真? | ❌ | picture_msg has no caption text — needs local vision captioning (premium mode; angle F evaluating Qwen3-VL local) |
| あの猫の画像いつだった? | ❌ | same — image retrieval needs captions or CLIP-style index |
| ボイスメッセージで何て言ってた? | ❌ | transcripts exist on disk but ingest ignores them (known v1.1 gap — cheap to fix relative to value) |
**Drives:** transcript ingestion first (data already on disk!), vision captioning as the
premium follow-up. These are the largest honest capability gaps vs fan expectations.

## 7. Cross-member synthesis — `multi`
| Question | Status | Notes |
|---|---|---|
| 五期生で一番早起きっぽいのは誰? | 🟡 | needs per-member sampling + synthesis; agent can do it but slow + budget-capped; quality model-bound |
| 最近の五期生の流行りネタは? | 🟡 | corpus-wide trend question; better served by aggregate top-terms than the agent loop |
**Drives:** realistic budget/expectation setting; maybe a `trending_terms(scope, range)` tool later.

## 8. Nicknames & meta — `meta`
| Question | Status | Notes |
|---|---|---|
| 「ぴんくせんせい」って誰のこと? | ✅ | resolve_member + curated aliases — verified live |
| 「にぃな」の由来は? | ❌ data | needs the wikiwiki glossary (deferred: throttled re-extraction task) |
| ○○のプロフィール/生年月日は? | 🟡 | roster has some fields; not exposed as a tool — cheap `member_profile` tool |

## Optimization priorities this taxonomy implies (ranked by fan-value ÷ cost)
1. **Adaptive routing** (`latest`/`agg`/`meta` → single-shot fast path): biggest latency win, no quality risk. → feeds orchestration angle E + a P-wave follow-up.
2. **Relationship tools over our existing edge table** (`interaction_stats/timeline`, `call_name`): unlocks category 2 with data we already curate. → graph-lite verdict.
3. **Transcript ingestion**: category 6's cheapest fix — data is already on disk.
4. **Reranker stage**: lifts categories 3/5 (the synthesis-quality-bound shapes). → angle A verdict.
5. **Golden-eval expansion**: encode ~2 cases per category above (incl. the original four example questions verbatim) so every future optimization is measured against fan reality.
6. **Suggested-question chips**: seed the empty chat state with per-category examples (roadmap #15) — teaches users what the feature can do TODAY (and hides what it can't yet).
7. **Vision captioning premium mode**: category 6's full fix; gate on angle F's local-cost verdict.
