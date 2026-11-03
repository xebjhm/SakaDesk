"""Byte-identity guard: the read endpoints must answer exactly as before the
read-path performance work (spec §5.5). Regenerate ONLY for a reviewed,
intentional change: SAKADESK_UPDATE_GOLDEN=1 uv run pytest backend/tests/test_read_path_golden.py
"""

import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.tests.read_path_fixture import GOLDEN_CASES, build_archive

GOLDEN = Path(__file__).parent / "golden" / "read_path.json"
client = TestClient(app)


def _call(method: str, url: str, body):
    return client.post(url, json=body) if method == "POST" else client.get(url)


def _canonical(name: str, resp) -> dict:
    # Member order comes from iterdir(), which differs between ext4/NTFS/tmpfs; sort only those arrays.
    obj = resp.json()
    if name.startswith("groups"):
        for group in obj["groups"]:
            group["members"].sort(key=lambda m: str(m["id"]))
    elif name.startswith("group_"):
        obj["members"].sort(key=lambda m: str(m["id"]))
    return {"status": resp.status_code, "body": json.dumps(obj, ensure_ascii=False)}


@pytest.fixture
def archive(tmp_path):
    root = build_archive(tmp_path)
    with patch("backend.api.content.get_output_dir", return_value=root):
        yield root


def test_read_endpoints_match_golden(archive):
    actual = {}
    for name, (method, url, body) in GOLDEN_CASES.items():
        actual[name] = _canonical(name, _call(method, url, body))

    if os.environ.get("SAKADESK_UPDATE_GOLDEN") == "1":
        GOLDEN.parent.mkdir(exist_ok=True)
        with open(GOLDEN, "w", encoding="utf-8") as f:
            json.dump(actual, f, ensure_ascii=False, indent=2)
        pytest.skip("golden regenerated")

    with open(GOLDEN, encoding="utf-8") as f:
        expected = json.load(f)
    for name in GOLDEN_CASES:
        assert actual[name] == expected[name], name
