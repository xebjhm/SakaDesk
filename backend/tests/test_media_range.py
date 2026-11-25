"""Bounded media range serving (R-h Task 12).

Videos stalled because Chromium allows only six low-priority requests per host
and ``GET /api/content/media/...`` answered ``Range: bytes=N-`` with the whole
rest of the file, so paused or abandoned downloads held those slots. These
tests pin the RFC 9110 range semantics of the bounded response, the
stop-on-disconnect behaviour and the ``media_request`` breadcrumb.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.services import api_auth, media_range
from backend.services.media_range import (
    MEDIA_RANGE_CAP,
    ByteRange,
    MediaFileResponse,
    RangeNotSatisfiable,
    resolve_range,
)

client = TestClient(app)

MiB = 1024 * 1024


@pytest.fixture(autouse=True)
def _log_every_request(monkeypatch):
    """Existing tests inspect each request's breadcrumb: sample all, fresh counters."""
    monkeypatch.setattr(media_range, "MEDIA_LOG_SAMPLE_EVERY", 1)
    monkeypatch.setattr(media_range, "MEDIA_SUMMARY_EVERY", 10**9)
    monkeypatch.setattr(media_range, "_request_count", 0)
    monkeypatch.setattr(media_range, "_summary_counts", {})


# ---------------------------------------------------------------------------
# resolve_range — pure RFC 9110 parsing
# ---------------------------------------------------------------------------


class TestResolveRange:
    def test_no_header_means_full_body(self):
        assert resolve_range(None, 100) is None

    def test_open_ended_is_capped(self):
        r = resolve_range("bytes=0-", 10 * MiB)
        assert r == ByteRange(0, MEDIA_RANGE_CAP - 1, capped=True)
        assert r is not None and r.length == MEDIA_RANGE_CAP

    def test_open_ended_from_middle_is_capped(self):
        r = resolve_range("bytes=1000-", 10 * MiB)
        assert r == ByteRange(1000, 1000 + MEDIA_RANGE_CAP - 1, capped=True)

    def test_open_ended_near_end_stops_at_last_byte(self):
        assert resolve_range("bytes=90-", 100) == ByteRange(90, 99)

    def test_explicit_middle_range_is_kept(self):
        assert resolve_range("bytes=10-19", 100) == ByteRange(10, 19)

    def test_explicit_range_larger_than_cap_is_trimmed(self):
        r = resolve_range(f"bytes=0-{5 * MiB}", 10 * MiB)
        assert r == ByteRange(0, MEDIA_RANGE_CAP - 1, capped=True)

    def test_last_pos_past_end_is_clamped(self):
        assert resolve_range("bytes=95-500", 100) == ByteRange(95, 99)

    def test_suffix_range(self):
        assert resolve_range("bytes=-10", 100) == ByteRange(90, 99)

    def test_suffix_longer_than_file_is_whole_file(self):
        assert resolve_range("bytes=-500", 100) == ByteRange(0, 99)

    def test_suffix_larger_than_cap_is_capped_from_its_start(self):
        r = resolve_range(f"bytes=-{4 * MiB}", 10 * MiB)
        assert r == ByteRange(6 * MiB, 6 * MiB + MEDIA_RANGE_CAP - 1, capped=True)

    def test_custom_cap(self):
        assert resolve_range("bytes=0-", 100, cap=10) == ByteRange(0, 9, capped=True)

    def test_first_pos_at_size_is_unsatisfiable(self):
        with pytest.raises(RangeNotSatisfiable) as exc:
            resolve_range("bytes=100-", 100)
        assert exc.value.size == 100

    def test_first_pos_past_size_is_unsatisfiable(self):
        with pytest.raises(RangeNotSatisfiable):
            resolve_range("bytes=500-600", 100)

    def test_zero_suffix_is_unsatisfiable(self):
        with pytest.raises(RangeNotSatisfiable):
            resolve_range("bytes=-0", 100)

    def test_any_range_on_empty_file_is_unsatisfiable(self):
        with pytest.raises(RangeNotSatisfiable) as exc:
            resolve_range("bytes=0-", 0)
        assert exc.value.size == 0

    def test_multi_range_serves_first_range_only(self):
        assert resolve_range("bytes=0-9, 50-59", 100) == ByteRange(0, 9)

    def test_multi_range_skips_unsatisfiable_leading_range(self):
        assert resolve_range("bytes=500-, 20-29", 100) == ByteRange(20, 29)

    def test_multi_range_all_unsatisfiable(self):
        with pytest.raises(RangeNotSatisfiable):
            resolve_range("bytes=500-, 600-", 100)

    def test_unit_is_case_insensitive_and_whitespace_tolerant(self):
        assert resolve_range(" Bytes = 1-2 ", 100) == ByteRange(1, 2)

    def test_empty_list_elements_are_skipped(self):
        assert resolve_range("bytes=, 3-4,", 100) == ByteRange(3, 4)

    @pytest.mark.parametrize(
        "header",
        [
            "items=0-10",  # unknown unit: MUST be ignored
            "bytes",  # no '='
            "bytes=",  # no ranges
            "bytes=-",  # neither position
            "bytes=abc-",  # not digits
            "bytes=10-5",  # last < first is invalid
            "bytes=0-9, x",  # one invalid spec invalidates the set
            "bytes=+1-2",  # sign is not a digit
        ],
    )
    def test_unknown_or_invalid_range_is_ignored(self, header: str):
        assert resolve_range(header, 100) is None

    def test_rejects_non_positive_cap(self):
        with pytest.raises(ValueError):
            resolve_range("bytes=0-", 100, cap=0)


