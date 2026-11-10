"""Placeholder store: ``backend.services.media_meta`` and ``archive_urls.media_route_path``."""

from __future__ import annotations

import asyncio
import base64
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
import time_machine
from PIL import Image
from structlog.testing import capture_logs

from backend.services import archive_urls, media_meta, photo_thumb

ROOM = "messages/34 金村 美玖/58 金村 美玖"
EMOJI_ROOM = "messages/99 🌸 さくら/1 🌸 さくら"
PREFIX = "/api/content/media/hinatazaka46/"
T0 = datetime(2026, 11, 11, 3, 0, tzinfo=timezone.utc)


def _run(coro):
    return asyncio.run(coro)


def _jpeg(path: Path, size: tuple[int, int] = (64, 48)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, (10, 120, 200)).save(path, format="JPEG")
    return path


def _video(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64)
    return path


def _stat_key(path: Path) -> str:
    st = path.stat()
    return f"{st.st_size}:{st.st_mtime_ns}"


def _v(path: Path) -> str:
    st = path.stat()
    return photo_thumb.version_token(st.st_size, st.st_mtime_ns)


def _row(rel: str, stat_key: str = "1:2", **kw) -> media_meta.MetaRow:
    base: dict = dict(
        rel_path=rel,
        stat_key=stat_key,
        kind="picture",
        width=64,
        height=48,
        rgb=0xA08070,
        blur=b"RIFFblur",
        status="ready",
        reason=None,
        poster=None,
        poster_source=None,
    )
    base.update(kw)
    return media_meta.MetaRow(**base)


@pytest.fixture(autouse=True)
def _db(tmp_path):
    media_meta.set_db_path(tmp_path / "cache" / media_meta.DB_NAME)
    yield
    media_meta.set_db_path(None)


@pytest.fixture
def out(tmp_path):
    root = tmp_path / "out"
    (root / "日向坂46").mkdir(parents=True)
    with patch("backend.api.content.get_output_dir", return_value=root):
        yield root


@pytest.fixture
def hints():
    calls: list[tuple[str, list[str]]] = []
    with patch.object(
        media_meta, "_hint", lambda service, rels: calls.append((service, list(rels)))
    ):
        yield calls


def _rel(out: Path, path: Path) -> str:
    return photo_thumb.archive_rel(out, path)


# --- store ------------------------------------------------------------------------


class TestConstants:
    def test_values(self):
        assert media_meta.DB_NAME == "media_meta.db"
        assert media_meta.SCHEMA_VERSION == 1
        assert media_meta.MAX_ROWS == 300_000
        assert media_meta.PRUNE_SLACK == 0.9
        assert media_meta.META_BATCH_MAX == 500
        assert media_meta.PICTURE_SUFFIXES is photo_thumb.PICTURE_SUFFIXES
        assert media_meta.VIDEO_SUFFIXES == frozenset({".mp4", ".mov", ".m4v"})

    def test_default_db_path_is_beside_the_thumbnail_cache(self):
        media_meta.set_db_path(None)
        assert media_meta.db_path() == photo_thumb.cache_dir().parent / "media_meta.db"

    def test_kind_of(self):
        assert media_meta.kind_of(Path("a/B.JPG")) == "picture"
        assert media_meta.kind_of(Path("a/b.webp")) == "picture"
        assert media_meta.kind_of(Path("a/b.MP4")) == "video"
        assert media_meta.kind_of(Path("a/b.m4v")) == "video"
        assert media_meta.kind_of(Path("a/b.m4a")) is None
        assert media_meta.kind_of(Path("a/b")) is None


