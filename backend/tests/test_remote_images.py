"""Blog backup images come only from the official sites (security audit 2026-11-13).

report-hardening #35/#36/#65: remote blog HTML and member JSON chose image URLs
that the backup fetched from any host (LAN and loopback included), following
redirects anywhere, over cleartext http, reading bodies of any size.
"""

from __future__ import annotations

import pytest
from structlog.testing import capture_logs

from backend.services import blog_service as blog_service_module
from backend.services import remote_images as ri
from backend.services.blog_service import BlogService

OK = "https://cdn.hinatazaka46.com/files/a.jpg"


class _Resp:
    def __init__(self, status=200, headers=None, chunks=(b"img",), length=None):
        self.status = status
        self.headers = {"Content-Type": "image/jpeg"} if headers is None else headers
        self.content_length = length
        self._chunks = list(chunks)
        self.content = self

    async def iter_chunked(self, _size):
        for chunk in self._chunks:
            yield chunk

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _Session:
    def __init__(self, responses):
        self.responses = dict(responses)
        self.calls: list[tuple[str, bool]] = []
        self.timeouts: list[object] = []

    def get(self, url, allow_redirects=True, timeout=None):
        self.calls.append((url, allow_redirects))
        self.timeouts.append(timeout)
        return self.responses[url]


@pytest.mark.asyncio
async def test_an_official_https_image_is_fetched_without_following_redirects():
    session = _Session({OK: _Resp(chunks=[b"ab", b"cd"])})
    assert await ri.fetch_official_image(session, OK) == (b"abcd", "image/jpeg")
    assert session.calls == [(OK, False)]


@pytest.mark.parametrize(
    "url,reason",
    [
        ("https://127.0.0.1/a.jpg", "host"),
        ("https://192.168.0.10/a.jpg", "host"),
        ("https://cdn.hinatazaka46.com.evil.example/a.jpg", "host"),
        ("https://cdn.hinatazaka46.com:8443/a.jpg", "port"),
        ("https://[::1/a.jpg", "invalid_url"),
        ("", "invalid_url"),
        (None, "invalid_url"),
    ],
)
@pytest.mark.asyncio
async def test_other_urls_are_refused_before_any_request(url, reason):
    session = _Session({})
    with pytest.raises(ri.RemoteImageRefused) as exc:
        await ri.fetch_official_image(session, url)
    assert exc.value.reason == reason
    assert session.calls == []


@pytest.mark.asyncio
async def test_each_redirect_hop_is_checked_before_it_is_requested():
    hop = "https://img.nogizaka46.com/b.jpg"
    session = _Session({OK: _Resp(302, {"Location": hop}), hop: _Resp(chunks=[b"x"])})
    assert (await ri.fetch_official_image(session, OK))[0] == b"x"

    evil = _Session(
        {OK: _Resp(302, {"Location": "http://127.0.0.1:8000/api/settings"})}
    )
    with pytest.raises(ri.RemoteImageRefused) as exc:
        await ri.fetch_official_image(evil, OK)
    assert exc.value.reason == "scheme"
    assert evil.calls == [(OK, False)]


@pytest.mark.asyncio
async def test_a_relative_location_stays_on_the_same_host():
    session = _Session(
        {
            OK: _Resp(301, {"Location": "/files/b.jpg"}),
            "https://cdn.hinatazaka46.com/files/b.jpg": _Resp(),
        }
    )
    assert (await ri.fetch_official_image(session, OK))[0] == b"img"


@pytest.mark.asyncio
async def test_too_many_redirects_and_a_missing_location_are_refused():
    loop = _Session({OK: _Resp(302, {"Location": OK})})
    with pytest.raises(ri.RemoteImageRefused) as exc:
        await ri.fetch_official_image(loop, OK)
    assert exc.value.reason == "redirect"
    assert len(loop.calls) == ri.MAX_REDIRECTS + 1
    with pytest.raises(ri.RemoteImageRefused):
        await ri.fetch_official_image(_Session({OK: _Resp(302, {})}), OK)


@pytest.mark.asyncio
async def test_oversized_bodies_are_refused():
    declared = _Session({OK: _Resp(length=ri.MAX_REMOTE_IMAGE_BYTES + 1)})
    with pytest.raises(ri.RemoteImageRefused) as exc:
        await ri.fetch_official_image(declared, OK)
    assert exc.value.reason == "too_large"
    streamed = _Session({OK: _Resp(chunks=[b"x" * 6, b"x" * 6])})
    with pytest.raises(ri.RemoteImageRefused) as exc:
        await ri.fetch_official_image(streamed, OK, max_bytes=10)
    assert exc.value.reason == "too_large"


@pytest.mark.asyncio
async def test_a_non_200_answer_carries_its_status():
    with pytest.raises(ri.RemoteImageRefused) as exc:
        await ri.fetch_official_image(_Session({OK: _Resp(404)}), OK)
    assert (exc.value.reason, exc.value.status) == ("status", 404)


@pytest.mark.asyncio
async def test_the_backup_never_fetches_an_off_list_image(tmp_path):
    blog_service_module._image_refusal_logs.reset()
    session = _Session({})
    with capture_logs() as logs:
        results = await BlogService()._download_images(
            session, ["http://192.168.0.1/a.jpg"], tmp_path / "images"
        )
    assert results == [{"original_url": "http://192.168.0.1/a.jpg", "local_path": None}]
    assert session.calls == []
    assert {
        "event": "blog_image_refused",
        "reason": "scheme",
        "log_level": "info",
    } in logs
    assert "192.168" not in repr(logs)


@pytest.mark.asyncio
async def test_a_member_thumbnail_on_a_loopback_url_is_not_fetched(tmp_path):
    session = _Session({})
    with capture_logs() as logs:
        name = await BlogService()._download_member_thumbnail(
            session, "55401", "http://127.0.0.1:1/x.jpg", tmp_path
        )
    assert name is None and session.calls == []
    assert {
        "event": "thumbnail_download_refused",
        "reason": "scheme",
        "log_level": "warning",
    } in logs


@pytest.mark.asyncio
async def test_an_old_http_link_on_an_official_host_is_fetched_over_https():
    """Older posts embed http:// links to the official sites; the fetch upgrades them."""
    session = _Session({OK: _Resp()})
    body, _ = await ri.fetch_official_image(
        session, "http://cdn.hinatazaka46.com/files/a.jpg"
    )
    assert body == b"img"
    assert session.calls == [(OK, False)]


@pytest.mark.asyncio
async def test_http_on_another_host_is_still_refused():
    session = _Session({})
    with pytest.raises(ri.RemoteImageRefused) as err:
        await ri.fetch_official_image(session, "http://192.168.0.1/a.jpg")
    assert err.value.reason == "scheme" and session.calls == []


@pytest.mark.asyncio
async def test_every_request_has_a_bounded_timeout():
    session = _Session({OK: _Resp()})
    await ri.fetch_official_image(session, OK)
    assert session.timeouts == [ri.FETCH_TIMEOUT]
    assert ri.FETCH_TIMEOUT.total is not None and ri.FETCH_TIMEOUT.total <= 60
