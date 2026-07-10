# KB Answer Quality — Architecture Re-Review Verdict

> 2026-07-10, four-lens expert review (retrieval, agent orchestration,
> synthesis/presentation, industry bar) + synthesis, triggered by round-2
> battle-field testing: zh-TW questions over the Japanese corpus mostly
> returned "no evidence", the one working Japanese answer was a chronological
> quote-dump, and the owner set the bar at ChatGPT/Gemini-grade answers.

## Structural defects (not tuning problems)

**W1 — the validator's CJK containment gate fights the synthesis goal.**
`validator.py` gate 2 applies trigram containment ≥0.15 to ANY CJK sentence
on the assumption "CJK = verbatim Japanese quote". A correct Traditional-
Chinese synthesized sentence measures containment ~0.000 and is silently
deleted; when all sentences die the answer flips to no_evidence — after
retrieval already succeeded. The same gate causes the quote-dump via survivor
bias (only quote-heavy sentences pass) — amplified by the system prompt
literally commanding verbatim quoting. English answers skip the gate, so the
system was strictest in the owner's primary language.
Fix now: gate 2 keys on KANA presence, not CJK. Fix next: cite-per-claim —
agent emits an optional per-citation `quote` field; the validator verbatim-
checks the quote, leaves prose unchecked; gate 1 (citation must resolve)
remains the anti-hallucination guarantee throughout.

**W2 — the system prompt is silent on language and commands the wrong style.**
Never says the corpus is Japanese, never tells the model to search in
Japanese, never says answer in the question's language, orders verbatim
quoting. Rewrite: JP-query policy with variant retry, answer-in-question-
language, lead-with-the-answer 2-5 sentence narrative, quotes as flavor not
structure.

**W3 — trigram-only CJK lexical tokenization is cross-lingually blind below
3 shared characters.** A zh query and ja passage sharing a 2-char kanji word
(馬肉, 眼鏡, 美月) share ZERO trigrams. Fix: bigram+trigram emission for
han/kana runs (in-memory index — no reindex, ~1 day). W2 remains the primary
fix; W3 is the structural backstop.

**W4 — four failure modes collapse into one user outcome.** Validator-killed
answers, real retrieval misses, max-steps exhaustion, and untyped transport
errors all render as "no evidence" or a generic error. Fix: typed transport
catch-all + retry, forced final synthesis turn on budget exhaustion, per-ask
trace (hits per arm, sentences dropped per gate) logged server-side.

## Scorecard on the 2026-07-03 plan

Right: numpy exact vectors, no GraphRAG, chunking, relationship-tools
priority, instrumentation-gated reranker. Wrong: FTS5 persistence was ranked
#1 but is only a startup-latency play (demoted); the plan optimized the
retrieval core while the dominant failures live in the prompt and validator
wrapping it; adaptive routing demoted (efficiency, fixes nothing observed);
no observability story.

## Roadmap

PHASE-NOW (≈1 week, in progress 2026-07-10): N1 validator kana-gate ✱,
N2 prompt rewrite ✱, N3 error taxonomization + retry, N4 budget final-turn ✱,
N5 SSE phase narration, N6 retry buttons, N7 numbered-sources citations,
N8 ask-trace observability. (✱ = shipped in the wave/engine branch same day,
along with the {{NICKNAME}} privacy-preserving substitution.)

PHASE-NEXT (weeks): X1 cite-per-claim validator redesign; X2 relationship
tools over kb_mentions (interaction_timeline / interaction_stats /
call_name); X3 CJK bigram lexical; X4 dual-language query-variant fusion
(RRF is already variadic); X5 match-centered snippets; X6 fusion tuning +
pool 50→150; X7 thread persistence via app_state.db; X8 follow-up suggestion
chips; X9 adaptive routing (demoted).

PHASE-LATER (gated): reranker (only if N8 traces still show recall failures
post-N2/X3/X4); stronger cross-lingual embedder (BGE-M3-class, forces full
re-embed — measure first); FTS5 persistence (only if startup cost felt);
entailment-grade grounding; transcripts/captions ingestion.

## Go/no-go calls

- **Token streaming: NO-GO.** The answer is a validator-gated JSON blob and
  80%+ of latency is the tool loop, not generation. Phase narration (N5)
  delivers the working-agent feel at a tenth of the cost. Revisit post-N5.
- **Query translation: GO prompt-side; NO translation infrastructure.**
- **Validator redesign: GO unconditionally** (kana patch now, cite-per-claim
  next). Grounding guarantee (gate 1) preserved throughout.
- **Numbered-sources citations: GO** (frontend can ship from the existing
  payload; backend follows with first-use ordering + per-citation quotes).
