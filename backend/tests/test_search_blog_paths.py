"""Search reads blog posts only from validated blog folders (security audit 2026-11-13,
backend/services/blog_service.py:remote-blog-identifiers-as-path-segments).

The blog index is written by the blog sync, and an index left by an older
version may hold a hostile blog id or member name. Search builds
``blogs / <member> / <date>_<id> / blog.json`` from it at four places; none may
open a file outside the blogs folder or index its text. A refused entry is
skipped and counted in one ``search_blog_path_refused`` event that carries no
name, id or path.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from structlog.testing import capture_logs

from backend.services.search_service import (
    SearchService,
    _build_full_index_process_stats,
    _index_blogs_for_service_process_stats,
)

_DISPLAY = "日向坂46"
_SERVICE_ID = "hinatazaka46"
_LEAK = "LEAK_SENTINEL_TEXT"


def _write_blog(folder: Path, title: str, text: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "blog.json").write_text(
        json.dumps(
            {
                "meta": {"title": title, "url": "https://example.com/b"},
                "content": {"html": f"<p>{text}</p>"},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def _entry(blog_id: str) -> dict:
    return {
        "id": blog_id,
        "title": "t",
        "published_at": "2026-01-01T12:00:00+09:00",
        "url": "https://example.com/b",
    }


def _make_archive(tmp_path: Path, members: dict) -> Path:
    out = tmp_path / "output"
    blogs = out / _DISPLAY / "blogs"
    blogs.mkdir(parents=True)
    (blogs / "index.json").write_text(
        json.dumps({"members": members}, ensure_ascii=False), encoding="utf-8"
    )
    return out


@pytest.fixture()
def hostile_archive(tmp_path: Path) -> Path:
    """One honest blog plus a hostile id and a hostile member name, each aimed at a leak file."""
    out = _make_archive(
        tmp_path,
        {
            "100": {
                "name": "田中美久",
                "blogs": [_entry("b1"), _entry("x/../../../escape_target")],
            },
            "200": {"name": "..", "blogs": [_entry("b2")]},
        },
    )
    svc = out / _DISPLAY
    _write_blog(svc / "blogs" / "田中美久" / "20260101_b1", "honest", "本物のブログ")
    # The hostile id walks up from this folder to svc/escape_target.
    (svc / "blogs" / "田中美久" / "20260101_x").mkdir()
    _write_blog(svc / "escape_target", "leak", _LEAK)
    # The hostile name ".." resolves to svc/20260101_b2.
    _write_blog(svc / "20260101_b2", "leak", _LEAK)
    return out


@pytest.fixture()
def service(tmp_path: Path) -> SearchService:
    svc = SearchService(tmp_path / "search" / "search_index.db")
    kakasi = MagicMock()
    kakasi.convert.side_effect = lambda text: [{"orig": text, "hira": text}]
    svc._kakasi = kakasi
    return svc


def _mock_pykakasi() -> MagicMock:
    module = MagicMock()
    module.kakasi.return_value.convert.side_effect = lambda text: [
        {"orig": text, "hira": text}
    ]
    return module


def _indexed(db: Path) -> tuple[set[str], str]:
    conn = sqlite3.connect(str(db))
    try:
        rows = conn.execute("SELECT blog_id, content FROM search_blogs").fetchall()
    finally:
        conn.close()
    return {r[0] for r in rows}, " ".join(r[1] for r in rows)


def _refused(logs) -> list[dict]:
    return [e for e in logs if e["event"] == "search_blog_path_refused"]


def _assert_refused_only_counts(logs, count: int) -> None:
    events = _refused(logs)
    assert len(events) == 1
    assert set(events[0]) == {"event", "log_level", "count"}
    assert events[0]["count"] == count
    rendered = json.dumps(events, ensure_ascii=False, default=str)
    for forbidden in ("escape", "x/..", "田中美久", "blogs"):
        assert forbidden not in rendered


def _run_build_full_process(out: Path, db: Path, service: SearchService) -> None:
    # The parent logs the refused count; a thread pool stands in for the process pool.
    service._build_executor = ThreadPoolExecutor(max_workers=1)
    try:
        with (
            patch.dict("sys.modules", {"pykakasi": _mock_pykakasi()}),
            patch("backend.services.search_service.get_output_dir", return_value=out),
        ):
            asyncio.run(service.build_full_index())
    finally:
        service._build_executor.shutdown()


def _run_service_process(out: Path, db: Path, service: SearchService) -> None:
    db.parent.mkdir(parents=True, exist_ok=True)
    service._build_executor = ThreadPoolExecutor(max_workers=1)
    try:
        with (
            patch.dict("sys.modules", {"pykakasi": _mock_pykakasi()}),
            patch("backend.services.search_service.get_output_dir", return_value=out),
        ):
            asyncio.run(service.index_blogs_for_service(_SERVICE_ID))
    finally:
        service._build_executor.shutdown()


def _run_build_sync(out: Path, db: Path, service: SearchService) -> None:
    with patch("backend.services.search_service.get_output_dir", return_value=out):
        service._build_blog_index_sync()


def _run_service_sync(out: Path, db: Path, service: SearchService) -> None:
    with patch("backend.services.search_service.get_output_dir", return_value=out):
        service._index_blogs_for_service_sync(_SERVICE_ID)


_RUNNERS = {
    "build_full_process": _run_build_full_process,
    "service_process": _run_service_process,
    "build_sync": _run_build_sync,
    "service_sync": _run_service_sync,
}


@pytest.mark.parametrize("runner", sorted(_RUNNERS))
def test_hostile_index_entries_are_skipped_and_never_read(
    runner, hostile_archive, tmp_path, service
):
    db = tmp_path / "search" / "search_index.db"
    with capture_logs() as logs:
        _RUNNERS[runner](hostile_archive, db, service)

    ids, content = _indexed(db)
    assert ids == {"b1"}
    assert _LEAK not in content
    _assert_refused_only_counts(logs, 2)


@pytest.mark.parametrize("runner", sorted(_RUNNERS))
@pytest.mark.parametrize(
    "name", ["長濱 ねる", "ゆっかー・みくにん", "ポカ：ねる", " 金村 美玖 "]
)
def test_real_member_name_forms_are_still_indexed(runner, name, tmp_path, service):
    out = _make_archive(tmp_path, {"100": {"name": name, "blogs": [_entry("b1")]}})
    _write_blog(
        out / _DISPLAY / "blogs" / name.strip() / "20260101_b1", "t", "本文です"
    )
    db = tmp_path / "search" / "search_index.db"
    with capture_logs() as logs:
        _RUNNERS[runner](out, db, service)

    ids, content = _indexed(db)
    assert ids == {"b1"}
    assert "本文です" in content
    assert not _refused(logs)


def test_the_workers_return_the_refused_count_and_log_nothing(
    hostile_archive, tmp_path
):
    """A spawned worker has no structlog setup, so it hands the count to the parent."""
    db = tmp_path / "search" / "search_index.db"
    db.parent.mkdir(parents=True)
    with (
        capture_logs() as logs,
        patch.dict("sys.modules", {"pykakasi": _mock_pykakasi()}),
    ):
        _, full_refused = _build_full_index_process_stats(str(db), str(hostile_archive))
        _, service_refused = _index_blogs_for_service_process_stats(
            str(db), str(hostile_archive), _SERVICE_ID
        )
    assert (full_refused, service_refused) == (2, 2)
    assert not _refused(logs)
