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


SINGLE_URL = f"/api/content/messages_by_path?path={HINATA_SINGLE}&last_read_id=0"
GROUP_URL = f"/api/content/group_messages/{HINATA_GROUP}?limit=0"
LOADERS = {
    SINGLE_URL: "backend.api.content._load_member_messages",
    GROUP_URL: "backend.api.content._load_group_messages",
}


def test_messages_by_path_parses_off_loop(archive):
    with patch("backend.api.content.asyncio.to_thread", wraps=asyncio.to_thread) as spy:
        assert client.get(SINGLE_URL).status_code == 200
    assert spy.call_count == 1  # loader only


def test_group_messages_lists_and_parses_off_loop(archive):
    with patch("backend.api.content.asyncio.to_thread", wraps=asyncio.to_thread) as spy:
        assert client.get(GROUP_URL).status_code == 200
    assert spy.call_count == 2  # member file listing + loader


@pytest.mark.parametrize("url", [SINGLE_URL, GROUP_URL])
def test_304_has_headers_and_skips_loader(archive, url):
    etag = client.get(url).headers["etag"]
    with patch(LOADERS[url]) as loader:
        res = client.get(url, headers={"If-None-Match": etag})
    assert res.status_code == 304
    assert res.headers["etag"] == etag
    assert res.headers["cache-control"] == "no-cache"
    loader.assert_not_called()


@pytest.mark.parametrize("url", [SINGLE_URL, GROUP_URL])
@pytest.mark.parametrize(
    "header",
    ["W/{etag}", '"other", {etag}', '"other",W/{etag} , "x"', "*"],
)
def test_if_none_match_rfc9110_forms(archive, url, header):
    etag = client.get(url).headers["etag"]
    res = client.get(url, headers={"If-None-Match": header.format(etag=etag)})
    assert res.status_code == 304


@pytest.mark.parametrize("url", [SINGLE_URL, GROUP_URL])
def test_if_none_match_non_matching_returns_body(archive, url):
    res = client.get(url, headers={"If-None-Match": '"other", W/"x"'})
    assert res.status_code == 200


def test_group_etag_changes_when_member_added(archive):
    etag = client.get(GROUP_URL).headers["etag"]
    new_dir = archive / HINATA_GROUP / "3 メンバーC"
    new_dir.mkdir()
    (new_dir / "messages.json").write_text(
        json.dumps({"member": {"id": 3, "name": "メンバーC"}, "messages": []}),
        encoding="utf-8",
    )
    res = client.get(GROUP_URL, headers={"If-None-Match": etag})
    assert res.status_code == 200 and res.headers["etag"] != etag


def test_group_etag_changes_when_member_file_deleted(archive):
    etag = client.get(GROUP_URL).headers["etag"]
    (archive / HINATA_GROUP / "1 メンバーA" / "messages.json").unlink()
    res = client.get(GROUP_URL, headers={"If-None-Match": etag})
    assert res.status_code == 200 and res.headers["etag"] != etag
