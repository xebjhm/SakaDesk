# Windows Cowork Session — Handoff Brief

> For the next Claude Code session running NATIVELY on Windows with the full synced corpus and
> computer-use enabled. Written 2026-07-03 at the close of the product wave (P1–P6). A fresh
> session should read this + `.superpowers/sdd/progress.md` is NOT committed (gitignored) — the
> durable record is: this file, the PRs, the specs under `docs/superpowers/`, and the commits.

## State at handoff
- **Branches (all pushed, all green):** pysaka `feat/knowledge-engine` (PR #2, tip `28a22fc`, 228 tests);
  saka-cli `feat/kb-harness` (PR #1); SakaDesk `feat/kb-integration` (PR #12, tip `bfa7d93`,
  backend 1246 / frontend 400). Merge order: pysaka → saka-cli → SakaDesk. None merged yet.
- **The product wave (P1–P6) is complete** — typed errors, tz/now correctness, KB lifecycle with
  visible fair indexing, first-run provisioning (in-app model download + GPU providers +
  migrations + fingerprint), model registry/quota/consent/Ollama-autodetect, durable chat +
  cooperative cancel + multi-turn. Summary: PR #12's wave comment.
- **Model verdicts (measured on an RTX 3090, WSL):** local default `qwen3:30b` (MoE, ~17–20s/question,
  100% GPU @32k ctx); `qwen3-32b-8k` = deep-mode (62s); `qwen3:14b` ≈30s; `qwen2.5:14b` DEGRADED
  (skipped a tool call on a JP question); cloud: `gemini-2.5-flash` recommended, `flash-lite`
  degraded, `gemini-3.x` BLOCKED via OpenAI-compat (thought_signature).
- **Architecture research verdict** (six-angle, skeptic-challenged): current design is at/ahead of
  2026 practice — keep numpy exact vectors, keep chunking, no GraphRAG/vector-DB. The valuable
  changes: FTS5-persisted lexical, relationship tools over kb_mentions, adaptive routing,
  CPU JP reranker gated on recall@50 instrumentation. Full detail: the session report artifact +
  `docs/superpowers/specs/2026-07-03-fan-question-taxonomy.md` (query shapes driving priorities).

## What the Windows session should do (in rough order)
1. **Env sanity:** repos cloned side-by-side (`pysaka`, `saka-cli`, `SakaDesk`); `uv sync` each;
   frontend `npm ci`; native Ollama installed + `ollama pull qwen3:30b`; synced data present
   (`output/` via in-app sync or copied); embedding model via the NEW in-app download flow
   (Settings → AI → Knowledge base → SetupChecklist) — do NOT hand-place files anymore.
2. **Full-corpus validation:** enable KB, let the initial build index ALL services (watch the
   progress UI), then run the fan-question taxonomy shapes end-to-end **with computer use**
   (click citation chips → verify deep-link jump+scroll; test Stop; multi-turn follow-ups;
   quota meter on cloud; consent modal; model picker badges).
3. **Native benchmarks:** re-run the model ladder natively (WSL numbers above are the baseline;
   native should beat them); GPU embedder via `onnxruntime-directml` or CUDA package
   (readiness currently reports `gpuRuntimeMissing: true` on CPU builds — install the GPU
   runtime and confirm provider auto-select + the fingerprint does NOT trigger reindex).
4. **Architecture Phase-1 wave** (from the research migration plan): recall@50 instrumentation
   FIRST (it adjudicates the reranker + embedder bets), relationship tools
   (`interaction_timeline`, `call_name_lookup`, co-mention stats over kb_mentions),
   FTS5 trigram lexical persistence, adaptive routing fast path, prompt/KV hygiene audit.
5. **Spikes** (need target hardware): CPU reranker A/B (`hotchpotch/japanese-reranker-xsmall-v2`),
   kotoba-whisper transcript ingestion (50 real voice messages), Qwen3-VL captioning
   500-image batch integrity, llama-server Vulkan-vs-CUDA on the 3090, parallel tool calls.
6. **v1.2 packaging:** llama-server sidecar bundling per the deep-research verdict (three-tier
   cascade: existing Ollama → bundled Vulkan sidecar → cloud); SmartScreen/signing tests.

## Known open items (triaged v1.1, not blockers)
Voice transcripts not yet ingested; consent revocation UI; per-service fingerprint (currently
global); mention re-extraction needs a re-ingest flag when detector rules change; model-picker
`:latest` tag normalization; thread persistence across app restart; `_index_progress` history.

## Gotchas that cost time this session
- Commit/push via `uv run git commit` / `uv run git push` (pre-commit hooks not on PATH bare).
- `SakaDesk-kb-plan-b` here was a WORKTREE of SakaDesk on branch `feat/kb-integration`; on
  Windows just clone SakaDesk and checkout the branch. `frontend/vite.config.ts` proxy target
  was locally patched to `:8001` during dual-app testing — upstream default is `:8000`.
- Ollama qwen3 models: default 32k ctx can spill a 32B dense model to CPU (21%→68s/turn);
  the MoE fits fully. `keep_alive=-1` pins the model (the app does not set this yet — candidate item).
- Gemini free tier: 20 req/day on 2.5-flash; the agent burns 3–6/question. The usage meter
  + pre-empt now handle this, but budget test questions accordingly.
