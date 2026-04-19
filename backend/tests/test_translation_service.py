import pytest

from backend.services.translation_service import (
    TranslationProvider,
    GeminiProvider,
    OpenAIProvider,
    build_translation_prompt,
    build_batch_translation_prompt,
    validate_placeholder_count,
)


class TestTranslationProviderInterface:
    """Verify the ABC contract."""

    def test_cannot_instantiate_abc(self):
        with pytest.raises(TypeError):
            TranslationProvider()  # type: ignore[abstract]

    def test_gemini_provider_is_subclass(self):
        assert issubclass(GeminiProvider, TranslationProvider)

    def test_openai_provider_is_subclass(self):
        assert issubclass(OpenAIProvider, TranslationProvider)


class TestPromptConstruction:
    """Test translation prompt building."""

    def test_single_message_prompt_includes_target_language(self):
        prompt, system = build_translation_prompt(
            text="こんにちは",
            target_language="en",
        )
        assert "English" in prompt or "en" in prompt
        assert "こんにちは" in prompt
        assert "idol" in system.lower()

    def test_single_message_prompt_with_context(self):
        prompt, _system = build_translation_prompt(
            text="ありがとう",
            target_language="en",
            context_texts=["こんにちは", "元気ですか"],
        )
        assert "ありがとう" in prompt
        assert "こんにちは" in prompt

    def test_system_instruction_includes_domain_rules(self):
        _prompt, system = build_translation_prompt(
            text="こんにちは",
            target_language="en",
            member_name="金村 美玖",
            group_name="日向坂46",
        )
        assert "金村 美玖" in system
        assert "日向坂46" in system
        assert "おひさま" in system
        assert "Buddies" in system
        assert "honorific" in system.lower()

    def test_system_instruction_has_nickname_rule(self):
        """System instruction should mention {{NICKNAME}} handling."""
        _prompt, system = build_translation_prompt(
            text="こんにちは",
            target_language="en",
        )
        assert "{{NICKNAME}}" in system

    def test_batch_prompt_includes_all_messages(self):
        prompt, system = build_batch_translation_prompt(
            texts={"1": "おはよう", "2": "こんにちは", "3": "こんばんは"},
            target_language="en",
        )
        assert "おはよう" in prompt
        assert "こんにちは" in prompt
        assert "こんばんは" in prompt
        assert "idol" in system.lower()


class TestPlaceholderValidation:
    """Test %%% placeholder count validation."""

    def test_matching_count_returns_true(self):
        assert (
            validate_placeholder_count("%%%さん、こんにちは%%%", "%%%, hello %%%")
            is True
        )

    def test_mismatching_count_returns_false(self):
        assert (
            validate_placeholder_count("%%%さん、こんにちは%%%", "hello there") is False
        )

    def test_no_placeholders_returns_true(self):
        assert validate_placeholder_count("こんにちは", "hello") is True

    def test_fullwidth_placeholders_counted(self):
        assert validate_placeholder_count("％％％さん", "%%% dear") is True
