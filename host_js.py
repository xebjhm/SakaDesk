"""Eval-free host → page calls for pywebview 5.3.2 (security audit 2026-11-13).

``window.evaluate_js(script)`` wraps ``script`` in ``eval("...")`` inside the
page, which a CSP without ``'unsafe-eval'`` refuses. With ``raw=True``
pywebview hands the script to WebView2's ``ExecuteScriptAsync`` as is, and
nothing here calls ``eval`` or ``Function``, so no CSP exemption is needed.
Raw mode has two traps in 5.3.2 that this module handles:

1. The script still goes through ``webview.util.escape_string`` (``\\`` to
   ``\\\\``, ``"`` to ``\\"``, LF/CR to ``\\n``/``\\r``), which would corrupt
   any script containing those characters. :func:`script` refuses them;
   values reach the page percent-encoded (:func:`js_value`), and
   percent-encoding emits none of them.
2. The EdgeChromium backend JSON-decodes the result twice and does not
   release the waiting thread when the second decode raises (a bare ``true``
   would hang the caller). Every script therefore completes with a string of
   JSON: ``{"v": <value>}``, or ``{"e": "<error name>"}`` when the page
   expression threw.
"""

from __future__ import annotations

import json
from typing import Any, Protocol
from urllib.parse import quote

SCRIPT_HEAD = "(function(){try{return JSON.stringify({v:("
SCRIPT_TAIL = (
    ")})}catch(e){return JSON.stringify({e:String((e&&e.name)||'Error')})}})()"
)
_FORBIDDEN = ('"', "\\", "\n", "\r")


class HostScriptError(Exception):
    """The page expression threw; ``name`` is the JavaScript error's name (a code)."""

    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.name = name


class _Window(Protocol):
    def evaluate_js(
        self, script: str, callback: Any = None, raw: bool = False
    ) -> Any: ...


def js_value(value: object) -> str:
    """A page expression that rebuilds ``value`` (any JSON value) with no quote, backslash or newline.

    Raises ``TypeError`` / ``ValueError`` for a value JSON cannot hold.
    """
    # ASCII JSON: a lone surrogate becomes a \udXXX escape (quoted as %5C...) instead of
    # failing to encode; JSON.parse restores it.
    text = json.dumps(value, ensure_ascii=True, allow_nan=False)
    return "JSON.parse(decodeURIComponent('" + quote(text, safe="") + "'))"


def script(expression: str) -> str:
    """The raw-mode script that evaluates ``expression`` and completes with a JSON string.

    Raises ``ValueError`` when ``expression`` contains a character raw mode
    would corrupt (``"``, ``\\``, CR, LF).
    """
    if any(ch in expression for ch in _FORBIDDEN):
        raise ValueError("host_script_forbidden_char")
    return SCRIPT_HEAD + expression + SCRIPT_TAIL


def run(window: _Window, expression: str) -> Any:
    """Evaluate ``expression`` in ``window``'s page without ``eval``; its JSON value or ``None``.

    ``None`` also when the page gave no usable answer (window gone, script
    refused). Raises :class:`HostScriptError` when the expression threw.
    """
    result = window.evaluate_js(script(expression), raw=True)
    if isinstance(result, dict):
        if "e" in result:
            raise HostScriptError(str(result["e"]))
        return result.get("v")
    return None
