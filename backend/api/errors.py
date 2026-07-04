"""Coded HTTP errors for the AI (translation/transcription) endpoints.

The frontend keys off a stable ``code`` to show a localized, actionable message,
so errors carry a machine code in addition to the (English, log-friendly)
``detail``. ``detail`` stays a plain string for backward compatibility.
"""

from typing import cast

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
import httpx

from backend.services.ai_errors import ProviderError


class CodedHTTPException(HTTPException):
    """HTTPException that also carries a stable ``code`` for the UI."""

    def __init__(self, status_code: int, code: str, detail: str):
        super().__init__(status_code=status_code, detail=detail)
        self.code = code


async def coded_http_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """Serialize a CodedHTTPException as ``{"detail": ..., "code": ...}``."""
    coded = cast(CodedHTTPException, exc)
    return JSONResponse(
        status_code=coded.status_code,
        content={"detail": coded.detail, "code": coded.code},
    )


def ai_provider_error(exc: Exception) -> CodedHTTPException:
    """Map an AI provider/transport exception to a coded HTTP error.

    Provider-agnostic and never leaks raw exception text to the client (details
    go to the logs); the ``code`` drives the localized message shown to the user.
    """
    # Semantic provider failures (safety block, truncation, empty/bad response).
    if isinstance(exc, ProviderError):
        # safety_blocked isn't retryable → 422; the rest are 502 (upstream gave
        # us something unusable). Either way the code selects the user message.
        status = 422 if exc.code == "safety_blocked" else 502
        return CodedHTTPException(status, exc.code, str(exc) or exc.code)

    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status == 429:
            return CodedHTTPException(429, "rate_limit", "Rate limit reached.")
        if status in (401, 403):
            return CodedHTTPException(401, "invalid_key", "API key rejected.")
        if status == 404:
            return CodedHTTPException(502, "model_not_found", "Model not found.")
        if status == 503:
            return CodedHTTPException(503, "unavailable", "Provider unavailable.")
        return CodedHTTPException(502, "provider_error", f"Provider error ({status}).")

    if isinstance(exc, httpx.ConnectError):
        return CodedHTTPException(503, "network", "Cannot reach the provider.")
    if isinstance(exc, httpx.TimeoutException):
        return CodedHTTPException(504, "timeout", "Provider timed out.")

    return CodedHTTPException(500, "unknown", "Request failed.")
