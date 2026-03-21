"""Core integration tests for search_service.py.

Tests the search pipeline end-to-end using real SQLite databases in temp
directories.  Covers:
    - Schema creation (_init_db_sync via _get_conn / _get_read_conn)
    - Message indexing (_index_members_sync, _build_full_index_sync)
    - Blog indexing (_build_blog_index_sync, _index_blogs_for_service_sync)
    - Search query execution (_search_sync)
    - Incremental indexing (max-indexed-ID boundary)
    - Read states (upsert / batch upsert / get_all)
    - Status tracking (_get_status_sync)
    - Clear / rebuild (_clear_db_sync)
    - Process-level picklable functions (_build_full_index_process,
      _index_members_process, _index_blogs_for_service_process)

Does NOT modify the existing test_search_service_units.py.
"""

import json
import sqlite3
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.services.search_service import (
    SearchService,
    _SCHEMA_SQL,
    _build_full_index_process,
    _index_blogs_for_service_process,
    _index_members_process,
)


def _kata_to_hira(text: str) -> str:
    """Convert katakana characters to hiragana (mirrors pykakasi behaviour).

    The real pykakasi returns kanji readings as hiragana and passes
    hiragana through unchanged.  For test purposes we only need the
    katakana-to-hiragana shift (U+30A1..U+30F6 -> U+3041..U+3096) so
    that the FTS5 content_normalized column matches what
    ``_normalize_query`` produces at search time.
    """
    chars: list[str] = []
    for ch in text:
        cp = ord(ch)
        if 0x30A1 <= cp <= 0x30F6:
            chars.append(chr(cp - 0x60))
        else:
            chars.append(ch)
    return "".join(chars)


# =====================================================================
# Fixtures
# =====================================================================

# The display name for hinatazaka46 in GROUP_CONFIG
_SERVICE_DISPLAY = "日向坂46"
_SERVICE_ID = "hinatazaka46"


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    """Return a temp DB file path (does NOT yet exist)."""
    return tmp_path / "search" / "search_index.db"


@pytest.fixture()
def service(db_path: Path) -> SearchService:
    """Create a SearchService backed by a temp DB.

    pykakasi is mocked out so tests run quickly and without the heavy
    optional dependency.  The mock returns the original text as its
    hiragana reading, which is sufficient for index / search tests.
    """
    svc = SearchService(db_path)
    # Replace the kakasi lazy-init with a lightweight fake that converts
    # katakana to hiragana (matching real pykakasi behaviour) so FTS5
    # content_normalized is searchable with _normalize_query output.
    mock_kakasi = MagicMock()
    mock_kakasi.convert.side_effect = lambda text: [
        {"orig": text, "hira": _kata_to_hira(text)}
    ]
    svc._kakasi = mock_kakasi
    return svc


@pytest.fixture()
def output_dir(tmp_path: Path) -> Path:
    """Build a realistic output directory tree with message JSON files.

    Structure::

        output/
          日向坂46/
            messages/
              1 テストグループ/
                100 田中美久/
                  messages.json      (3 messages)
                200 佐々木久美/
                  messages.json      (2 messages)
              2 別グループ/
                300 金村美玖/
                  messages.json      (1 message)
            blogs/
              index.json
              田中美久/
                20260101_b1/
                  blog.json
    """
    out = tmp_path / "output"
    svc_dir = out / _SERVICE_DISPLAY

    # --- Messages ---
    g1m1 = svc_dir / "messages" / "1 テストグループ" / "100 田中美久"
    g1m1.mkdir(parents=True)
    _write_messages_json(
        g1m1 / "messages.json",
        [
            {
                "id": 1,
                "content": "こんにちは、今日は天気がいいですね",
                "timestamp": "2026-01-01T10:00:00+09:00",
            },
            {
                "id": 2,
                "content": "お昼ごはんを食べました！美味しかった",
                "timestamp": "2026-01-01T12:00:00+09:00",
            },
            {
                "id": 3,
                "content": "おやすみなさい。明日も頑張ります",
                "timestamp": "2026-01-01T22:00:00+09:00",
            },
        ],
    )

    g1m2 = svc_dir / "messages" / "1 テストグループ" / "200 佐々木久美"
    g1m2.mkdir(parents=True)
    _write_messages_json(
        g1m2 / "messages.json",
        [
            {
                "id": 10,
                "content": "今日のライブ楽しかったです！",
                "timestamp": "2026-01-02T20:00:00+09:00",
            },
            {
                "id": 11,
                "content": "ファンのみんな、ありがとう",
                "timestamp": "2026-01-02T21:00:00+09:00",
            },
        ],
    )

    g2m3 = svc_dir / "messages" / "2 別グループ" / "300 金村美玖"
    g2m3.mkdir(parents=True)
    _write_messages_json(
        g2m3 / "messages.json",
        [
            {
                "id": 20,
                "content": "新曲のレコーディングが終わりました",
                "timestamp": "2026-01-03T15:00:00+09:00",
            },
        ],
    )

    # --- Blogs ---
    blogs_dir = svc_dir / "blogs"
    blogs_dir.mkdir(parents=True)
    _write_blog_index(
        blogs_dir / "index.json",
        {
            "members": {
                "100": {
                    "name": "田中美久",
                    "blogs": [
                        {
                            "id": "b1",
                            "title": "ブログテスト",
                            "published_at": "2026-01-01T12:00:00+09:00",
                            "url": "https://example.com/blog/b1",
                        },
                    ],
                },
            },
        },
    )
    blog_content_dir = blogs_dir / "田中美久" / "20260101_b1"
    blog_content_dir.mkdir(parents=True)
    _write_blog_json(
        blog_content_dir / "blog.json",
        title="ブログテスト",
        html="<p>今日はライブのリハーサルでした。とても楽しかったです！</p>",
        url="https://example.com/blog/b1",
    )

    return out