# ---------------------------------------------------------------------------
# GET /api/content/media/... — over HTTP through the real app + middleware
# ---------------------------------------------------------------------------


def _make_file(tmp_path: Path, name: str, size: int) -> Path:
    path = tmp_path / name
    path.write_bytes(bytes(i % 251 for i in range(size)))
    return path


def _get(path: Path, headers: dict[str, str] | None = None):
    with patch("backend.api.content._resolve_media_path", return_value=path):
        return client.get("/api/content/media/svc/x", headers=headers or {})


class TestMediaRoute:
    def test_open_ended_range_returns_bounded_206(self, tmp_path):
        size = MEDIA_RANGE_CAP * 3 + 123
        video = _make_file(tmp_path, "clip.mp4", size)
        resp = _get(video, {"Range": "bytes=0-"})
        assert resp.status_code == 206
        assert resp.headers["content-range"] == f"bytes 0-{MEDIA_RANGE_CAP - 1}/{size}"
        assert resp.headers["content-length"] == str(MEDIA_RANGE_CAP)
        assert resp.headers["accept-ranges"] == "bytes"
        assert resp.headers["content-type"] == "video/mp4"
        assert resp.content == video.read_bytes()[:MEDIA_RANGE_CAP]

    def test_middle_range(self, tmp_path):
        video = _make_file(tmp_path, "clip.mp4", 5000)
        resp = _get(video, {"Range": "bytes=1000-1999"})
        assert resp.status_code == 206
        assert resp.headers["content-range"] == "bytes 1000-1999/5000"
        assert resp.headers["content-length"] == "1000"
        assert resp.content == video.read_bytes()[1000:2000]

    def test_end_of_file_range(self, tmp_path):
        voice = _make_file(tmp_path, "voice.m4a", 5000)
        resp = _get(voice, {"Range": "bytes=4990-"})
        assert resp.status_code == 206
        assert resp.headers["content-range"] == "bytes 4990-4999/5000"
        assert resp.content == voice.read_bytes()[4990:]

    def test_over_the_end_is_416(self, tmp_path):
        video = _make_file(tmp_path, "clip.mp4", 5000)
        resp = _get(video, {"Range": "bytes=5000-"})
        assert resp.status_code == 416
        assert resp.headers["content-range"] == "bytes */5000"
        assert resp.headers["accept-ranges"] == "bytes"
        assert resp.content == b""

    def test_multi_range_serves_first_range(self, tmp_path):
        video = _make_file(tmp_path, "clip.mp4", 5000)
        resp = _get(video, {"Range": "bytes=0-9,100-199"})
        assert resp.status_code == 206
        assert resp.headers["content-range"] == "bytes 0-9/5000"
        assert "multipart" not in resp.headers["content-type"]
        assert resp.content == video.read_bytes()[:10]

    def test_image_without_range_is_full_200(self, tmp_path):
        # <img> never sends Range; a 206 without Range would violate RFC 9110.
        size = MEDIA_RANGE_CAP + 10
        pic = _make_file(tmp_path, "pic.jpg", size)
        resp = _get(pic)
        assert resp.status_code == 200
        assert resp.headers["content-length"] == str(size)
        assert resp.headers["accept-ranges"] == "bytes"
        assert resp.headers["content-type"] == "image/jpeg"
        assert "content-range" not in resp.headers
        assert resp.content == pic.read_bytes()

    def test_invalid_range_is_ignored_with_full_200(self, tmp_path):
        pic = _make_file(tmp_path, "pic.jpg", 300)
        resp = _get(pic, {"Range": "bytes=9-3"})
        assert resp.status_code == 200
        assert resp.content == pic.read_bytes()

    def test_empty_file_without_range(self, tmp_path):
        empty = _make_file(tmp_path, "empty.jpg", 0)
        resp = _get(empty)
        assert resp.status_code == 200
        assert resp.headers["content-length"] == "0"
        assert resp.content == b""

    def test_validators_match_previous_file_response(self, tmp_path):
        # Same ETag / Last-Modified recipe as Starlette's FileResponse, so the
        # WebView2 media cache keeps validating entries cached before the change.
        from starlette.responses import FileResponse

        video = _make_file(tmp_path, "clip.mp4", 100)
        expected = FileResponse(video, stat_result=video.stat())
        resp = _get(video, {"Range": "bytes=0-"})
        assert resp.headers["etag"] == expected.headers["etag"]
        assert resp.headers["last-modified"] == expected.headers["last-modified"]

    def test_missing_file_still_404(self):
        resp = client.get("/api/content/media/no/such/file.mp4")
        assert resp.status_code == 404

    def test_log_fields_for_range(self, tmp_path):
        size = MEDIA_RANGE_CAP * 2
        video = _make_file(tmp_path, "clip.mp4", size)
        with capture_logs() as logs:
            resp = _get(video, {"Range": "bytes=0-"})
        assert resp.status_code == 206
        events = [e for e in logs if e["event"] == "media_request"]
        assert len(events) == 1
        e = events[0]
        assert e["status"] == 206
        assert e["range"] == "bytes=0-"
        assert e["range_ignored"] is False
        assert e["capped"] is True
        assert e["bytes_sent"] == MEDIA_RANGE_CAP
        assert e["size"] == size
        assert e["media_kind"] == "video"
        assert e["client_disconnected"] is False
        assert isinstance(e["elapsed_ms"], float) and e["elapsed_ms"] >= 0
        # No path / file name in the breadcrumb.
        assert all("clip" not in str(v) for v in e.values())

    def test_log_fields_for_416(self, tmp_path):
        video = _make_file(tmp_path, "clip.mp4", 10)
        with capture_logs() as logs:
            _get(video, {"Range": "bytes=10-"})
        (e,) = [e for e in logs if e["event"] == "media_request"]
        assert e["status"] == 416
        assert e["bytes_sent"] == 0
        assert e["client_disconnected"] is False

    def test_log_marks_ignored_range(self, tmp_path):
        pic = _make_file(tmp_path, "pic.jpg", 10)
        with capture_logs() as logs:
            _get(pic, {"Range": "lines=1-2"})
        (e,) = [e for e in logs if e["event"] == "media_request"]
        assert e["status"] == 200
        assert e["range_ignored"] is True
        assert e["media_kind"] == "image"

    def test_avatar_route_still_uses_file_response(self, tmp_path):
        # Untouched: the avatar route keeps Starlette's FileResponse.
        from fastapi.responses import FileResponse

        src = tmp_path / "a.png"
        src.write_bytes(b"\x89PNG")
        with (
            patch("backend.api.content._resolve_media_path", return_value=src),
            patch("backend.services.avatar_resize.resized_avatar", return_value=src),
            patch(
                "backend.api.content.FileResponse", wraps=FileResponse
            ) as file_response,
            patch(
                "backend.api.content.MediaFileResponse", wraps=MediaFileResponse
            ) as media_response,
        ):
            resp = client.get("/api/content/avatar/svc/a.png?w=64")
        assert resp.status_code == 200
        assert resp.content == b"\x89PNG"
        file_response.assert_called_once()
        assert file_response.call_args.args == (src,)
        assert file_response.call_args.kwargs["media_type"] == "image/png"
        media_response.assert_not_called()

    # -- If-Range (RFC 9110 §13.1.5) ---------------------------------------

    def test_if_range_matching_etag_serves_206(self, tmp_path):
        video = _make_file(tmp_path, "clip.mp4", 5000)
        etag = _get(video).headers["etag"]
        resp = _get(video, {"Range": "bytes=10-19", "If-Range": etag})
        assert resp.status_code == 206
        assert resp.headers["content-range"] == "bytes 10-19/5000"
        assert resp.content == video.read_bytes()[10:20]

    def test_if_range_matching_date_serves_206(self, tmp_path):
        video = _make_file(tmp_path, "clip.mp4", 5000)
        date = _get(video).headers["last-modified"]
        with capture_logs() as logs:
            resp = _get(video, {"Range": "bytes=10-19", "If-Range": date})
        assert resp.status_code == 206
        assert resp.content == video.read_bytes()[10:20]
        (e,) = [e for e in logs if e["event"] == "media_request"]
        assert e["if_range_matched"] is True
        assert e["range_ignored"] is False

    @pytest.mark.parametrize(
        "if_range",
        [
            '"stale-etag"',
            "Mon, 01 Jan 2001 00:00:00 GMT",
            "garbage",
        ],
    )
    def test_stale_if_range_sends_full_200(self, tmp_path, if_range):
        video = _make_file(tmp_path, "clip.mp4", 5000)
        with capture_logs() as logs:
            resp = _get(video, {"Range": "bytes=10-19", "If-Range": if_range})
        assert resp.status_code == 200
        assert resp.headers["content-length"] == "5000"
        assert "content-range" not in resp.headers
        assert resp.content == video.read_bytes()
        (e,) = [e for e in logs if e["event"] == "media_request"]
        assert e["range_ignored"] is True
        assert e["if_range_matched"] is False

    def test_weak_etag_in_if_range_never_matches(self, tmp_path):
        video = _make_file(tmp_path, "clip.mp4", 5000)
        etag = _get(video).headers["etag"]
        resp = _get(video, {"Range": "bytes=10-19", "If-Range": f"W/{etag}"})
        assert resp.status_code == 200
        assert resp.content == video.read_bytes()

    def test_stale_if_range_beats_unsatisfiable_range(self, tmp_path):
        # If-Range is evaluated before Range, so a stale one gives 200, not 416.
        video = _make_file(tmp_path, "clip.mp4", 50)
        resp = _get(video, {"Range": "bytes=999-", "If-Range": '"old"'})
        assert resp.status_code == 200
        assert resp.content == video.read_bytes()

    def test_if_range_without_range_is_plain_200(self, tmp_path):
        video = _make_file(tmp_path, "clip.mp4", 50)
        with capture_logs() as logs:
            resp = _get(video, {"If-Range": '"old"'})
        assert resp.status_code == 200
        (e,) = [e for e in logs if e["event"] == "media_request"]
        assert e["if_range_matched"] is None
        assert e["range_ignored"] is False

    # -- vanished file / log hygiene ---------------------------------------

    def test_file_removed_before_stat_is_404(self, tmp_path):
        gone = tmp_path / "gone.mp4"
        with capture_logs() as logs:
            resp = _get(gone, {"Range": "bytes=0-"})
        assert resp.status_code == 404
        assert resp.json() == {"detail": "File not found"}
        (missing,) = [e for e in logs if e["event"] == "media_file_missing"]
        assert missing["stage"] == "stat"
        (e,) = [e for e in logs if e["event"] == "media_request"]
        assert e["status"] == 404
        assert e["size"] is None
        assert all("gone" not in str(v) for v in e.values())

    def test_file_removed_before_open_is_404(self, tmp_path):
        video = _make_file(tmp_path, "clip.mp4", 100)

        def vanished(path, offset):
            raise FileNotFoundError(path)

        with (
            patch.object(media_range, "_open_at", vanished),
            capture_logs() as logs,
        ):
            resp = _get(video, {"Range": "bytes=0-"})
        assert resp.status_code == 404
        (missing,) = [e for e in logs if e["event"] == "media_file_missing"]
        assert missing["stage"] == "open"
        (e,) = [e for e in logs if e["event"] == "media_request"]
        assert e["status"] == 404
        assert e["bytes_sent"] == 0

    def test_logged_range_header_is_capped(self, tmp_path):
        video = _make_file(tmp_path, "clip.mp4", 100)
        header = "bytes=0-9," + ",".join(["20-29"] * 50)
        with capture_logs() as logs:
            _get(video, {"Range": header})
        (e,) = [e for e in logs if e["event"] == "media_request"]
        assert e["range"] == header[: media_range.LOGGED_RANGE_MAX]
        assert len(e["range"]) == media_range.LOGGED_RANGE_MAX