class TestStore:
    def test_round_trip_keeps_cjk_and_emoji_paths_byte_exact(self):
        rels = [f"日向坂46/{ROOM}/picture/1.jpg", f"日向坂46/{EMOJI_ROOM}/video/2.mp4"]
        with time_machine.travel(T0, tick=False):
            media_meta.put(_row(rels[0]))
            media_meta.put(
                _row(rels[1], kind="video", poster="ready", poster_source="shell")
            )
        got = media_meta.get_many(rels + ["日向坂46/none.jpg"])
        assert set(got) == set(rels)
        assert got[rels[0]].rel_path.encode() == rels[0].encode()
        assert got[rels[0]].blur == b"RIFFblur" and got[rels[0]].rgb == 0xA08070
        assert got[rels[0]].updated_at == int(T0.timestamp())
        assert got[rels[1]].poster == "ready" and got[rels[1]].poster_source == "shell"

    def test_put_replaces_and_stamps_now(self):
        with time_machine.travel(T0, tick=False):
            media_meta.put(_row("a.jpg", updated_at=5))
        with time_machine.travel(T0.replace(hour=4), tick=False):
            media_meta.put(_row("a.jpg", stat_key="9:9", status="failed", rgb=None))
        row = media_meta.get_many(["a.jpg"])["a.jpg"]
        assert row.stat_key == "9:9" and row.status == "failed" and row.rgb is None
        assert row.updated_at == int(T0.replace(hour=4).timestamp())
        assert media_meta.counts()["rows"] == 1

    def test_get_many_empty_and_chunked(self):
        assert media_meta.get_many([]) == {}
        rels = [f"r/{i}.jpg" for i in range(1200)]
        for rel in rels:
            media_meta.put(_row(rel))
        assert len(media_meta.get_many(rels)) == 1200

    def test_row_is_frozen(self):
        with pytest.raises(Exception):
            _row("a.jpg").kind = "video"  # type: ignore[misc]

    def test_set_poster_updates_a_fresh_row(self):
        media_meta.put(_row("v.mp4", kind="video", poster="none"))
        media_meta.set_poster("v.mp4", "1:2", "ready", "client")
        row = media_meta.get_many(["v.mp4"])["v.mp4"]
        assert (row.poster, row.poster_source) == ("ready", "client")
        assert row.status == "ready" and row.rgb == 0xA08070  # placeholder kept

    def test_set_poster_replaces_a_stale_row_and_inserts_a_missing_one(self):
        media_meta.put(_row("v.mp4", kind="video", poster="ready"))
        media_meta.set_poster("v.mp4", "3:4", "failed", "shell")
        media_meta.set_poster("w.mp4", "5:6", "ready", "client")
        got = media_meta.get_many(["v.mp4", "w.mp4"])
        stale = got["v.mp4"]
        assert stale.stat_key == "3:4" and stale.poster == "failed"
        assert stale.rgb is None and stale.blur is None and stale.status == "failed"
        assert stale.reason == "no_placeholder" and stale.kind == "video"
        assert got["w.mp4"].poster == "ready" and got["w.mp4"].stat_key == "5:6"

    def test_mark_pending_then_recover_marks_shell_crash_suspects(self):
        media_meta.mark_poster_pending("v.mp4", "1:2")
        row = media_meta.get_many(["v.mp4"])["v.mp4"]
        assert (row.poster, row.poster_source) == ("pending", "shell")
        media_meta.put(_row("ok.mp4", kind="video", poster="ready"))
        assert media_meta.recover_pending() == 1
        got = media_meta.get_many(["v.mp4", "ok.mp4"])
        assert got["v.mp4"].poster == "failed"
        assert got["v.mp4"].reason == "shell_crash_suspect"
        assert got["ok.mp4"].poster == "ready"
        assert media_meta.recover_pending() == 0

    def test_prune_keeps_the_newest_rows(self):
        with patch.object(media_meta, "MAX_ROWS", 10):
            for i in range(11):
                with time_machine.travel(T0.replace(minute=i), tick=False):
                    media_meta.put(_row(f"r/{i:02d}.jpg"))
            left = media_meta.get_many([f"r/{i:02d}.jpg" for i in range(11)])
        assert sorted(left) == [f"r/{i:02d}.jpg" for i in range(2, 11)]
        assert media_meta.counts()["rows"] == 9

    def test_replacing_a_row_does_not_count_twice(self):
        with patch.object(media_meta, "MAX_ROWS", 3):
            for _ in range(5):
                media_meta.put(_row("same.jpg"))
            media_meta.put(_row("b.jpg"))
            media_meta.put(_row("c.jpg"))
            assert media_meta.counts()["rows"] == 3

    def test_prune_under_the_cap_deletes_nothing(self):
        media_meta.put(_row("a.jpg"))
        assert media_meta.prune() == 0
        assert media_meta.counts()["rows"] == 1

    def test_row_count_is_measured_from_an_existing_db(self, tmp_path):
        for i in range(4):
            media_meta.put(_row(f"r/{i}.jpg"))
        media_meta.set_db_path(tmp_path / "cache" / media_meta.DB_NAME)  # forgets
        with patch.object(media_meta, "MAX_ROWS", 4):
            media_meta.put(_row("r/new.jpg"))
        assert media_meta.counts()["rows"] == 3  # 5 > 4: pruned to int(4 * 0.9)

    def test_clear_and_counts(self):
        media_meta.put(_row("a.jpg"))
        media_meta.put(_row("b.jpg", status="failed", reason="too_large"))
        media_meta.put(_row("c.mp4", kind="video", poster="ready"))
        media_meta.put(_row("d.mp4", kind="video", poster="failed"))
        media_meta.mark_poster_pending("e.mp4", "1:2")
        assert media_meta.counts() == {
            "rows": 5,
            "ready": 3,
            "failed": 2,
            "poster_ready": 1,
            "poster_failed": 1,
            "poster_pending": 1,
        }
        media_meta.clear()
        assert media_meta.counts()["rows"] == 0
        assert media_meta.get_many(["a.jpg"]) == {}

    def test_db_is_wal_with_the_schema_version(self):
        media_meta.put(_row("a.jpg"))
        with closing(sqlite3.connect(media_meta.db_path())) as conn:
            assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
            assert conn.execute("PRAGMA user_version").fetchone()[0] == 1


