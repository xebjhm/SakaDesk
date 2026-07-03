"""Local-server auto-detect for the KB chatbot's Local backend (Product-wave
Task 5, item 4): `probe(base_url)` reports which models are actually
installed on whatever's listening at `base_url`, so the frontend can render
a live dropdown instead of a free-text field a user has to get exactly
right.

Tries Ollama's own listing endpoint first (`GET {root}/api/tags`), falling
back to the OpenAI-compatible `GET {base_url}/v1/models` listing that
llama.cpp, LM Studio, and Ollama itself all also serve -- so this works
against any of the local servers the Local backend supports, not just
Ollama specifically. Both probes are short-timeout and best-effort: this
function NEVER raises, matching `backend.services.hardware.detect_hardware`'s
"a probe failing is just a `None`/empty result, not an error" convention --
`GET /api/ai/local/probe` (see `backend/api/ai.py`) is meant to be polled
freely (on mount, on switching to Local) without special-casing failure.
"""

from __future__ import annotations

import httpx
import structlog

logger = structlog.get_logger(__name__)

# Short enough that switching to "Local" in Settings, or mounting the chat
# composer, never feels like it hung waiting on an absent server -- Ollama
# (or llama.cpp) answers a listing request near-instantly when it's up.
_PROBE_TIMEOUT_S = 1.5


async def probe(base_url: str) -> dict:
    """`{reachable: bool, models: list[str]}` for the local server configured
    at `base_url` (the OpenAI-compat base, e.g. `http://localhost:11434/v1`).

    `models` is empty whenever `reachable` is `False` -- a caller never needs
    to check both fields to know there's nothing to show.
    """
    root = base_url.rstrip("/")
    if root.endswith("/v1"):
        root = root[: -len("/v1")]

    tags = await _try_tags(root)
    if tags is not None:
        return {"reachable": True, "models": tags}

    openai_models = await _try_openai_models(base_url.rstrip("/"))
    if openai_models is not None:
        return {"reachable": True, "models": openai_models}

    return {"reachable": False, "models": []}


async def _try_tags(root: str) -> list[str] | None:
    """Ollama-native `GET {root}/api/tags` -> installed model names, or
    `None` on any failure (unreachable, non-200, or an unexpected body
    shape) -- `None` specifically signals "try the fallback", distinct from
    a successful-but-empty `[]` (no models installed, but the server IS up)."""
    url = f"{root}/api/tags"
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT_S) as client:
            resp = await client.get(url)
    except httpx.HTTPError as exc:
        logger.debug("ollama.probe_tags_failed", url=url, error=str(exc))
        return None
    if resp.status_code != 200:
        return None
    try:
        data = resp.json()
    except ValueError as exc:
        logger.debug("ollama.probe_tags_invalid_json", url=url, error=str(exc))
        return None
    models = data.get("models") if isinstance(data, dict) else None
    if not isinstance(models, list):
        return None
    return [
        m["name"]
        for m in models
        if isinstance(m, dict) and isinstance(m.get("name"), str)
    ]


async def _try_openai_models(base_url: str) -> list[str] | None:
    """OpenAI-compat `GET {base_url}/models` -> model ids, or `None` on any
    failure. What llama.cpp/LM Studio (and Ollama itself) serve at the same
    base a chat request would go to."""
    url = f"{base_url}/models"
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT_S) as client:
            resp = await client.get(url)
    except httpx.HTTPError as exc:
        logger.debug("ollama.probe_v1_models_failed", url=url, error=str(exc))
        return None
    if resp.status_code != 200:
        return None
    try:
        data = resp.json()
    except ValueError as exc:
        logger.debug("ollama.probe_v1_models_invalid_json", url=url, error=str(exc))
        return None
    items = data.get("data") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return None
    return [
        m["id"] for m in items if isinstance(m, dict) and isinstance(m.get("id"), str)
    ]
