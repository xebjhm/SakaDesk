"""Unit tests for search_service.py pure functions and simple methods.

Focuses on testable logic that does NOT require ProcessPoolExecutor,
pykakasi, or a full SearchService with live DB connections.
"""

import sqlite3
import unicodedata
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.services.search_service import (
    SearchService,
    _BATCH_SIZE,
    _SCHEMA_SQL,
    _sanitize_for_kakasi_standalone,
    _strip_html,
)


# ── _strip_html ──────────────────────────────────────────────────────

class TestStripHtml:
    """Tests for the top-level _strip_html helper."""

    def test_removes_simple_tags(self):
        assert _strip_html("<p>hello</p>") == "hello"

    def test_removes_nested_tags(self):
        assert _strip_html("<div><span>text</span></div>") == "text"

    def test_decodes_html_entities(self):
        assert _strip_html("&amp; &lt; &gt;") == "& < >"

    def test_collapses_whitespace(self):
        assert _strip_html("<p>hello</p>   <p>world</p>") == "hello world"

    def test_empty_string(self):
        assert _strip_html("") == ""

    def test_no_tags(self):
        assert _strip_html("plain text") == "plain text"

    def test_self_closing_tags(self):
        assert _strip_html("line1<br/>line2") == "line1 line2"

    def test_attributes_in_tags(self):
        result = _strip_html('<a href="http://example.com">link</a>')
        assert result == "link"

    def test_japanese_content(self):
        assert _strip_html("<p>こんにちは世界</p>") == "こんにちは世界"

    def test_mixed_entities_and_tags(self):
        result = _strip_html("<b>bold &amp; italic</b>")
        assert result == "bold & italic"


# ── _sanitize_for_kakasi_standalone ──────────────────────────────────

class TestSanitizeForKakasi:
    """Tests for the standalone kakasi sanitizer."""

    def test_passes_normal_text(self):
        assert _sanitize_for_kakasi_standalone("hello") == "hello"

    def test_replaces_control_characters(self):
        result = _sanitize_for_kakasi_standalone("line1\nline2")
        assert "\n" not in result
        assert "line1" in result
        assert "line2" in result

    def test_replaces_tab(self):
        result = _sanitize_for_kakasi_standalone("col1\tcol2")
        assert "\t" not in result

    def test_replaces_carriage_return(self):
        result = _sanitize_for_kakasi_standalone("hello\rworld")
        assert "\r" not in result

    def test_passes_japanese_text(self):
        text = "こんにちは世界"
        assert _sanitize_for_kakasi_standalone(text) == text

    def test_replaces_emoji(self):
        # Emoji are supplementary plane (> U+FFFF)
        result = _sanitize_for_kakasi_standalone("hello\U0001f600world")
        assert "\U0001f600" not in result
        assert "hello" in result
        assert "world" in result

    def test_empty_string(self):
        assert _sanitize_for_kakasi_standalone("") == ""


# ── SearchService._normalize_query ───────────────────────────────────

class TestNormalizeQuery:
    """Tests for the static _normalize_query method."""

    def test_nfkc_normalization(self):
        # Fullwidth 'Ａ' should become 'A' after NFKC
        result = SearchService._normalize_query("\uff21")
        # After NFKC, fullwidth A becomes ASCII A, which is then romaji-converted
        assert result != "\uff21"

    def test_katakana_to_hiragana(self):
        # Katakana 'ア' (U+30A2) should become hiragana 'あ' (U+3042)
        result = SearchService._normalize_query("ア")
        assert result == "あ"

    def test_katakana_series(self):
        result = SearchService._normalize_query("カキクケコ")
        assert result == "かきくけこ"

    def test_hiragana_unchanged(self):
        result = SearchService._normalize_query("あいうえお")
        assert result == "あいうえお"

    def test_mixed_katakana_hiragana(self):
        result = SearchService._normalize_query("アいウえオ")
        assert result == "あいうえお"

    def test_ascii_romaji_conversion(self):
        # ASCII alphabetic text is converted via jaconv.alphabet2kana
        result = SearchService._normalize_query("aiueo")
        # Should not remain as plain ASCII after romaji conversion
        assert not result.isascii()

    def test_empty_string(self):
        assert SearchService._normalize_query("") == ""

    def test_numeric_string_unchanged(self):
        # Pure digits: isascii=True but no alpha, so no romaji conversion
        result = SearchService._normalize_query("12345")
        assert result == "12345"

    def test_kanji_unchanged(self):
        result = SearchService._normalize_query("漢字")
        assert result == "漢字"


# ── SearchService._sanitize_for_kakasi ───────────────────────────────