class TestResilience:
    def test_a_schema_mismatch_resets_the_db(self):
        path = media_meta.db_path()
        path.parent.mkdir(parents=True)
        with closing(sqlite3.connect(path)) as conn:
            conn.execute("CREATE TABLE media_meta (rel_path TEXT, junk BLOB)")
            conn.execute("INSERT INTO media_meta VALUES ('x', NULL)")
            conn.execute("PRAGMA user_version = 99")
            conn.commit()
        with capture_logs() as logs:
            media_meta.put(_row("a.jpg"))
        assert any(
            e["event"] == "media_meta_reset" and e["reason"] == "schema" for e in logs
        )
        assert set(media_meta.get_many(["a.jpg", "x"])) == {"a.jpg"}

    def test_a_new_db_is_not_reported_as_a_reset(self):
        with capture_logs() as logs:
            media_meta.put(_row("a.jpg"))
        assert not any(e["event"] == "media_meta_reset" for e in logs)

    def test_a_corrupt_file_is_recreated(self):
        path = media_meta.db_path()
        path.parent.mkdir(parents=True)
        path.write_bytes(b"this is not a sqlite database at all" * 200)
        with capture_logs() as logs:
            media_meta.put(_row("a.jpg"))
        assert any(
            e["event"] == "media_meta_reset" and e["reason"] == "corrupt" for e in logs
        )
        assert set(media_meta.get_many(["a.jpg"])) == {"a.jpg"}

    def test_a_corrupt_file_that_cannot_be_removed_is_a_logged_failure(self):
        path = media_meta.db_path()
        path.parent.mkdir(parents=True)
        path.write_bytes(b"not a database" * 400)
        with (
            patch.object(media_meta, "_remove_db", side_effect=PermissionError()),
            capture_logs() as logs,
        ):
            assert media_meta.get_many(["a.jpg"]) == {}
        assert any(
            e["event"] == "media_meta_failed" and e["error_type"] == "PermissionError"
            for e in logs
        )

    def test_a_locked_db_is_not_deleted(self):
        media_meta.put(_row("a.jpg"))
        locked = sqlite3.OperationalError("database is locked")
        with (
            patch.object(media_meta, "_open", side_effect=locked),
            capture_logs() as logs,
        ):
            assert media_meta.get_many(["a.jpg"]) == {}
        assert not any(e["event"] == "media_meta_reset" for e in logs)
        assert set(media_meta.get_many(["a.jpg"])) == {"a.jpg"}

    def test_sqlite_errors_never_raise(self):
        boom = sqlite3.OperationalError("database is locked")
        with (
            patch.object(media_meta, "_connect", side_effect=boom),
            capture_logs() as logs,
        ):
            assert media_meta.get_many(["a.jpg"]) == {}
            media_meta.put(_row("a.jpg"))
            media_meta.set_poster("a.mp4", "1:2", "ready", "shell")
            media_meta.mark_poster_pending("a.mp4", "1:2")
            assert media_meta.recover_pending() == 0
            assert media_meta.prune() == 0
            media_meta.clear()
            assert media_meta.counts()["rows"] == 0
        failed = [e for e in logs if e["event"] == "media_meta_failed"]
        assert {e["op"] for e in failed} == {
            "get_many",
            "put",
            "set_poster",
            "recover_pending",
            "prune",
            "clear",
            "counts",
        }
        assert all(e["error_type"] == "OperationalError" for e in failed)

    def test_an_unwritable_cache_dir_never_raises(self, tmp_path):
        blocker = tmp_path / "file"
        blocker.write_bytes(b"x")
        media_meta.set_db_path(blocker / "sub" / media_meta.DB_NAME)
        with capture_logs() as logs:
            assert media_meta.get_many(["a.jpg"]) == {}
        assert logs[-1]["event"] == "media_meta_failed"


