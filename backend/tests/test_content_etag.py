import asyncio
import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.tests.read_path_fixture import HINATA_GROUP, HINATA_SINGLE, build_archive

client = TestClient(app)


@pytest.fixture
def archive(tmp_path):
    root = build_archive(tmp_path)
    with patch("backend.api.content.get_output_dir", return_value=root):
        yield root


@pytest.mark.parametrize(
    "url",
    [
        f"/api/content/messages_by_path?path={HINATA_SINGLE}&last_read_id=0",
        f"/api/content/group_messages/{HINATA_GROUP}?limit=0",
    ],
)
def test_etag_roundtrip_and_invalidation(archive, url):
    first = client.get(url)
    etag = first.headers["etag"]
    assert first.headers["cache-control"] == "no-cache"

    again = client.get(url, headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b""

    other_params = client.get(url + "&limit=1", headers={"If-None-Match": etag})
    assert other_params.status_code == 200  # params are part of the key

    target = (
        archive
        / (
            HINATA_SINGLE
            if "messages_by_path" in url
            else f"{HINATA_GROUP}/1 メンバーA"
        )
        / "messages.json"
    )
    data = json.loads(target.read_text(encoding="utf-8"))
    data["messages"][0]["is_favorite"] = True
    target.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    changed = client.get(url, headers={"If-None-Match": etag})
    assert changed.status_code == 200 and changed.headers["etag"] != etag


def test_chat_loads_run_off_loop(archive):
    with patch("backend.api.content.asyncio.to_thread", wraps=asyncio.to_thread) as spy:
        client.get(f"/api/content/messages_by_path?path={HINATA_SINGLE}")
        client.get(f"/api/content/group_messages/{HINATA_GROUP}")
    assert spy.call_count >= 2
