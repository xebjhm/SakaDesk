"""Curated LLM model registry for the KB chatbot's model picker (Product-wave
Task 5, item 1): each entry is tiered `recommended` | `degraded` | `blocked` |
`unknown`, backing three call sites --

- `GET /api/ai/models`: the picker's curated select list (merged with live
  Ollama-probed models for the local backend, see `backend/services/ollama.py`
  and `backend/api/ai.py`'s `list_models`).
- `PUT /api/ai/config`: rejects a `blocked` model with 400 `model_blocked`;
  accepts `degraded`/`unknown` but echoes the tier/note back so the UI can
  show a warning.
- `POST /api/ai/config/test`: unrelated to tiering (it does a live probe), but
  shares this module's `curated_for_backend` for the picker on the same form.

**Every tier below is an EMPIRICAL verdict**, not a guess -- measured on this
machine's RTX 3090 (local) and against the live Gemini API (cloud); see
`.superpowers/sdd/progress.md`'s "MODEL BENCH FINAL" entry and each rule's
`evidence` string, which is intentionally kept as an inline citation rather
than paraphrased away.

Two kinds of rule:
- Exact-id (`id=...`): a specific model string, e.g. `"gemini-2.5-flash"`.
  These are the only entries `curated_for_backend` lists -- the concrete,
  selectable options a picker can render.
- Pattern (`pattern=...`): a regex over a whole model FAMILY, e.g.
  `^gemini-3` (every gemini-3.x variant) or `^gemini-2\\.0-` (every
  gemini-2.0 variant). Never surfaced in `curated_for_backend` (there's no
  single concrete id to list) but still enforced by `lookup_model` -- so a
  user typing a blocked id via the "Custom…" escape hatch is still caught.

`lookup_model` checks exact ids FIRST, then patterns, so a hypothetical exact
entry always wins over a broader pattern that would also match its id.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

ModelBackendName = Literal["cloud", "local"]
ModelTier = Literal["recommended", "degraded", "blocked", "unknown"]


@dataclass(frozen=True)
class ModelLookup:
    """The registry's verdict for one `(backend, id)` pair.

    `note_key` is an i18n key (`settings.kbModelNote.<note_key>`, see the
    frontend locale files) -- `None` when there's nothing worth telling the
    user (the common `recommended`/`unknown` case). Present alongside ANY
    tier, not just `degraded`/`blocked`: e.g. `qwen3:14b` is `recommended`
    but still carries a note (it's the smaller/faster pick, not the default
    recommendation) -- the frontend decides styling from `tier`, this field
    is just the message.
    """

    id: str
    backend: ModelBackendName
    tier: ModelTier
    note_key: str | None = None


@dataclass(frozen=True)
class _ExactRule:
    id: str
    backend: ModelBackendName
    tier: ModelTier
    note_key: str | None
    evidence: str


@dataclass(frozen=True)
class _PatternRule:
    pattern: re.Pattern[str]
    backend: ModelBackendName
    tier: ModelTier
    note_key: str | None
    evidence: str


# ---------------------------------------------------------------------------
# CLOUD -- Gemini, via the OpenAI-compatible endpoint.
# ---------------------------------------------------------------------------

_CLOUD_EXACT: tuple[_ExactRule, ...] = (
    _ExactRule(
        id="gemini-2.5-flash",
        backend="cloud",
        tier="recommended",
        note_key=None,
        evidence="Live testing: reliable forced tool-calling, grounded answers.",
    ),
    _ExactRule(
        # Exact rule overrides the broad `^gemini-3` block below: re-verified
        # 2026-07-04 that the OpenAI-compat 2-turn tool-calling round-trip now
        # returns HTTP 200 for this model (the gemini-3.x `thought_signature`
        # 400 no longer reproduces for gemini-3.5-flash). Same ~20 req/day free
        # tier as gemini-2.5-flash.
        id="gemini-3.5-flash",
        backend="cloud",
        tier="recommended",
        note_key=None,
        evidence=(
            "Re-verified 2026-07-04: OpenAI-compat forced tool-calling "
            "round-trip returns HTTP 200; the gemini-3.x thought_signature 400 "
            "no longer reproduces for this model."
        ),
    ),
    _ExactRule(
        id="gemini-2.5-flash-lite",
        backend="cloud",
        tier="degraded",
        note_key="flashLiteWeakToolCalling",
        evidence=(
            "Live testing: weak tool-calling -- may return a no-evidence "
            "answer on a perfectly answerable question."
        ),
    ),
)

_CLOUD_PATTERNS: tuple[_PatternRule, ...] = (
    _PatternRule(
        pattern=re.compile(r"^gemini-3"),
        backend="cloud",
        tier="blocked",
        note_key="gemini3ThoughtSignatureIncompatible",
        evidence=(
            "Live testing: HTTP 400 -- gemini-3.x's `thought_signature` "
            "requirement is incompatible with this client's OpenAI-compat "
            "tool-calling round-trip."
        ),
    ),
    _PatternRule(
        pattern=re.compile(r"^gemini-2\.0-"),
        backend="cloud",
        tier="degraded",
        note_key="gemini20ZeroFreeQuota",
        evidence="Live testing: zero free quota observed for the gemini-2.0 family.",
    ),
)

# ---------------------------------------------------------------------------
# LOCAL -- Ollama (or any OpenAI-compatible local server).
# ---------------------------------------------------------------------------

_LOCAL_EXACT: tuple[_ExactRule, ...] = (
    _ExactRule(
        id="qwen3:30b",
        backend="local",
        tier="recommended",
        note_key=None,
        evidence="MODEL BENCH FINAL (RTX 3090): MoE, ~17-20s/question, pinned keep_alive=-1.",
    ),
    _ExactRule(
        id="qwen3-32b-8k",
        backend="local",
        tier="degraded",
        note_key="deepModeSlower",
        evidence="MODEL BENCH FINAL (RTX 3090): 62s/question -- deep mode, opt-in only.",
    ),
    _ExactRule(
        id="qwen3:32b",
        backend="local",
        tier="degraded",
        note_key="deepModeSlower",
        evidence="MODEL BENCH FINAL (RTX 3090): 62s/question -- deep mode, opt-in only.",
    ),
    _ExactRule(
        id="qwen3:14b",
        backend="local",
        tier="recommended",
        note_key="recommendedSmallerFaster",
        evidence="MODEL BENCH FINAL (RTX 3090): ~30s/question -- good fit for less VRAM.",
    ),
    _ExactRule(
        id="qwen2.5:14b",
        backend="local",
        tier="degraded",
        note_key="skippedToolCallOnJapanese",
        evidence="MODEL BENCH FINAL: skipped a tool call on a JP question, observed live.",
    ),
)

_LOCAL_PATTERNS: tuple[_PatternRule, ...] = ()

_EXACT_RULES: tuple[_ExactRule, ...] = _CLOUD_EXACT + _LOCAL_EXACT
_PATTERN_RULES: tuple[_PatternRule, ...] = _CLOUD_PATTERNS + _LOCAL_PATTERNS


def lookup_model(backend: ModelBackendName, model_id: str) -> ModelLookup:
    """The registry's verdict for `model_id` on `backend`.

    Exact-id rules are checked before patterns (see module docstring). A
    model matching nothing is `tier="unknown"` -- allowed (not rejected by
    `PUT /api/ai/config`), just unvetted; the UI shows a mild warning rather
    than blocking it outright, since a user's self-hosted/renamed model is a
    completely normal case for the "Custom…" escape hatch.
    """
    for exact_rule in _EXACT_RULES:
        if exact_rule.backend == backend and exact_rule.id == model_id:
            return ModelLookup(
                id=model_id,
                backend=backend,
                tier=exact_rule.tier,
                note_key=exact_rule.note_key,
            )
    for pattern_rule in _PATTERN_RULES:
        if pattern_rule.backend == backend and pattern_rule.pattern.match(model_id):
            return ModelLookup(
                id=model_id,
                backend=backend,
                tier=pattern_rule.tier,
                note_key=pattern_rule.note_key,
            )
    return ModelLookup(id=model_id, backend=backend, tier="unknown", note_key=None)


def curated_for_backend(backend: ModelBackendName) -> list[ModelLookup]:
    """The concrete, selectable curated models for `backend`, in registry
    order -- what `GET /api/ai/models` renders as the picker's select
    options. Pattern-only rules (whole model families) are never listed here
    since there's no single id to show; `lookup_model` still enforces them
    against whatever the user actually picks/types.
    """
    return [
        ModelLookup(
            id=rule.id, backend=rule.backend, tier=rule.tier, note_key=rule.note_key
        )
        for rule in _EXACT_RULES
        if rule.backend == backend
    ]
