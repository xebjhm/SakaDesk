import sqlite3
from pathlib import Path


def test_type_column_exists_after_migration(tmp_path: Path):
    """After migration, search_messages should have a type column."""
    db_path = tmp_path / "search_index.db"
    conn = sqlite3.connect(str(db_path))

    # Create old schema (without type column)
    conn.execute("""
        CREATE TABLE search_messages (
            rowid INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            service TEXT NOT NULL,
            group_id INTEGER NOT NULL,
            group_name TEXT NOT NULL,
            member_id INTEGER NOT NULL,
            member_name TEXT NOT NULL,
            timestamp TEXT,
            content TEXT,
            content_normalized TEXT,
            UNIQUE(message_id, service)
        )
    """)
    conn.commit()

    from backend.services.search_service import _migrate_add_type_column

    _migrate_add_type_column(conn)

    # Verify type column exists with default 'text'
    conn.execute(
        "INSERT INTO search_messages (message_id, service, group_id, group_name, member_id, member_name) VALUES (1, 's', 1, 'g', 1, 'm')"
    )
    conn.commit()
    row = conn.execute("SELECT type FROM search_messages WHERE message_id=1").fetchone()
    assert row[0] == "text"
    conn.close()


def test_migration_is_idempotent(tmp_path: Path):
    """Running migration twice should not error."""
    db_path = tmp_path / "search_index.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE search_messages (
            rowid INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            service TEXT NOT NULL,
            group_id INTEGER NOT NULL,
            group_name TEXT NOT NULL,
            member_id INTEGER NOT NULL,
            member_name TEXT NOT NULL,
            timestamp TEXT,
            content TEXT,
            content_normalized TEXT,
            type TEXT DEFAULT 'text',
            UNIQUE(message_id, service)
        )
    """)
    conn.commit()

    from backend.services.search_service import _migrate_add_type_column

    _migrate_add_type_column(conn)  # Should not raise
    _migrate_add_type_column(conn)  # Should not raise
    conn.close()


def test_result_returns_real_type():
    """Search results should return the actual message type, not hardcoded 'text'."""
    from backend.services.search_service import SearchService

    svc = SearchService.__new__(SearchService)
    # Build a mock row with type at index 9
    # Row: (message_id, content, content_normalized, service, group_id, group_name, member_id, member_name, timestamp, type)
    row = (
        42,
        "content",
        "content",
        "hinatazaka46",
        "1",
        "Group",
        "2",
        "Member",
        "2026-04-16T12:00:00",
        "voice",
    )
    query_info = {
        "query": "test",
        "normalized": "test",
        "reading_forms": [],
        "first_term": "test",
        "first_norm": "test",
        "query_is_romaji": False,
        "is_multi_word": False,
        "words": ["test"],
        "exact_only": False,
    }

    result = svc._build_message_result_dict(row, query_info)
    assert result["type"] == "voice"