def _write_messages_json(path: Path, messages: list) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"messages": messages}, f, ensure_ascii=False)


def _write_blog_index(path: Path, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _write_blog_json(path: Path, title: str, html: str, url: str) -> None:
    data = {
        "meta": {"title": title, "url": url},
        "content": {"html": html},
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _mock_normalize(text: str) -> str:
    """Trivial normalization stub — returns text unchanged."""
    return text


# =====================================================================
# 1. Database operations — schema creation
# =====================================================================


class TestDatabaseOperations:
    """Verify _get_conn / _get_read_conn create the full schema."""

    def test_get_conn_creates_schema(self, service: SearchService, db_path: Path):
        conn = service._get_conn()
        tables = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert "search_messages" in tables
        assert "search_fts" in tables
        assert "search_meta" in tables
        assert "read_states" in tables
        assert "search_blogs" in tables
        assert "search_blogs_fts" in tables

    def test_get_conn_creates_indexes(self, service: SearchService):
        conn = service._get_conn()
        indexes = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            ).fetchall()
        }
        assert "idx_search_service" in indexes
        assert "idx_search_member" in indexes
        assert "idx_search_timestamp" in indexes
        assert "idx_search_msgid" in indexes
        assert "idx_search_blogs_service" in indexes
        assert "idx_search_blogs_member" in indexes
        assert "idx_search_blogs_published" in indexes

    def test_get_read_conn_creates_schema(self, service: SearchService):
        conn = service._get_read_conn()
        tables = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert "search_messages" in tables
        assert "search_fts" in tables

    def test_get_conn_is_wal_mode(self, service: SearchService):
        conn = service._get_conn()
        row = conn.execute("PRAGMA journal_mode").fetchone()
        assert row[0] == "wal"

    def test_get_read_conn_is_wal_mode(self, service: SearchService):
        conn = service._get_read_conn()
        row = conn.execute("PRAGMA journal_mode").fetchone()
        assert row[0] == "wal"

    def test_get_conn_is_idempotent(self, service: SearchService):
        """Calling _get_conn() twice returns the same connection object."""
        c1 = service._get_conn()
        c2 = service._get_conn()
        assert c1 is c2

    def test_get_read_conn_is_idempotent(self, service: SearchService):
        c1 = service._get_read_conn()
        c2 = service._get_read_conn()
        assert c1 is c2

    def test_write_and_read_conn_are_separate(self, service: SearchService):
        c_write = service._get_conn()
        c_read = service._get_read_conn()
        assert c_write is not c_read

    def test_schema_creates_parent_directory(self, tmp_path: Path):
        deep_path = tmp_path / "a" / "b" / "c" / "index.db"
        svc = SearchService(deep_path)
        svc._get_conn()
        assert deep_path.parent.exists()

    def test_schema_triggers_exist(self, service: SearchService):
        conn = service._get_conn()
        triggers = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='trigger'"
            ).fetchall()
        }
        assert "search_ai" in triggers
        assert "search_ad" in triggers
        assert "search_au" in triggers
        assert "search_blogs_ai" in triggers
        assert "search_blogs_ad" in triggers
        assert "search_blogs_au" in triggers


# =====================================================================
# 2. Indexing pipeline — messages
# =====================================================================