# ---------------------------------------------------------------------------
# MediaFileResponse as a raw ASGI app — disconnect handling
# ---------------------------------------------------------------------------


def _scope(range_header: str | None = None) -> dict[str, Any]:
    headers = []
    if range_header is not None:
        headers.append((b"range", range_header.encode("latin-1")))
    return {
        "type": "http",
        "method": "GET",
        "path": "/api/content/media/x",
        "headers": headers,
        "asgi": {"version": "3.0", "spec_version": "2.3"},
    }


@pytest.mark.asyncio
async def test_disconnect_stops_reading(tmp_path):
    video = _make_file(tmp_path, "clip.mp4", MEDIA_RANGE_CAP * 2)
    first_body_sent = asyncio.Event()
    sent: list[dict[str, Any]] = []
    reads = 0
    real_read = media_range._read_chunk

    def counting_read(fh, n):
        nonlocal reads
        reads += 1
        return real_read(fh, n)

    async def receive() -> dict[str, Any]:
        if not getattr(receive, "requested", False):
            receive.requested = True  # type: ignore[attr-defined]
            return {"type": "http.request", "body": b"", "more_body": False}
        await first_body_sent.wait()
        return {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)
        if message["type"] == "http.response.body":
            first_body_sent.set()
            # Like uvicorn after an abort: send keeps returning silently.

    response = MediaFileResponse(video)
    with (
        patch.object(media_range, "_read_chunk", counting_read),
        capture_logs() as logs,
    ):
        await response(_scope("bytes=0-"), receive, send)

    bodies = [m for m in sent if m["type"] == "http.response.body"]
    chunks_in_cap = MEDIA_RANGE_CAP // media_range.CHUNK_SIZE
    assert len(bodies) <= 2 < chunks_in_cap
    assert reads <= 2
    (e,) = [e for e in logs if e["event"] == "media_request"]
    assert e["client_disconnected"] is True
    assert e["bytes_sent"] < MEDIA_RANGE_CAP


