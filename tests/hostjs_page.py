"""Test helper: read what a host_js script asks the page to do, without a browser."""

from __future__ import annotations

import json
import re
from urllib.parse import unquote

import host_js

_VALUE = re.compile(r"JSON\.parse\(decodeURIComponent\('([^']*)'\)\)")


def expression(script: str) -> str:
    """The page expression inside a :func:`host_js.script` wrapper."""
    assert script.startswith(host_js.SCRIPT_HEAD) and script.endswith(
        host_js.SCRIPT_TAIL
    )
    return script[len(host_js.SCRIPT_HEAD) : -len(host_js.SCRIPT_TAIL)]


def values(script: str) -> list:
    """The values the script hands the page, decoded (in order)."""
    return [json.loads(unquote(v)) for v in _VALUE.findall(expression(script))]


def shape(script: str) -> str:
    """The expression with every value shown as ``<value>``."""
    return _VALUE.sub("<value>", expression(script))
