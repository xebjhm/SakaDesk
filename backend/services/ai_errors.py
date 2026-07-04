"""Typed AI-provider errors carrying a stable ``code`` for the UI.

Translation and transcription providers raise these instead of bare
``RuntimeError`` so the API layer can map them to a localized, actionable
message (the frontend keys off ``code``, not the English text).
"""


class ProviderError(RuntimeError):
    """Base for semantic (non-transport) provider failures. ``code`` is stable."""

    code = "unknown"


class SafetyBlockedError(ProviderError):
    """The provider's safety filter blocked the content — not retryable."""

    code = "safety_blocked"


class IncompleteOutputError(ProviderError):
    """Output was truncated / cut off (e.g. MAX_TOKENS, RECITATION)."""

    code = "incomplete"


class EmptyOutputError(ProviderError):
    """The provider returned no usable candidates/content, or malformed data."""

    code = "bad_response"
