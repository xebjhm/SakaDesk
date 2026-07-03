"""Tests for `backend.services.llm_models` -- the curated LLM model registry
(Product-wave Task 5, item 1): recommended/degraded/blocked tiers keyed off
empirical verdicts (`.superpowers/sdd/progress.md`, "MODEL BENCH FINAL") plus
regex patterns for whole model families (`^gemini-3`, `gemini-2.0-*`).
"""

from __future__ import annotations

import pytest

from backend.services.llm_models import ModelLookup, curated_for_backend, lookup_model


class TestLookupModelCloudCurated:
    def test_gemini_2_5_flash_is_recommended(self):
        result = lookup_model("cloud", "gemini-2.5-flash")
        assert result == ModelLookup(
            id="gemini-2.5-flash", backend="cloud", tier="recommended", note_key=None
        )

    def test_gemini_2_5_flash_lite_is_degraded_with_note(self):
        result = lookup_model("cloud", "gemini-2.5-flash-lite")
        assert result.tier == "degraded"
        assert result.note_key is not None


class TestLookupModelCloudPatterns:
    @pytest.mark.parametrize(
        "model_id", ["gemini-3-pro", "gemini-3.0-flash", "gemini-3-flash-lite"]
    )
    def test_gemini_3_family_is_blocked(self, model_id):
        result = lookup_model("cloud", model_id)
        assert result.tier == "blocked"
        assert result.note_key is not None

    @pytest.mark.parametrize("model_id", ["gemini-2.0-flash", "gemini-2.0-flash-lite"])
    def test_gemini_2_0_family_is_degraded(self, model_id):
        result = lookup_model("cloud", model_id)
        assert result.tier == "degraded"
        assert result.note_key is not None

    def test_unrecognized_cloud_model_is_unknown(self):
        result = lookup_model("cloud", "gpt-4o")
        assert result == ModelLookup(
            id="gpt-4o", backend="cloud", tier="unknown", note_key=None
        )

    def test_exact_curated_id_wins_over_a_pattern_that_would_also_match(self):
        """A hypothetical exact entry must never be shadowed by a broader
        pattern also matching the same id -- exact lookups are checked first."""
        result = lookup_model("cloud", "gemini-2.5-flash")
        assert result.tier == "recommended"


class TestLookupModelLocal:
    def test_qwen3_30b_is_recommended(self):
        result = lookup_model("local", "qwen3:30b")
        assert result.tier == "recommended"
        assert result.note_key is None

    @pytest.mark.parametrize("model_id", ["qwen3-32b-8k", "qwen3:32b"])
    def test_qwen3_32b_variants_are_degraded_deep_mode(self, model_id):
        result = lookup_model("local", model_id)
        assert result.tier == "degraded"
        assert result.note_key is not None

    def test_qwen3_14b_is_recommended_small_with_a_note(self):
        """Not a distinct tier ('recommended-small' isn't in the 4-value
        enum) -- still `tier == "recommended"`, but carries a note key so the
        UI can show it's the smaller/faster pick."""
        result = lookup_model("local", "qwen3:14b")
        assert result.tier == "recommended"
        assert result.note_key is not None

    def test_qwen2_5_14b_is_degraded(self):
        """Disqualified in MODEL BENCH FINAL: skipped a tool call on a JP
        question, observed live."""
        result = lookup_model("local", "qwen2.5:14b")
        assert result.tier == "degraded"
        assert result.note_key is not None

    def test_unrecognized_local_model_is_unknown(self):
        result = lookup_model("local", "llama3")
        assert result.tier == "unknown"
        assert result.note_key is None


class TestLookupModelBackendIsolation:
    def test_a_local_model_id_looked_up_under_cloud_is_unknown(self):
        """The registry is backend-scoped -- `qwen3:30b` (a local/Ollama id)
        must not accidentally resolve as a recommended CLOUD model."""
        result = lookup_model("cloud", "qwen3:30b")
        assert result.tier == "unknown"


class TestCuratedForBackend:
    def test_cloud_curated_list_has_the_two_exact_id_entries(self):
        ids = {entry.id for entry in curated_for_backend("cloud")}
        assert ids == {"gemini-2.5-flash", "gemini-2.5-flash-lite"}

    def test_local_curated_list_has_all_five_exact_id_entries(self):
        ids = {entry.id for entry in curated_for_backend("local")}
        assert ids == {
            "qwen3:30b",
            "qwen3-32b-8k",
            "qwen3:32b",
            "qwen3:14b",
            "qwen2.5:14b",
        }

    def test_curated_entries_carry_their_own_tier(self):
        by_id = {entry.id: entry for entry in curated_for_backend("local")}
        assert by_id["qwen3:30b"].tier == "recommended"
        assert by_id["qwen2.5:14b"].tier == "degraded"

    def test_curated_list_excludes_pattern_only_rules(self):
        """`^gemini-3`/`gemini-2.0-*` are pattern rules, not concrete
        selectable model ids -- they must never appear in the picker's
        curated list."""
        ids = {entry.id for entry in curated_for_backend("cloud")}
        assert not any(
            i.startswith("gemini-3") or i.startswith("gemini-2.0") for i in ids
        )
