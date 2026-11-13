"""Remote ids and names never leave their folder (security audit 2026-11-13).

backend/services/blog_service.py:remote-blog-identifiers-as-path-segments and
backend/services/sync_service.py:media_queue:remote-ids-unvalidated-paths-escape-service-data-dir:
ids from the official sites and APIs became folder and file names unchecked, so
``../``, drive, UNC and absolute forms wrote outside the archive.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.services.safe_paths import (
    UnsafePath,
    is_int_id,
    is_safe_id,
    is_within,
    join_within,
    plain_segment,
)

BASE = Path("/w/out/日向坂46")


@pytest.mark.parametrize(
    "value", ["55401", "0", "000", "b1", "post_1", "a-b", "x" * 64]
)
def test_safe_ids(value):
    assert is_safe_id(value) is True


@pytest.mark.parametrize(
    "value",
    [
        "",
        "x" * 65,
        "../x",
        "..",
        ".",
        "a/b",
        "a\\b",
        "C:x",
        "a:b",
        "a b",
        "a.b",
        "１２３",
        "\x00",
        "CON",
        "con",
        "Nul",
        "COM1",
        "lpt9",
        55401,
        None,
        True,
    ],
)
def test_unsafe_ids(value):
    assert is_safe_id(value) is False


@pytest.mark.parametrize("value", [0, 1, 2**40, -3])
def test_int_ids(value):
    assert is_int_id(value) is True


@pytest.mark.parametrize("value", [True, False, "1", 1.0, None, "../x"])
def test_non_int_ids(value):
    assert is_int_id(value) is False


@pytest.mark.parametrize(
    "name",
    ["金村 美玖", "金村 美玖 🌸", "20260205_b1", "a.b", "a..b", "-x", "x" * 255],
)
def test_plain_segments(name):
    assert plain_segment(name) is True


@pytest.mark.parametrize(
    "name",
    [
        "",
        ".",
        "..",
        "a/b",
        "a\\b",
        "C:x",
        "a:b",
        "a*b",
        "a?b",
        'a"b',
        "a<b",
        "a>b",
        "a|b",
        "a\nb",
        "a\x00b",
        "a.",
        "a ",
        "CON",
        "con.txt",
        "COM1.jpg",
        "LPT²",
        "x" * 256,
        None,
        5,
    ],
)
def test_not_plain_segments(name):
    assert plain_segment(name) is False


def test_join_within_joins_plain_parts():
    assert join_within(BASE, "blogs", "金村 美玖") == BASE / "blogs" / "金村 美玖"


@pytest.mark.parametrize(
    "parts", [(), ("..",), ("a", "../x"), ("C:x",), ("\\\\host\\share",), ("a", "")]
)
def test_join_within_refuses_a_part_that_leaves(parts):
    with pytest.raises(UnsafePath) as exc:
        join_within(BASE, *parts)
    assert exc.value.reason == "segment"
    assert isinstance(exc.value, ValueError)


@pytest.mark.parametrize(
    "path",
    [
        BASE / "messages" / "1 G" / "5 M" / "picture" / "2.jpg",
        BASE / "a.jpg",
        Path("/w/out/日向坂46/./messages/a.jpg"),
    ],
)
def test_is_within_accepts_paths_inside(path):
    assert is_within(BASE, path) is True


@pytest.mark.parametrize(
    "path",
    [
        BASE,
        BASE.parent,
        BASE / "messages/1 G/5 M/picture" / "../../../../../../ver3-escape/rel.png",
        BASE / "messages/1 G/5 M/picture" / "/home/x/ver3-abs/abs-dummy.mp3",
        BASE / "messages" / "../../../../../ver3-room G" / "5 M",
        BASE / "messages/1 G/5 M/picture" / "..\\..\\x.png",
        BASE / "messages" / "C:x.png",
        Path("/w/out/乃木坂46/a.jpg"),
        Path("relative/a.jpg"),
    ],
)
def test_is_within_refuses_paths_that_leave(path):
    assert is_within(BASE, path) is False