# --- the media-route resolver ---------------------------------------------------------


class TestMediaRoutePath:
    def test_resolves_a_media_url_to_the_display_dir(self, tmp_path):
        out = tmp_path / "out"
        src = _jpeg(out / "日向坂46" / ROOM / "picture" / "1.jpg")
        url = archive_urls.media_url(
            "hinatazaka46", [*ROOM.split("/"), "picture", "1.jpg"]
        )
        assert archive_urls.media_route_path(out, url) == src.resolve()
        assert archive_urls.media_route_target(out, url) == (
            "hinatazaka46",
            src.resolve(),
        )
        # unencoded and upper-case service ids are accepted like the route does
        raw = f"/api/content/media/HINATAZAKA46/{ROOM}/picture/1.jpg"
        assert archive_urls.media_route_path(out, raw) == src.resolve()

    def test_a_query_or_fragment_is_ignored(self, tmp_path):
        out = tmp_path / "out"
        src = _jpeg(out / "日向坂46" / "a.jpg")
        url = PREFIX + "a.jpg?x=../../../etc/passwd#../.."
        assert archive_urls.media_route_path(out, url) == src.resolve()

    @pytest.mark.parametrize(
        "url",
        [
            PREFIX + "../../secret.jpg",
            PREFIX + "%2e%2e/%2e%2e/secret.jpg",
            PREFIX + "a/..%2F..%2F..%2Fsecret.jpg",
            "/api/content/media//etc/passwd",
            "/api/content/media/%2Fetc/passwd",
            "/etc/passwd",
            "/api/content/thumb/hinatazaka46/a.jpg",
            "/api/content/avatar/hinatazaka46/a.jpg",
            "http://evil.example/api/content/media/hinatazaka46/a.jpg",
            "//evil.example/api/content/media/hinatazaka46/a.jpg",
            "/api/content/media/unknown46/a.jpg",
            "/api/content/media/hinatazaka46",
            PREFIX + "a%00.jpg",
            PREFIX + "a%0A.jpg",
            "http://[::1/api/content/media/hinatazaka46/a.jpg",
            "",
        ],
    )
    def test_rejects(self, tmp_path, url):
        out = tmp_path / "out"
        _jpeg(out / "日向坂46" / "a.jpg")
        _jpeg(tmp_path / "secret.jpg")
        assert archive_urls.media_route_path(out, url) is None