@pytest.mark.asyncio
async def test_send_oserror_is_treated_as_disconnect(tmp_path):
    # ASGI 2.4 servers raise OSError from send() once the client is gone.
    video = _make_file(tmp_path, "clip.mp4", MEDIA_RANGE_CAP)
    calls = 0

    async def receive() -> dict[str, Any]:
        await asyncio.Event().wait()  # never disconnects via receive
        return {}  # pragma: no cover

    async def send(message: dict[str, Any]) -> None:
        nonlocal calls
        calls += 1
        if message["type"] == "http.response.body":
            raise ConnectionResetError(10054, "reset")

    response = MediaFileResponse(video)
    with capture_logs() as logs:
        await response(_scope(), receive, send)

    assert calls == 2  # start + one failed body chunk, then stop
    (e,) = [e for e in logs if e["event"] == "media_request"]
    assert e["client_disconnected"] is True
    assert e["bytes_sent"] == 0
    assert e["status"] == 200


@pytest.mark.asyncio
async def test_file_shrinking_mid_stream_ends_response(tmp_path):
    video = _make_file(tmp_path, "clip.mp4", 1000)
    sent: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        await asyncio.Event().wait()
        return {}  # pragma: no cover

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    response = MediaFileResponse(video)
    with (
        patch.object(media_range, "_read_chunk", lambda fh, n: b""),
        capture_logs() as logs,
    ):
        await response(_scope(), receive, send)

    assert sent[-1] == {"type": "http.response.body", "body": b"", "more_body": False}
    (e,) = [e for e in logs if e["event"] == "media_request"]
    assert e["bytes_sent"] == 0
    assert e["truncated"] is True