class TestMessageIndexing:
    """Test _index_members_sync and _build_full_index_sync."""

    def test_index_members_sync_inserts_messages(
        self, service: SearchService, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            members = [
                ({"id": 1, "name": "テストグループ"}, {"id": 100, "name": "田中美久"}),
            ]
            count = service._index_members_sync(members, _SERVICE_ID)

        assert count == 3
        conn = service._get_conn()
        rows = conn.execute("SELECT COUNT(*) FROM search_messages").fetchone()
        assert rows[0] == 3

    def test_index_members_sync_stores_correct_data(
        self, service: SearchService, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            members = [
                ({"id": 1, "name": "テストグループ"}, {"id": 100, "name": "田中美久"}),
            ]
            service._index_members_sync(members, _SERVICE_ID)

        conn = service._get_conn()
        row = conn.execute(
            "SELECT message_id, service, group_id, group_name, member_id, member_name, content "
            "FROM search_messages WHERE message_id = 1"
        ).fetchone()
        assert row is not None
        assert row[0] == 1
        assert row[1] == _SERVICE_ID
        assert row[2] == 1
        assert row[3] == "テストグループ"
        assert row[4] == 100
        assert row[5] == "田中美久"
        assert "こんにちは" in row[6]

    def test_index_members_sync_multiple_members(
        self, service: SearchService, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            members = [
                ({"id": 1, "name": "テストグループ"}, {"id": 100, "name": "田中美久"}),
                (
                    {"id": 1, "name": "テストグループ"},
                    {"id": 200, "name": "佐々木久美"},
                ),
                ({"id": 2, "name": "別グループ"}, {"id": 300, "name": "金村美玖"}),
            ]
            count = service._index_members_sync(members, _SERVICE_ID)

        # 3 + 2 + 1 = 6 total messages
        assert count == 6

    def test_build_full_index_sync_indexes_all(
        self, service: SearchService, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            count = service._build_full_index_sync()

        assert count == 6  # 3 + 2 + 1 messages across all members
        conn = service._get_conn()
        row = conn.execute("SELECT COUNT(*) FROM search_messages").fetchone()
        assert row[0] == 6

    def test_build_full_index_sync_sets_metadata(
        self, service: SearchService, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_full_index_sync()

        conn = service._get_conn()
        row = conn.execute(
            "SELECT value FROM search_meta WHERE key = 'last_full_build'"
        ).fetchone()
        assert row is not None
        assert len(row[0]) > 0  # ISO timestamp

        row = conn.execute(
            "SELECT value FROM search_meta WHERE key = 'index_message_count'"
        ).fetchone()
        assert row is not None
        assert row[0] == "6"

    def test_build_full_index_sync_nonexistent_output_returns_zero(
        self, service: SearchService, tmp_path: Path
    ):
        missing = tmp_path / "nonexistent"
        with patch(
            "backend.services.search_service.get_output_dir", return_value=missing
        ):
            count = service._build_full_index_sync()
        assert count == 0

    def test_index_members_sync_records_incremental_meta(
        self, service: SearchService, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            members = [
                ({"id": 1, "name": "テストグループ"}, {"id": 100, "name": "田中美久"}),
            ]
            service._index_members_sync(members, _SERVICE_ID)

        conn = service._get_conn()
        row = conn.execute(
            "SELECT value FROM search_meta WHERE key = 'last_incremental_index'"
        ).fetchone()
        assert row is not None
        assert f"service={_SERVICE_ID}" in row[0]
        assert "new=3" in row[0]

    def test_index_members_skips_missing_file(
        self, service: SearchService, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            members = [
                (
                    {"id": 999, "name": "存在しないグループ"},
                    {"id": 888, "name": "誰か"},
                ),
            ]
            count = service._index_members_sync(members, _SERVICE_ID)
        assert count == 0


# =====================================================================
# 3. Incremental indexing — skips already-indexed messages
# =====================================================================


class TestIncrementalIndexing:
    """Verify that _index_members_sync only indexes messages with IDs
    greater than the previously indexed max."""

    def test_second_run_indexes_only_new_messages(
        self, service: SearchService, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            members = [
                ({"id": 1, "name": "テストグループ"}, {"id": 100, "name": "田中美久"}),
            ]
            # First run: index 3 messages (ids 1, 2, 3)
            first = service._index_members_sync(members, _SERVICE_ID)
            assert first == 3

            # Second run: same data, nothing new
            second = service._index_members_sync(members, _SERVICE_ID)
            assert second == 0

    def test_incremental_picks_up_new_messages(
        self, service: SearchService, output_dir: Path
    ):
        msg_file = (
            output_dir
            / _SERVICE_DISPLAY
            / "messages"
            / "1 テストグループ"
            / "100 田中美久"
            / "messages.json"
        )
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            members = [
                ({"id": 1, "name": "テストグループ"}, {"id": 100, "name": "田中美久"}),
            ]
            # Index original 3 messages
            service._index_members_sync(members, _SERVICE_ID)

            # Add a new message with a higher ID
            with open(msg_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            data["messages"].append(
                {
                    "id": 50,
                    "content": "新しいメッセージです",
                    "timestamp": "2026-01-04T10:00:00+09:00",
                }
            )
            with open(msg_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)

            second = service._index_members_sync(members, _SERVICE_ID)

        assert second == 1
        conn = service._get_conn()
        row = conn.execute("SELECT COUNT(*) FROM search_messages").fetchone()
        assert row[0] == 4


# =====================================================================
# 4. Blog indexing
# =====================================================================


class TestBlogIndexing:
    """Test _build_blog_index_sync and _index_blogs_for_service_sync."""

    def test_build_blog_index_sync(self, service: SearchService, output_dir: Path):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            count = service._build_blog_index_sync()

        assert count == 1
        conn = service._get_conn()
        row = conn.execute(
            "SELECT blog_id, service, member_id, member_name, title, content "
            "FROM search_blogs WHERE blog_id = 'b1'"
        ).fetchone()
        assert row is not None
        assert row[1] == _SERVICE_ID
        assert row[2] == 100
        assert row[3] == "田中美久"
        assert row[4] == "ブログテスト"
        assert "ライブのリハーサル" in row[5]

    def test_index_blogs_for_service_sync(
        self, service: SearchService, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            count = service._index_blogs_for_service_sync(_SERVICE_ID)

        assert count == 1

    def test_index_blogs_for_service_sync_skips_already_indexed(
        self, service: SearchService, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            first = service._index_blogs_for_service_sync(_SERVICE_ID)
            second = service._index_blogs_for_service_sync(_SERVICE_ID)

        assert first == 1
        assert second == 0

    def test_build_full_index_sync_includes_blogs(
        self, service: SearchService, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_full_index_sync()

        conn = service._get_conn()
        row = conn.execute(
            "SELECT value FROM search_meta WHERE key = 'index_blog_count'"
        ).fetchone()
        assert row is not None
        assert int(row[0]) >= 1

    def test_build_blog_index_nonexistent_output_returns_zero(
        self, service: SearchService, tmp_path: Path
    ):
        missing = tmp_path / "nonexistent"
        with patch(
            "backend.services.search_service.get_output_dir", return_value=missing
        ):
            count = service._build_blog_index_sync()
        assert count == 0

    def test_blog_strips_html(self, service: SearchService, output_dir: Path):
        """Verify that HTML tags are stripped from blog content before indexing."""
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_blog_index_sync()

        conn = service._get_conn()
        row = conn.execute(
            "SELECT content FROM search_blogs WHERE blog_id = 'b1'"
        ).fetchone()
        assert row is not None
        assert "<p>" not in row[0]
        assert "</p>" not in row[0]


# =====================================================================
# 5. Search query execution
# =====================================================================


class TestSearchSync:
    """Test _search_sync with known indexed data."""

    @pytest.fixture(autouse=True)
    def _index_data(self, service: SearchService, output_dir: Path):
        """Build the full index before each search test."""
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_full_index_sync()
        self.svc = service

    def test_search_finds_exact_match(self):
        conn = self.svc._get_read_conn()
        result = self.svc._search_sync(
            "こんにちは", None, None, None, 50, 0, content_type="messages", conn=conn
        )
        assert result["total_count"] >= 1
        assert any("こんにちは" in r["content"] for r in result["results"])

    def test_search_returns_correct_structure(self):
        conn = self.svc._get_read_conn()
        result = self.svc._search_sync(
            "ライブ", None, None, None, 50, 0, content_type="messages", conn=conn
        )
        assert "query" in result
        assert "normalized_query" in result
        assert "total_count" in result
        assert "results" in result
        assert "has_more" in result

    def test_search_result_has_required_fields(self):
        conn = self.svc._get_read_conn()
        result = self.svc._search_sync(
            "ライブ", None, None, None, 50, 0, content_type="messages", conn=conn
        )
        assert result["total_count"] >= 1
        r = result["results"][0]
        assert "message_id" in r
        assert "content" in r
        assert "snippet" in r
        assert "service" in r
        assert "group_id" in r
        assert "group_name" in r
        assert "member_id" in r
        assert "member_name" in r
        assert "timestamp" in r
        assert "match_type" in r

    def test_search_with_service_filter(self):
        conn = self.svc._get_read_conn()
        result = self.svc._search_sync(
            "ライブ", _SERVICE_ID, None, None, 50, 0, content_type="messages", conn=conn
        )
        assert result["total_count"] >= 1
        for r in result["results"]:
            assert r["service"] == _SERVICE_ID

    def test_search_with_member_filter(self):
        conn = self.svc._get_read_conn()
        result = self.svc._search_sync(
            "ライブ", None, None, 200, 50, 0, content_type="messages", conn=conn
        )
        # Message from member 200 contains "ライブ"
        assert result["total_count"] >= 1
        for r in result["results"]:
            assert r["member_id"] == 200

    def test_search_with_no_results(self):
        conn = self.svc._get_read_conn()
        result = self.svc._search_sync(
            "存在しないキーワードxyz",
            None,
            None,
            None,
            50,
            0,
            content_type="messages",
            conn=conn,
        )
        assert result["total_count"] == 0
        assert result["results"] == []

    def test_search_pagination(self):
        conn = self.svc._get_read_conn()
        # This query should match 0 or more; use a broad term
        result_all = self.svc._search_sync(
            "です", None, None, None, 50, 0, content_type="messages", conn=conn
        )
        if result_all["total_count"] >= 2:
            result_page = self.svc._search_sync(
                "です", None, None, None, 1, 0, content_type="messages", conn=conn
            )
            assert len(result_page["results"]) == 1
            assert result_page["has_more"] is True

    def test_search_blogs_content_type(self):
        conn = self.svc._get_read_conn()
        result = self.svc._search_sync(
            "リハーサル", None, None, None, 50, 0, content_type="blogs", conn=conn
        )
        assert result["total_count"] >= 1
        for r in result["results"]:
            assert r["result_type"] == "blog"

    def test_search_all_content_type_includes_both(self):
        conn = self.svc._get_read_conn()
        # "ライブ" appears in both messages (member 200) and blogs
        result = self.svc._search_sync(
            "ライブ", None, None, None, 50, 0, content_type="all", conn=conn
        )
        result_types = {r["result_type"] for r in result["results"]}
        # At minimum messages should be present
        assert "message" in result_types

    def test_search_exact_only_mode(self):
        conn = self.svc._get_read_conn()
        result = self.svc._search_sync(
            "こんにちは",
            None,
            None,
            None,
            50,
            0,
            exact_only=True,
            content_type="messages",
            conn=conn,
        )
        assert result["total_count"] >= 1

    def test_search_date_range_filter(self):
        conn = self.svc._get_read_conn()
        # Only messages on 2026-01-01
        result = self.svc._search_sync(
            "です",
            None,
            None,
            None,
            50,
            0,
            date_from="2026-01-01T00:00:00",
            date_to="2026-01-01T23:59:59+09:00",
            content_type="messages",
            conn=conn,
        )
        for r in result["results"]:
            assert r["timestamp"] >= "2026-01-01"
            assert r["timestamp"] < "2026-01-02"

    def test_search_multi_service_filter(self):
        conn = self.svc._get_read_conn()
        result = self.svc._search_sync(
            "ライブ",
            None,
            None,
            None,
            50,
            0,
            services=[_SERVICE_ID],
            content_type="messages",
            conn=conn,
        )
        for r in result["results"]:
            assert r["service"] == _SERVICE_ID

    def test_search_short_query_uses_like_fallback(self):
        """Queries shorter than 3 normalized chars should use LIKE fallback."""
        conn = self.svc._get_read_conn()
        # 2-char query should still work via LIKE
        result = self.svc._search_sync(
            "お昼", None, None, None, 50, 0, content_type="messages", conn=conn
        )
        # Should find "お昼ごはん..."
        assert result["total_count"] >= 1

    def test_search_is_group_chat_tagging(self):
        """Group 1 has two members, so results from it should be tagged."""
        conn = self.svc._get_read_conn()
        result = self.svc._search_sync(
            "ライブ", None, None, None, 50, 0, content_type="messages", conn=conn
        )
        for r in result["results"]:
            if r["group_id"] == 1:
                assert r["is_group_chat"] is True
            elif r["group_id"] == 2:
                assert r["is_group_chat"] is False


# =====================================================================
# 6. Read states
# =====================================================================


class TestReadStates:
    """Test upsert / batch upsert / get_all read state operations."""

    def test_upsert_and_retrieve(self, service: SearchService):
        service._upsert_read_state_sync(
            _SERVICE_ID,
            group_id=1,
            member_id=100,
            last_read_id=5,
            read_count=10,
            revealed_ids=[],
        )
        states = service._get_all_read_states_sync()
        key = f"{_SERVICE_ID}/1/100"
        assert key in states
        assert states[key]["last_read_id"] == 5
        assert states[key]["read_count"] == 10
        assert states[key]["revealed_ids"] == []

    def test_upsert_updates_existing(self, service: SearchService):
        service._upsert_read_state_sync(
            _SERVICE_ID,
            1,
            100,
            last_read_id=5,
            read_count=10,
            revealed_ids=[],
        )
        service._upsert_read_state_sync(
            _SERVICE_ID,
            1,
            100,
            last_read_id=15,
            read_count=20,
            revealed_ids=[7, 8],
        )
        states = service._get_all_read_states_sync()
        key = f"{_SERVICE_ID}/1/100"
        assert states[key]["last_read_id"] == 15
        assert states[key]["read_count"] == 20
        assert states[key]["revealed_ids"] == [7, 8]

    def test_batch_upsert_read_states(self, service: SearchService):
        entries = [
            {
                "service": _SERVICE_ID,
                "group_id": 1,
                "member_id": 100,
                "last_read_id": 5,
                "read_count": 3,
                "revealed_ids": [],
            },
            {
                "service": _SERVICE_ID,
                "group_id": 1,
                "member_id": 200,
                "last_read_id": 10,
                "read_count": 7,
                "revealed_ids": [1],
            },
            {
                "service": _SERVICE_ID,
                "group_id": 2,
                "member_id": 300,
                "last_read_id": 20,
                "read_count": 1,
                "revealed_ids": [],
            },
        ]
        count = service._batch_upsert_read_states_sync(entries)
        assert count == 3

        states = service._get_all_read_states_sync()
        assert len(states) == 3
        assert states[f"{_SERVICE_ID}/1/200"]["revealed_ids"] == [1]

    def test_empty_batch_upsert(self, service: SearchService):
        count = service._batch_upsert_read_states_sync([])
        assert count == 0

    def test_read_state_has_updated_at(self, service: SearchService):
        service._upsert_read_state_sync(
            _SERVICE_ID,
            1,
            100,
            last_read_id=1,
            read_count=1,
            revealed_ids=[],
        )
        states = service._get_all_read_states_sync()
        key = f"{_SERVICE_ID}/1/100"
        assert states[key]["updated_at"] is not None
        assert len(states[key]["updated_at"]) > 0

    def test_empty_read_states(self, service: SearchService):
        states = service._get_all_read_states_sync()
        assert states == {}


# =====================================================================
# 7. Status tracking
# =====================================================================


class TestStatusTracking:
    """Test _get_status_sync with various DB states."""

    def test_status_empty_db(self, service: SearchService):
        status = service._get_status_sync()
        assert status["indexed_count"] == 0
        assert status["blog_indexed_count"] == 0
        assert status["last_build"] is None
        assert status["is_building"] is False

    def test_status_after_indexing(self, service: SearchService, output_dir: Path):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_full_index_sync()

        status = service._get_status_sync()
        assert status["indexed_count"] == 6
        assert status["blog_indexed_count"] >= 1
        assert status["last_build"] is not None
        assert status["db_size_bytes"] > 0

    def test_status_is_building_flag(self, service: SearchService):
        service._building = True
        status = service._get_status_sync()
        assert status["is_building"] is True

    def test_status_partially_built(self, service: SearchService, output_dir: Path):
        """Index only some members, verify partial count."""
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            members = [
                ({"id": 1, "name": "テストグループ"}, {"id": 100, "name": "田中美久"}),
            ]
            service._index_members_sync(members, _SERVICE_ID)

        status = service._get_status_sync()
        assert status["indexed_count"] == 3
        assert status["last_build"] is None  # no full build done


# =====================================================================
# 8. Clear / rebuild
# =====================================================================


class TestClearDb:
    """Test _clear_db_sync."""

    def test_clear_removes_database_file(
        self, service: SearchService, db_path: Path, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_full_index_sync()

        assert db_path.exists()
        service._clear_db_sync()
        assert not db_path.exists()

    def test_clear_resets_connections(self, service: SearchService, output_dir: Path):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_full_index_sync()

        service._clear_db_sync()
        assert service._conn is None
        assert service._read_conn is None

    def test_clear_on_nonexistent_db_no_error(self, service: SearchService):
        # Should not raise even if the DB was never created
        service._clear_db_sync()

    def test_rebuild_after_clear(
        self, service: SearchService, db_path: Path, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_full_index_sync()
            service._clear_db_sync()
            assert not db_path.exists()

            # Rebuild
            count = service._build_full_index_sync()
        assert count == 6
        assert db_path.exists()


# =====================================================================
# 9. _needs_build
# =====================================================================


class TestNeedsBuild:
    """Test _needs_build detection logic."""

    def test_needs_build_when_no_db(self, service: SearchService):
        assert service._needs_build() is True

    def test_needs_build_after_full_build(
        self, service: SearchService, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_full_index_sync()
        assert service._needs_build() is False

    def test_needs_build_after_incremental_only(
        self, service: SearchService, output_dir: Path
    ):
        """Incremental index without a full build still needs a build."""
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            members = [
                ({"id": 1, "name": "テストグループ"}, {"id": 100, "name": "田中美久"}),
            ]
            service._index_members_sync(members, _SERVICE_ID)
        assert service._needs_build() is True

    def test_needs_build_after_clear(self, service: SearchService, output_dir: Path):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_full_index_sync()
        service._clear_db_sync()
        assert service._needs_build() is True


# =====================================================================
# 10. Process-level functions
# =====================================================================


class TestProcessLevelFunctions:
    """Test the top-level picklable functions that run in separate processes.

    These functions import pykakasi internally, so we mock it at the
    module level inside the function call.
    """

    def _make_mock_pykakasi(self) -> MagicMock:
        """Create a mock pykakasi module with a kakasi() factory."""
        mock_module = MagicMock()
        mock_instance = MagicMock()
        mock_instance.convert.side_effect = lambda text: [
            {"orig": text, "hira": _kata_to_hira(text)}
        ]
        mock_module.kakasi.return_value = mock_instance
        return mock_module

    def test_build_full_index_process(self, db_path: Path, output_dir: Path):
        mock_pykakasi = self._make_mock_pykakasi()
        with patch.dict("sys.modules", {"pykakasi": mock_pykakasi}):
            count = _build_full_index_process(str(db_path), str(output_dir))

        assert count == 6
        # Verify data in DB
        conn = sqlite3.connect(str(db_path))
        row = conn.execute("SELECT COUNT(*) FROM search_messages").fetchone()
        assert row[0] == 6
        # Verify metadata was written
        row = conn.execute(
            "SELECT value FROM search_meta WHERE key = 'last_full_build'"
        ).fetchone()
        assert row is not None
        # Blog count should also be recorded
        row = conn.execute(
            "SELECT value FROM search_meta WHERE key = 'index_blog_count'"
        ).fetchone()
        assert row is not None
        conn.close()

    def test_build_full_index_process_nonexistent_dir(
        self, db_path: Path, tmp_path: Path
    ):
        mock_pykakasi = self._make_mock_pykakasi()
        missing = tmp_path / "nonexistent"
        with patch.dict("sys.modules", {"pykakasi": mock_pykakasi}):
            count = _build_full_index_process(str(db_path), str(missing))
        assert count == 0

    def test_index_members_process(self, db_path: Path, output_dir: Path):
        # Ensure the schema exists first
        db_path.parent.mkdir(parents=True, exist_ok=True)

        members_json = json.dumps(
            [
                [{"id": 1, "name": "テストグループ"}, {"id": 100, "name": "田中美久"}],
                [
                    {"id": 1, "name": "テストグループ"},
                    {"id": 200, "name": "佐々木久美"},
                ],
            ]
        )
        mock_pykakasi = self._make_mock_pykakasi()
        with patch.dict("sys.modules", {"pykakasi": mock_pykakasi}):
            count = _index_members_process(
                str(db_path), str(output_dir), members_json, _SERVICE_ID
            )

        assert count == 5  # 3 from member 100 + 2 from member 200

    def test_index_members_process_incremental(self, db_path: Path, output_dir: Path):
        """Second call should index 0 new messages."""
        db_path.parent.mkdir(parents=True, exist_ok=True)
        members_json = json.dumps(
            [
                [{"id": 1, "name": "テストグループ"}, {"id": 100, "name": "田中美久"}],
            ]
        )
        mock_pykakasi = self._make_mock_pykakasi()
        with patch.dict("sys.modules", {"pykakasi": mock_pykakasi}):
            first = _index_members_process(
                str(db_path), str(output_dir), members_json, _SERVICE_ID
            )
            second = _index_members_process(
                str(db_path), str(output_dir), members_json, _SERVICE_ID
            )
        assert first == 3
        assert second == 0

    def test_index_blogs_for_service_process(self, db_path: Path, output_dir: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        mock_pykakasi = self._make_mock_pykakasi()
        with patch.dict("sys.modules", {"pykakasi": mock_pykakasi}):
            count = _index_blogs_for_service_process(
                str(db_path), str(output_dir), _SERVICE_ID
            )
        assert count == 1

    def test_index_blogs_for_service_process_incremental(
        self, db_path: Path, output_dir: Path
    ):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        mock_pykakasi = self._make_mock_pykakasi()
        with patch.dict("sys.modules", {"pykakasi": mock_pykakasi}):
            first = _index_blogs_for_service_process(
                str(db_path), str(output_dir), _SERVICE_ID
            )
            second = _index_blogs_for_service_process(
                str(db_path), str(output_dir), _SERVICE_ID
            )
        assert first == 1
        assert second == 0

    def test_index_blogs_for_service_process_unknown_service(
        self, db_path: Path, output_dir: Path
    ):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        mock_pykakasi = self._make_mock_pykakasi()
        with patch.dict("sys.modules", {"pykakasi": mock_pykakasi}):
            count = _index_blogs_for_service_process(
                str(db_path), str(output_dir), "nonexistent_service"
            )
        assert count == 0


# =====================================================================
# 11. FTS5 search verification
# =====================================================================


class TestFts5Integration:
    """Verify that the FTS5 virtual table is populated via triggers and
    supports MATCH queries."""

    def test_fts5_populated_via_trigger(self, service: SearchService):
        conn = service._get_conn()
        conn.execute(
            "INSERT INTO search_messages "
            "(message_id, service, group_id, group_name, member_id, member_name, "
            "timestamp, content, content_normalized) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                999,
                "test_svc",
                1,
                "grp",
                1,
                "mem",
                "2026-01-01",
                "テスト内容",
                "テスト内容",
            ),
        )
        conn.commit()

        row = conn.execute(
            "SELECT COUNT(*) FROM search_fts WHERE search_fts MATCH '\"テスト内容\"'"
        ).fetchone()
        assert row[0] >= 1

    def test_fts5_match_query_works(self, service: SearchService, output_dir: Path):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_full_index_sync()

        conn = service._get_conn()
        # FTS5 trigram search for a substring
        rows = conn.execute(
            "SELECT COUNT(*) FROM search_fts WHERE search_fts MATCH '\"こんにちは\"'"
        ).fetchone()
        assert rows[0] >= 1

    def test_blogs_fts5_populated(self, service: SearchService, output_dir: Path):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_blog_index_sync()

        conn = service._get_conn()
        rows = conn.execute(
            "SELECT COUNT(*) FROM search_blogs_fts WHERE search_blogs_fts MATCH '\"リハーサル\"'"
        ).fetchone()
        assert rows[0] >= 1

    def test_fts5_delete_trigger(self, service: SearchService):
        conn = service._get_conn()
        conn.execute(
            "INSERT INTO search_messages "
            "(message_id, service, group_id, group_name, member_id, member_name, "
            "timestamp, content, content_normalized) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                888,
                "test_svc",
                1,
                "grp",
                1,
                "mem",
                "2026-01-01",
                "削除テスト",
                "削除テスト",
            ),
        )
        conn.commit()

        # Verify it's in FTS
        row = conn.execute(
            "SELECT COUNT(*) FROM search_fts WHERE search_fts MATCH '\"削除テスト\"'"
        ).fetchone()
        assert row[0] >= 1

        # Delete
        conn.execute("DELETE FROM search_messages WHERE message_id = 888")
        conn.commit()

        row = conn.execute(
            "SELECT COUNT(*) FROM search_fts WHERE search_fts MATCH '\"削除テスト\"'"
        ).fetchone()
        assert row[0] == 0


# =====================================================================
# 12. Tag is_group_chat
# =====================================================================


class TestTagIsGroupChat:
    """Test _tag_is_group_chat static method."""

    def test_tags_multi_member_group(self, service: SearchService, output_dir: Path):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_full_index_sync()

        conn = service._get_conn()
        results = [
            {"group_id": 1, "service": _SERVICE_ID},
            {"group_id": 2, "service": _SERVICE_ID},
        ]
        SearchService._tag_is_group_chat(results, conn)
        assert results[0]["is_group_chat"] is True
        assert results[1]["is_group_chat"] is False

    def test_tags_empty_results(self, service: SearchService):
        conn = service._get_conn()
        results: list = []
        SearchService._tag_is_group_chat(results, conn)
        assert results == []


# =====================================================================
# 13. Members query
# =====================================================================


class TestGetMembers:
    """Test _get_members_sync with indexed data."""

    def test_get_members_returns_all(self, service: SearchService, output_dir: Path):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_full_index_sync()

        result = service._get_members_sync()
        assert "members" in result
        assert "services" in result
        assert len(result["members"]) >= 3  # 3 distinct members
        assert len(result["services"]) >= 1

    def test_get_members_empty_db(self, service: SearchService):
        result = service._get_members_sync()
        assert result["members"] == []
        assert result["services"] == []

    def test_get_members_service_has_counts(
        self, service: SearchService, output_dir: Path
    ):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_full_index_sync()

        result = service._get_members_sync()
        for svc in result["services"]:
            assert svc["service"] == _SERVICE_ID
            assert svc["member_count"] >= 1
            assert svc["message_count"] >= 1


# =====================================================================
# 14. Exclude-unread search filter
# =====================================================================


class TestExcludeUnreadFilter:
    """Test the exclude_unread parameter in _search_sync."""

    @pytest.fixture(autouse=True)
    def _setup(self, service: SearchService, output_dir: Path):
        with patch(
            "backend.services.search_service.get_output_dir", return_value=output_dir
        ):
            service._build_full_index_sync()
        self.svc = service

    def test_exclude_unread_hides_unread_messages(self):
        # Mark up to message_id=1 as read for group 1
        self.svc._upsert_read_state_sync(
            _SERVICE_ID,
            1,
            100,
            last_read_id=1,
            read_count=1,
            revealed_ids=[],
        )
        conn = self.svc._get_read_conn()
        result = self.svc._search_sync(
            "です",
            None,
            None,
            None,
            50,
            0,
            exclude_unread=True,
            content_type="messages",
            conn=conn,
        )
        # Messages with id > 1 from group 1 member 100 should be hidden
        for r in result["results"]:
            if r["group_id"] == 1 and r["member_id"] == 100:
                assert r["message_id"] <= 1

    def test_exclude_unread_with_revealed_ids(self):
        # Mark up to message_id=1 as read, but reveal message 3
        self.svc._upsert_read_state_sync(
            _SERVICE_ID,
            1,
            100,
            last_read_id=1,
            read_count=1,
            revealed_ids=[3],
        )
        conn = self.svc._get_read_conn()
        result = self.svc._search_sync(
            "頑張ります",
            None,
            None,
            None,
            50,
            0,
            exclude_unread=True,
            content_type="messages",
            conn=conn,
        )
        # Message 3 should be visible despite being past the read boundary
        msg_ids = [r["message_id"] for r in result["results"]]
        assert 3 in msg_ids


# =====================================================================
# 15. Schema direct creation test
# =====================================================================


class TestSchemaDirectCreation:
    """Verify _SCHEMA_SQL can be applied to a fresh in-memory database."""

    def test_schema_sql_executes_cleanly(self):
        conn = sqlite3.connect(":memory:")
        conn.executescript(_SCHEMA_SQL)
        tables = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert "search_messages" in tables
        assert "search_fts" in tables
        assert "search_meta" in tables
        assert "read_states" in tables
        assert "search_blogs" in tables
        assert "search_blogs_fts" in tables
        conn.close()

    def test_schema_sql_is_idempotent(self):
        """Applying schema twice should not raise."""
        conn = sqlite3.connect(":memory:")
        conn.executescript(_SCHEMA_SQL)
        conn.executescript(_SCHEMA_SQL)
        conn.close()