class TestSanitizeForKakasiMethod:
    """Tests for the static method version on SearchService."""

    def test_same_as_standalone(self):
        text = "hello\nworld\U0001f600"
        assert (
            SearchService._sanitize_for_kakasi(text)
            == _sanitize_for_kakasi_standalone(text)
        )

    def test_normal_cjk_passes_through(self):
        text = "日本語テスト"
        assert SearchService._sanitize_for_kakasi(text) == text


# ── SearchService._build_snippet ─────────────────────────────────────

class TestBuildSnippet:
    """Tests for the static _build_snippet method."""

    def test_simple_match(self):
        content = "Hello world, this is a test"
        result = SearchService._build_snippet(content, idx=6, match_len=5, max_len=80)
        assert "<mark>" in result
        assert "world" in result
        assert "</mark>" in result

    def test_match_at_start(self):
        content = "Hello world"
        result = SearchService._build_snippet(content, idx=0, match_len=5, max_len=80)
        assert "<mark>Hello</mark>" in result
        assert not result.startswith("...")

    def test_match_at_end(self):
        content = "Hello world"
        result = SearchService._build_snippet(content, idx=6, match_len=5, max_len=80)
        assert "<mark>world</mark>" in result
        assert not result.endswith("...")

    def test_ellipsis_when_truncated(self):
        content = "A" * 200
        result = SearchService._build_snippet(
            content, idx=100, match_len=5, max_len=40
        )
        # Should have ellipsis at start since match is in the middle
        assert "..." in result

    def test_mark_class(self):
        content = "Hello world"
        result = SearchService._build_snippet(
            content, idx=0, match_len=5, max_len=80, mark_cls="reading"
        )
        assert 'class="reading"' in result

    def test_no_class_by_default(self):
        content = "Hello world"
        result = SearchService._build_snippet(content, idx=0, match_len=5, max_len=80)
        assert "class=" not in result


# ── SearchService._load_aliases ──────────────────────────────────────

class TestLoadAliases:
    """Tests for the alias loading static method."""

    def test_returns_dict_with_expected_keys(self):
        result = SearchService._load_aliases()
        assert isinstance(result, dict)
        assert "term_aliases" in result
        assert "member_nicknames" in result

    def test_returns_defaults_when_file_missing(self):
        with patch(
            "backend.services.search_service._ALIASES_PATH",
            Path("/nonexistent/path.json"),
        ):
            result = SearchService._load_aliases()
        assert result == {"term_aliases": {}, "member_nicknames": {}}


# ── SearchService.__init__ ───────────────────────────────────────────

class TestSearchServiceInit:
    """Tests for SearchService initialization (no DB connection)."""

    def test_init_sets_db_path(self, tmp_path):
        db_path = tmp_path / "test.db"
        svc = SearchService(db_path)
        assert svc._db_path == db_path

    def test_init_no_connection(self, tmp_path):
        db_path = tmp_path / "test.db"
        svc = SearchService(db_path)
        assert svc._conn is None
        assert svc._read_conn is None

    def test_init_not_building(self, tmp_path):
        db_path = tmp_path / "test.db"
        svc = SearchService(db_path)
        assert svc._building is False

    def test_init_loads_aliases(self, tmp_path):
        db_path = tmp_path / "test.db"
        svc = SearchService(db_path)
        assert isinstance(svc._aliases, dict)


# ── SearchService._needs_build ───────────────────────────────────────

class TestNeedsBuild:
    """Tests for _needs_build method."""

    def test_needs_build_when_no_db(self, tmp_path):
        db_path = tmp_path / "nonexistent.db"
        svc = SearchService(db_path)
        assert svc._needs_build() is True

    def test_needs_build_when_empty_db(self, tmp_path):
        db_path = tmp_path / "empty.db"
        # Create DB with schema but no meta rows
        conn = sqlite3.connect(str(db_path))
        conn.executescript(_SCHEMA_SQL)
        conn.close()
        svc = SearchService(db_path)
        assert svc._needs_build() is True

    def test_no_build_needed_when_meta_exists(self, tmp_path):
        db_path = tmp_path / "built.db"
        conn = sqlite3.connect(str(db_path))
        conn.executescript(_SCHEMA_SQL)
        conn.execute(
            "INSERT INTO search_meta (key, value) VALUES (?, ?)",
            ("last_full_build", "2025-01-01T00:00:00+00:00"),
        )
        conn.commit()
        conn.close()
        svc = SearchService(db_path)
        assert svc._needs_build() is False


# ── SearchService._get_status_sync ───────────────────────────────────

