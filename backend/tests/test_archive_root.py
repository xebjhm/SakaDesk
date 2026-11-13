"""A saved drive-root archive loads (Plan C ledger follow-up, audit 2026-11-13).

validate_path_within_dir compared str(target) with str(base) + os.sep, which
doubled the separator for a root base ("D:\\" or "/") and refused every path.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from backend.api.content import validate_path_within_dir


def test_a_root_base_accepts_a_path_below_it():
    root = Path(Path.cwd().anchor)
    got = validate_path_within_dir(root, "tmp")
    assert got == (root / "tmp").resolve()


def test_a_normal_base_still_refuses_a_sibling(tmp_path):
    (tmp_path / "out").mkdir()
    with pytest.raises(HTTPException) as exc:
        validate_path_within_dir(tmp_path / "out", "../out2/x")
    assert exc.value.status_code == 403


def test_the_base_itself_is_allowed(tmp_path):
    assert validate_path_within_dir(tmp_path, ".") == tmp_path.resolve()