@pytest.mark.asyncio
async def test_request_cancellation_is_not_swallowed(tmp_path):
    # The request task is cancelled while it awaits the cancelled watcher; that
    # cancellation must propagate instead of being suppressed with the watcher's.
    video = _make_file(tmp_path, "clip.mp4", 100)
    watcher_cancelling = asyncio.Event()

    async def receive() -> dict[str, Any]:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            watcher_cancelling.set()
            await asyncio.sleep(10)  # slow teardown; outer cancel lands here
            raise
        return {}  # pragma: no cover

    async def send(message: dict[str, Any]) -> None:
        return None

    task = asyncio.create_task(MediaFileResponse(video)(_scope(), receive, send))
    await asyncio.wait_for(watcher_cancelling.wait(), timeout=5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


@pytest.mark.asyncio
async def test_disconnect_through_real_app_stops_reading(tmp_path):
    """Same as above but through ``backend.main:app`` and its HTTP middleware."""
    video = _make_file(tmp_path, "clip.mp4", MEDIA_RANGE_CAP * 2)
    first_body_sent = asyncio.Event()
    sent: list[dict[str, Any]] = []
    requested = False

    async def receive() -> dict[str, Any]:
        nonlocal requested
        if not requested:
            requested = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await first_body_sent.wait()
        return {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)
        if message["type"] == "http.response.body":
            first_body_sent.set()

    scope = _scope("bytes=0-")
    scope.update(
        path="/api/content/media/svc/x",
        raw_path=b"/api/content/media/svc/x",
        query_string=b"",
        scheme="http",
        server=("127.0.0.1", 8000),
        client=("127.0.0.1", 50000),
        http_version="1.1",
        root_path="",
    )
    scope["headers"] = [
        *scope["headers"],
        (b"host", b"127.0.0.1:8000"),
        (api_auth.TOKEN_HEADER.encode(), api_auth.LAUNCH_TOKEN.encode()),
    ]

    with (
        patch("backend.api.content._resolve_media_path", return_value=video),
        capture_logs() as logs,
    ):
        await asyncio.wait_for(app(scope, receive, send), timeout=10)

    bodies = [m for m in sent if m["type"] == "http.response.body"]
    assert len(bodies) < MEDIA_RANGE_CAP // media_range.CHUNK_SIZE
    entries = [e for e in logs if e["event"] == "media_request"]
    assert len(entries) == 1
    assert entries[0]["client_disconnected"] is True
    assert entries[0]["bytes_sent"] < MEDIA_RANGE_CAP


class TestMediaLogSampling:
    """Per-request logs are sampled at debug; summaries and problems are not."""

    def test_routine_requests_are_sampled_at_debug(self, tmp_path, monkeypatch):
        monkeypatch.setattr(media_range, "MEDIA_LOG_SAMPLE_EVERY", 5)
        video = _make_file(tmp_path, "clip.mp4", 10)
        with capture_logs() as logs:
            for _ in range(10):
                assert _get(video, {"Range": "bytes=0-"}).status_code == 206
        lines = [e for e in logs if e["event"] == "media_request"]
        assert len(lines) == 2
        assert {e["log_level"] for e in lines} == {"debug"}

    def test_summary_every_n_requests_with_counts(self, tmp_path, monkeypatch):
        monkeypatch.setattr(media_range, "MEDIA_LOG_SAMPLE_EVERY", 10**9)
        monkeypatch.setattr(media_range, "MEDIA_SUMMARY_EVERY", 4)
        video = _make_file(tmp_path, "clip.mp4", 10)
        with capture_logs() as logs:
            for _ in range(3):
                _get(video, {"Range": "bytes=0-"})
            _get(video, {"Range": "bytes=10-"})  # 416
        (summary,) = [e for e in logs if e["event"] == "media_requests_summary"]
        assert summary["log_level"] == "info"
        assert summary["requests"] == 4
        assert summary["counts"] == [
            {"media_kind": "video", "status": 206, "count": 3},
            {"media_kind": "video", "status": 416, "count": 1},
        ]
        assert media_range._summary_counts == {}

    def test_errors_always_logged_at_info(self, tmp_path, monkeypatch):
        monkeypatch.setattr(media_range, "MEDIA_LOG_SAMPLE_EVERY", 10**9)
        video = _make_file(tmp_path, "clip.mp4", 10)
        with capture_logs() as logs:
            for _ in range(3):
                _get(video, {"Range": "bytes=10-"})
        lines = [e for e in logs if e["event"] == "media_request"]
        assert len(lines) == 3
        assert {(e["status"], e["log_level"]) for e in lines} == {(416, "info")}

    def test_disconnect_always_logged_at_info(self, tmp_path, monkeypatch):
        monkeypatch.setattr(media_range, "MEDIA_LOG_SAMPLE_EVERY", 10**9)
        stats = media_range._ServeStats(range_header=None)
        stats.client_disconnected = True
        resp = MediaFileResponse(_make_file(tmp_path, "clip.mp4", 10))
        with capture_logs() as logs:
            resp._log(stats, 0.0)
        (e,) = [e for e in logs if e["event"] == "media_request"]
        assert e["log_level"] == "info" and e["client_disconnected"] is True

    def test_truncated_always_logged_at_info(self, tmp_path, monkeypatch):
        monkeypatch.setattr(media_range, "MEDIA_LOG_SAMPLE_EVERY", 10**9)
        stats = media_range._ServeStats(range_header=None)
        stats.truncated = True
        resp = MediaFileResponse(_make_file(tmp_path, "clip.mp4", 10))
        with capture_logs() as logs:
            resp._log(stats, 0.0)
        (e,) = [e for e in logs if e["event"] == "media_request"]
        assert e["log_level"] == "info" and e["truncated"] is True