class TestGetStatusSync:
    """Tests for _get_status_sync via direct DB setup."""

    def test_status_empty_db(self, tmp_path):
        db_path = tmp_path / "status.db"
        svc = SearchService(db_path)
        # Force connection init by calling the sync method directly
        status = svc._get_status_sync()
        assert status["indexed_count"] == 0
        assert status["blog_indexed_count"] == 0
        assert status["last_build"] is None
        assert status["is_building"] is False
        assert status["db_size_bytes"] > 0  # DB file was created

    def test_status_with_data(self, tmp_path):
        db_path = tmp_path / "status_data.db"
        # Pre-populate the database
        conn = sqlite3.connect(str(db_path))
        conn.executescript(_SCHEMA_SQL)
        conn.execute(
            "INSERT INTO search_messages "
            "(message_id, service, group_id, group_name, member_id, member_name, "
            "timestamp, content, content_normalized) "
            "VALUES (1, 'hinatazaka46', 1, 'group1', 1, 'member1', "
            "'2025-01-01', 'hello', 'hello')"
        )
        conn.execute(
            "INSERT INTO search_meta (key, value) VALUES (?, ?)",
            ("last_full_build", "2025-06-01T12:00:00+00:00"),
        )
        conn.commit()
        conn.close()

        svc = SearchService(db_path)
        status = svc._get_status_sync()
        assert status["indexed_count"] == 1
        assert status["last_build"] == "2025-06-01T12:00:00+00:00"


# ── SearchService._clear_db_sync ────────────────────────────────────

class TestClearDbSync:
    """Tests for the DB cleanup method."""

    def test_clear_deletes_file(self, tmp_path):
        db_path = tmp_path / "to_clear.db"
        svc = SearchService(db_path)
        # Create the DB
        svc._get_conn()
        assert db_path.exists()
        svc._clear_db_sync()
        assert not db_path.exists()
        assert svc._conn is None
        assert svc._read_conn is None

    def test_clear_noop_when_no_db(self, tmp_path):
        db_path = tmp_path / "nope.db"
        svc = SearchService(db_path)
        # Should not raise
        svc._clear_db_sync()


# ── SearchService._expand_query ──────────────────────────────────────

class TestExpandQuery:
    """Tests for query expansion with aliases."""

    def test_no_aliases_returns_original(self, tmp_path):
        db_path = tmp_path / "expand.db"
        svc = SearchService(db_path)
        svc._aliases = {"term_aliases": {}, "member_nicknames": {}}
        result = svc._expand_query("test")
        assert result == ["test"]

    def test_deduplicates(self, tmp_path):
        db_path = tmp_path / "expand2.db"
        svc = SearchService(db_path)
        svc._aliases = {"term_aliases": {}, "member_nicknames": {}}
        result = svc._expand_query("hello")
        # Should have no duplicates
        assert len(result) == len(set(result))


# ── SearchService._resolve_nickname ──────────────────────────────────

class TestResolveNickname:
    """Tests for nickname resolution."""

    def test_no_match(self, tmp_path):
        db_path = tmp_path / "nick.db"
        svc = SearchService(db_path)
        svc._aliases = {"term_aliases": {}, "member_nicknames": {}}
        assert svc._resolve_nickname("unknown") is None


# ── _BATCH_SIZE constant ─────────────────────────────────────────────

def test_batch_size_is_positive():
    assert _BATCH_SIZE > 0
    assert isinstance(_BATCH_SIZE, int)


# ── _SCHEMA_SQL constant ────────────────────────────────────────────

def test_schema_sql_creates_tables():
    """Verify the schema SQL is valid by executing it in an in-memory DB."""
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA_SQL)
    # Check tables were created
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert "search_messages" in tables
    assert "search_meta" in tables
    assert "read_states" in tables
    assert "search_blogs" in tables
    conn.close()


def test_schema_sql_creates_fts_tables():
    """Verify FTS5 virtual tables are created."""
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA_SQL)
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert "search_fts" in tables
    assert "search_blogs_fts" in tables
    conn.close()


# ── Read states sync ─────────────────────────────────────────────────

class TestReadStatesSync:
    """Tests for read state management via sync methods."""

    def test_get_all_read_states_empty(self, tmp_path):
        db_path = tmp_path / "rs.db"
        svc = SearchService(db_path)
        result = svc._get_all_read_states_sync()
        assert result == {}

    def test_upsert_and_get_read_state(self, tmp_path):
        db_path = tmp_path / "rs2.db"
        svc = SearchService(db_path)
        svc._upsert_read_state_sync(
            "hinatazaka46", 1, 100, 50, 10, [1, 2, 3]
        )
        states = svc._get_all_read_states_sync()
        key = "hinatazaka46/1/100"
        assert key in states
        assert states[key]["last_read_id"] == 50
        assert states[key]["read_count"] == 10
        assert states[key]["revealed_ids"] == [1, 2, 3]