# --- meta_for_urls --------------------------------------------------------------------


def _url(*parts: str) -> str:
    return archive_urls.media_url("hinatazaka46", parts)


class TestMetaForUrls:
    def test_a_fresh_ready_picture_is_complete_and_not_hinted(self, out, hints):
        src = _jpeg(out / "日向坂46" / ROOM / "picture" / "1.jpg")
        rel = _rel(out, src)
        media_meta.put(_row(rel, _stat_key(src), width=1440, height=1080))
        url = _url(*ROOM.split("/"), "picture", "1.jpg")
        items = _run(media_meta.meta_for_urls([url]))
        assert items == {
            url: {
                "kind": "picture",
                "v": _v(src),
                "color": "#a08070",
                "blur": "data:image/webp;base64,"
                + base64.b64encode(b"RIFFblur").decode(),
                "w": 1440,
                "h": 1080,
                "poster": False,
            }
        }
        assert hints == []

    def test_a_ready_row_without_blur_or_colour(self, out, hints):
        src = _jpeg(out / "日向坂46" / "a.jpg")
        media_meta.put(_row(_rel(out, src), _stat_key(src), rgb=None, blur=None))
        item = _run(media_meta.meta_for_urls([_url("a.jpg")]))[_url("a.jpg")]
        assert item["color"] is None and item["blur"] is None and item["w"] == 64

    def test_a_stale_row_reports_v_only_and_is_hinted(self, out, hints):
        src = _jpeg(out / "日向坂46" / EMOJI_ROOM / "picture" / "1.jpg")
        rel = _rel(out, src)
        media_meta.put(_row(rel, "1:1"))
        url = _url(*EMOJI_ROOM.split("/"), "picture", "1.jpg")
        item = _run(media_meta.meta_for_urls([url]))[url]
        assert item == {
            "kind": "picture",
            "v": _v(src),
            "color": None,
            "blur": None,
            "w": None,
            "h": None,
            "poster": False,
        }
        assert hints == [("hinatazaka46", [rel])]

    def test_a_missing_row_is_hinted_once_per_service(self, out, hints):
        a = _jpeg(out / "日向坂46" / "a.jpg")
        b = _jpeg(out / "日向坂46" / "b.jpg")
        urls = [_url("a.jpg"), _url("b.jpg"), _url("a.jpg")]
        items = _run(media_meta.meta_for_urls(urls))
        assert set(items) == {_url("a.jpg"), _url("b.jpg")}
        assert items[_url("a.jpg")]["v"] == _v(a)
        assert hints == [("hinatazaka46", [_rel(out, a), _rel(out, b)])]

    def test_a_fresh_failed_row_has_no_colour_and_no_hint(self, out, hints):
        src = _jpeg(out / "日向坂46" / "a.jpg")
        media_meta.put(
            _row(_rel(out, src), _stat_key(src), status="failed", reason="too_large")
        )
        item = _run(media_meta.meta_for_urls([_url("a.jpg")]))[_url("a.jpg")]
        assert item["color"] is None and item["blur"] is None and item["w"] is None
        assert item["v"] == _v(src)
        assert hints == []

    def test_video_poster_is_true_only_when_ready_and_fresh(self, out, hints):
        ok = _video(out / "日向坂46" / "v" / "1.mp4")
        bad = _video(out / "日向坂46" / "v" / "2.mp4")
        old = _video(out / "日向坂46" / "v" / "3.mp4")
        media_meta.put(
            _row(_rel(out, ok), _stat_key(ok), kind="video", poster="ready", width=640)
        )
        media_meta.put(
            _row(_rel(out, bad), _stat_key(bad), kind="video", poster="failed")
        )
        media_meta.put(_row(_rel(out, old), "1:1", kind="video", poster="ready"))
        urls = [_url("v", "1.mp4"), _url("v", "2.mp4"), _url("v", "3.mp4")]
        items = _run(media_meta.meta_for_urls(urls))
        assert items[urls[0]]["poster"] is True and items[urls[0]]["kind"] == "video"
        assert items[urls[0]]["color"] == "#a08070" and items[urls[0]]["w"] == 640
        assert items[urls[1]]["poster"] is False
        assert items[urls[2]]["poster"] is False and items[urls[2]]["color"] is None
        assert hints == [("hinatazaka46", [_rel(out, old)])]

    def test_invalid_and_missing_urls_are_null_and_counted(self, out, hints, tmp_path):
        good = _jpeg(out / "日向坂46" / "a.jpg")
        (out / "日向坂46" / "voice").mkdir()
        (out / "日向坂46" / "voice" / "1.m4a").write_bytes(b"x")
        (out / "日向坂46" / "dir.jpg").mkdir()
        _jpeg(tmp_path / "secret.jpg")
        urls = [
            _url("a.jpg"),
            _url("gone.jpg"),
            _url("dir.jpg"),
            _url("voice", "1.m4a"),
            PREFIX + "../../secret.jpg",
            "/api/content/media/unknown46/a.jpg",
        ]
        with capture_logs() as logs:
            items = _run(media_meta.meta_for_urls(urls))
        assert items[urls[0]]["v"] == _v(good)
        assert all(items[u] is None for u in urls[1:])
        [event] = [e for e in logs if e["event"] == "media_meta"]
        assert event == {
            "event": "media_meta",
            "log_level": "info",
            "requested": 6,
            "ready": 0,
            "stale": 0,
            "missing": 2,
            "invalid": 3,
            "hinted": 1,
        }
        text = repr(logs)
        for u in urls:
            assert u not in text
        for leak in (str(out), str(tmp_path), "secret", "gone", "日向坂46", "a.jpg"):
            assert leak not in text

    def test_a_stat_failure_counts_as_missing(self, out, hints):
        _jpeg(out / "日向坂46" / "a.jpg")
        with patch.object(
            media_meta.archive_urls,
            "archive_file_ok",
            side_effect=archive_urls.ArchiveReadError("unreadable"),
        ):
            items = _run(media_meta.meta_for_urls([_url("a.jpg")]))
        assert items == {_url("a.jpg"): None}

    def test_logs_carry_no_paths(self, out, hints):
        src = _jpeg(out / "日向坂46" / EMOJI_ROOM / "picture" / "1.jpg")
        media_meta.put(_row(_rel(out, src), _stat_key(src)))
        url = _url(*EMOJI_ROOM.split("/"), "picture", "1.jpg")
        with capture_logs() as logs:
            _run(media_meta.meta_for_urls([url, _url("x.jpg")]))
        text = repr(logs)
        for leak in (url, str(out), "🌸", "金村", "1.jpg", "x.jpg", "picture/"):
            assert leak not in text, text
        assert logs and all(
            set(e)
            <= {
                "event",
                "log_level",
                "requested",
                "ready",
                "stale",
                "missing",
                "invalid",
                "hinted",
            }
            for e in logs
        )

    def test_the_default_hint_is_a_no_op(self, out):
        _jpeg(out / "日向坂46" / "a.jpg")
        assert media_meta._hint("hinatazaka46", ["日向坂46/a.jpg"]) is None
        assert _run(media_meta.meta_for_urls([_url("a.jpg")]))[_url("a.jpg")]

    def test_the_request_never_decodes(self, out, hints):
        _jpeg(out / "日向坂46" / "a.jpg")
        with patch.object(photo_thumb.Image, "open", side_effect=AssertionError):
            _run(media_meta.meta_for_urls([_url("a.jpg")]))


def test_os_stat_mtime_is_the_stat_key(tmp_path):
    src = _jpeg(tmp_path / "a.jpg")
    os.utime(src, ns=(1, 2_000_000_000))
    assert media_meta.stat_key_of(src.stat()) == f"{src.stat().st_size}:2000000000"
