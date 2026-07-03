"""gemini-3.5-flash was re-verified working via the OpenAI-compat tool-calling
round-trip (the thought_signature 400 that blocked gemini-3.x no longer
reproduces for it), so it must be selectable for the cloud KB backend. Other,
untested 3.x variants stay behind the broad ^gemini-3 block.
"""

from backend.services.llm_models import lookup_model


def test_gemini_3_5_flash_selectable_but_other_3x_still_blocked():
    # Exact rule overrides the ^gemini-3 pattern -> 3.5-flash is usable.
    assert lookup_model("cloud", "gemini-3.5-flash").tier == "recommended"
    # The pattern still guards every other (unverified) gemini-3.x id.
    assert lookup_model("cloud", "gemini-3-flash-preview").tier == "blocked"
