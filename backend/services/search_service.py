"""Search service for Japanese fuzzy search over synced message content."""
import asyncio
import json
import re
import sqlite3
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import jaconv
import structlog

from backend.services.platform import get_app_data_dir
from backend.services.path_resolver import get_output_dir
from backend.services.service_utils import (
    get_service_display_name,
    get_service_identifier,
)

logger = structlog.get_logger(__name__)


def _strip_html(html: str) -> str:
    """Strip HTML tags, decode entities, collapse whitespace."""
    text = re.sub(r'<[^>]+>', ' ', html)
    text = unescape(text)
    return re.sub(r'\s+', ' ', text).strip()


_ALIASES_PATH = Path(__file__).parent.parent / "data" / "search_aliases.json"

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS search_messages (
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
    UNIQUE(message_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    content,
    content_normalized,
    content=search_messages,
    content_rowid=rowid,
    tokenize="trigram"
);

CREATE TRIGGER IF NOT EXISTS search_ai AFTER INSERT ON search_messages BEGIN
    INSERT INTO search_fts(rowid, content, content_normalized)
    VALUES (new.rowid, new.content, new.content_normalized);
END;

CREATE TRIGGER IF NOT EXISTS search_ad AFTER DELETE ON search_messages BEGIN
    INSERT INTO search_fts(search_fts, rowid, content, content_normalized)
    VALUES ('delete', old.rowid, old.content, old.content_normalized);
END;

CREATE TRIGGER IF NOT EXISTS search_au AFTER UPDATE ON search_messages BEGIN
    INSERT INTO search_fts(search_fts, rowid, content, content_normalized)
    VALUES ('delete', old.rowid, old.content, old.content_normalized);
    INSERT INTO search_fts(rowid, content, content_normalized)
    VALUES (new.rowid, new.content, new.content_normalized);
END;

CREATE INDEX IF NOT EXISTS idx_search_service ON search_messages(service);
CREATE INDEX IF NOT EXISTS idx_search_member ON search_messages(service, group_id, member_id);
CREATE INDEX IF NOT EXISTS idx_search_timestamp ON search_messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_search_msgid ON search_messages(message_id);

CREATE TABLE IF NOT EXISTS search_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS read_states (
    service TEXT NOT NULL,
    group_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    last_read_id INTEGER NOT NULL DEFAULT 0,
    read_count INTEGER NOT NULL DEFAULT 0,
    revealed_ids TEXT DEFAULT '[]',
    updated_at TEXT,
    PRIMARY KEY (service, group_id, member_id)
);

CREATE TABLE IF NOT EXISTS search_blogs (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    blog_id TEXT NOT NULL,
    service TEXT NOT NULL,
    member_id INTEGER NOT NULL,
    member_name TEXT NOT NULL,
    title TEXT,
    title_normalized TEXT,
    published_at TEXT,
    blog_url TEXT,
    content TEXT,
    content_normalized TEXT,
    UNIQUE(blog_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_blogs_fts USING fts5(
    title,
    title_normalized,
    content,
    content_normalized,
    content=search_blogs,
    content_rowid=rowid,
    tokenize="trigram"
);

CREATE TRIGGER IF NOT EXISTS search_blogs_ai AFTER INSERT ON search_blogs BEGIN
    INSERT INTO search_blogs_fts(rowid, title, title_normalized, content, content_normalized)
    VALUES (new.rowid, new.title, new.title_normalized, new.content, new.content_normalized);
END;

CREATE TRIGGER IF NOT EXISTS search_blogs_ad AFTER DELETE ON search_blogs BEGIN
    INSERT INTO search_blogs_fts(search_blogs_fts, rowid, title, title_normalized, content, content_normalized)
    VALUES ('delete', old.rowid, old.title, old.title_normalized, old.content, old.content_normalized);
END;

CREATE TRIGGER IF NOT EXISTS search_blogs_au AFTER UPDATE ON search_blogs BEGIN
    INSERT INTO search_blogs_fts(search_blogs_fts, rowid, title, title_normalized, content, content_normalized)
    VALUES ('delete', old.rowid, old.title, old.title_normalized, old.content, old.content_normalized);
    INSERT INTO search_blogs_fts(rowid, title, title_normalized, content, content_normalized)
    VALUES (new.rowid, new.title, new.title_normalized, new.content, new.content_normalized);
END;

CREATE INDEX IF NOT EXISTS idx_search_blogs_service ON search_blogs(service);
CREATE INDEX IF NOT EXISTS idx_search_blogs_member ON search_blogs(service, member_id);
CREATE INDEX IF NOT EXISTS idx_search_blogs_published ON search_blogs(published_at);
"""

_BATCH_SIZE = 500


def _is_romaji(term: str, normalize_fn=None) -> bool:
    """Check if term is ASCII Latin that normalizes to different hiragana."""
    if normalize_fn is None:
        normalize_fn = SearchService._normalize_query
    return (term.isascii()
            and any(c.isalpha() for c in term)
            and normalize_fn(term) != term.lower())


class SearchService:
    """FTS5-backed search index for message content with Japanese normalization."""

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._conn: Optional[sqlite3.Connection] = None
        self._building = False
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="search-db")
        self._kakasi: Any = None
        self._aliases: Dict[str, Any] = self._load_aliases()

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    def _get_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(self._db_path))
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.executescript(_SCHEMA_SQL)
        return self._conn

    # ------------------------------------------------------------------
    # Kakasi lazy init
    # ------------------------------------------------------------------

    def _get_kakasi(self) -> Any:
        if self._kakasi is None:
            import pykakasi
            self._kakasi = pykakasi.kakasi()
            logger.info("pykakasi initialized")
        return self._kakasi

    # ------------------------------------------------------------------
    # Text normalization
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_query(query: str) -> str:
        text = unicodedata.normalize("NFKC", query)
        # Convert romaji to hiragana if query is ASCII Latin
        if text.isascii() and any(c.isalpha() for c in text):
            text = jaconv.alphabet2kana(text.lower())
        # Katakana → hiragana
        chars: list[str] = []
        for ch in text:
            cp = ord(ch)
            if 0x30A1 <= cp <= 0x30F6:
                chars.append(chr(cp - 0x60))
            else:
                chars.append(ch)
        return "".join(chars)

    @staticmethod
    def _sanitize_for_kakasi(text: str) -> str:
        """Replace characters that trigger pykakasi's duplication bug with space.

        pykakasi duplicates the preceding character when it encounters:
        - Control characters (Unicode Cc: ``\\n``, ``\\r``, ``\\t``, …)
        - Supplementary-plane characters (code points > U+FFFF: emoji, etc.)

        Replacing them with space prevents false adjacency
        (e.g. "ね💕素" → "ね す", "ね\\n素" → "ね す" instead of "ねねす").
        """
        return "".join(
            " " if (ord(ch) > 0xFFFF or unicodedata.category(ch) == "Cc") else ch
            for ch in text
        )

    def _normalize_with_readings(self, text: str) -> str:
        text = unicodedata.normalize("NFKC", text)
        text = self._sanitize_for_kakasi(text)
        kakasi = self._get_kakasi()
        parts: list[str] = []
        for item in kakasi.convert(text):
            parts.append(item["hira"])
        return "".join(parts)

    # ------------------------------------------------------------------
    # Alias dictionary
    # ------------------------------------------------------------------

    @staticmethod
    def _load_aliases() -> Dict[str, Any]:
        if _ALIASES_PATH.exists():
            try:
                with open(_ALIASES_PATH, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning("Failed to load search aliases", error=str(e))
        return {"term_aliases": {}, "member_nicknames": {}}

    def _expand_query(self, query: str) -> List[str]:
        terms = [query]
        normalized = self._normalize_query(query)
        aliases = self._aliases.get("term_aliases", {})
        for key, values in aliases.items():
            key_norm = self._normalize_query(key)
            targets = values if isinstance(values, list) else [values]
            if normalized == key_norm:
                terms.extend(targets)
            else:
                for target in targets:
                    if normalized == self._normalize_query(target):
                        terms.append(key)
                        terms.extend(t for t in targets if t != target)
                        break
        seen: set[str] = set()
        deduped: list[str] = []
        for t in terms:
            if t not in seen:
                seen.add(t)
                deduped.append(t)
        return deduped

    def _resolve_nickname(self, query: str) -> Optional[Dict[str, Any]]:
        normalized = self._normalize_query(query)
        nicknames = self._aliases.get("member_nicknames", {})
        for nickname, info in nicknames.items():
            if self._normalize_query(nickname) == normalized:
                return info
        return None

    # ------------------------------------------------------------------
    # Snippet generation (Python-based, avoids FTS5 context issues)
    # ------------------------------------------------------------------

    @staticmethod
    def _build_snippet(content: str, idx: int, match_len: int, max_len: int, mark_cls: str = "") -> str:
        """Build a snippet with context around a match at *idx*."""
        cls_attr = f' class="{mark_cls}"' if mark_cls else ""
        ctx = max_len - match_len
        start = max(0, idx - ctx // 2)
        end = min(len(content), idx + match_len + ctx // 2)

        prefix = "..." if start > 0 else ""
        suffix = "..." if end < len(content) else ""

        before = content[start:idx]
        matched = content[idx:idx + match_len]
        after = content[idx + match_len:end]
        return f"{prefix}{before}<mark{cls_attr}>{matched}</mark>{after}{suffix}"

    def _make_multi_word_snippet(
        self,
        content: str,
        words: List[str],
        content_normalized: str = "",
        max_len: int = 80,
    ) -> str:
        """Generate a snippet highlighting ALL words for multi-word queries."""
        if not content:
            return ""

        lower_content = content.lower()

        # Find match positions for all words: list of (idx, length, mark_cls)
        matches: List[Tuple[int, int, str]] = []
        for word in words:
            norm_word = self._normalize_query(word)
            is_word_romaji = (word.isascii()
                              and any(c.isalpha() for c in word)
                              and norm_word != word.lower())
            # Try exact match (always yellow)
            idx = lower_content.find(word.lower())
            if idx != -1:
                matches.append((idx, len(word), ""))
                continue
            # Try normalized in original — reading class for romaji
            if norm_word != word.lower():
                idx = lower_content.find(norm_word)
                if idx != -1:
                    cls = "reading" if is_word_romaji else ""
                    matches.append((idx, len(norm_word), cls))
                    continue
            # Try reading match
            if content_normalized and norm_word:
                idx = content_normalized.find(norm_word)
                if idx != -1:
                    mapping = self._map_reading_to_original(content, idx, norm_word)
                    if mapping:
                        matches.append((mapping[0], mapping[1], "reading"))
                        continue

        if not matches:
            return content[:max_len] + ("..." if len(content) > max_len else "")

        matches.sort(key=lambda m: m[0])

        # Center window on first match
        first_idx, first_len, _ = matches[0]
        ctx = max_len - first_len
        start = max(0, first_idx - ctx // 3)
        end = min(len(content), start + max_len)

        prefix = "..." if start > 0 else ""
        suffix = "..." if end < len(content) else ""

        # Build snippet with all highlights (apply in reverse to preserve positions)
        snippet = content[start:end]
        rel_matches = []
        for idx, length, cls in matches:
            rel_idx = idx - start
            if 0 <= rel_idx and rel_idx + length <= len(snippet):
                rel_matches.append((rel_idx, length, cls))

        rel_matches.sort(key=lambda m: m[0], reverse=True)
        for rel_idx, length, cls in rel_matches:
            cls_attr = f' class="{cls}"' if cls else ""
            matched = snippet[rel_idx:rel_idx + length]
            snippet = f"{snippet[:rel_idx]}<mark{cls_attr}>{matched}</mark>{snippet[rel_idx + length:]}"

        return f"{prefix}{snippet}{suffix}"

    def _map_reading_to_original(
        self, content: str, norm_idx: int, normalized_query: str
    ) -> Optional[Tuple[int, int]]:
        """Map a reading match back to the original text using pykakasi word boundaries.

        *norm_idx* is the position of the match in the normalized (hiragana) content.
        The DB-stored normalized content is NFKC + pykakasi, so we apply NFKC first
        to match that pipeline, then find the corresponding original text.

        Returns (start_index, length) in original text, or None if not found.
        """
        kakasi = self._get_kakasi()
        # Match the normalization pipeline: NFKC + sanitize, then pykakasi.
        # _sanitize_for_kakasi must be applied here too, otherwise control
        # chars (e.g. \r\n) shift the positions relative to the DB-stored
        # normalized content, causing highlights to land on the wrong text.
        nfkc_content = unicodedata.normalize("NFKC", content)
        sanitized_content = self._sanitize_for_kakasi(nfkc_content)
        items = kakasi.convert(sanitized_content)

        # Walk items, tracking position in normalized (hira) output
        norm_pos = 0
        match_norm_end = norm_idx + len(normalized_query)

        # Collect the NFKC-text fragments that overlap with the match
        matched_nfkc_parts: list[str] = []
        for item in items:
            hira_len = len(item["hira"])
            n_start = norm_pos
            n_end = norm_pos + hira_len

            if n_end > norm_idx and n_start < match_norm_end:
                # This item overlaps with the match range
                if hira_len == len(item["orig"]):
                    # Same-length (hiragana/katakana text) — extract exact chars
                    local_start = max(0, norm_idx - n_start)
                    local_end = min(hira_len, match_norm_end - n_start)
                    matched_nfkc_parts.append(item["orig"][local_start:local_end])
                else:
                    # Kanji expansion — include the whole word
                    matched_nfkc_parts.append(item["orig"])

            norm_pos = n_end

        if not matched_nfkc_parts:
            return None

        # Search for the matched text in the original content
        matched_text = "".join(matched_nfkc_parts)
        idx = content.find(matched_text)
        if idx != -1:
            return (idx, len(matched_text))

        # Fallback: search in NFKC content (handles fullwidth/halfwidth differences)
        nfkc_idx = nfkc_content.find(matched_text)
        if nfkc_idx != -1 and nfkc_idx < len(content):
            # Approximate: use same position (NFKC rarely changes length for CJK)
            match_len = min(len(matched_text), len(content) - nfkc_idx)
            return (nfkc_idx, match_len)

        return None

    def _make_snippet(
        self,
        content: str,
        query: str,
        content_normalized: str = "",
        normalized_query: str = "",
        max_len: int = 80,
        *,
        is_romaji: bool = False,
    ) -> str:
        """Generate a highlighted snippet around the first match of *query* in *content*.

        Falls back to searching the normalized (hiragana) content when the exact
        query string is not found in the original text (e.g. kanji reading match).
        When *is_romaji* is True, non-exact matches use the "reading" highlight
        class (blue dashed) instead of the default yellow.
        """
        if not content:
            return ""

        # 1. Exact match in original content (always yellow)
        lower_content = content.lower()
        lower_query = query.lower()
        idx = lower_content.find(lower_query)
        if idx != -1:
            return self._build_snippet(content, idx, len(query), max_len)

        # 2. Normalized query in original content (hiragana query matching katakana text etc.)
        #    For romaji input, this is a reading match → blue "reading" class.
        if normalized_query and normalized_query != lower_query:
            idx = lower_content.find(normalized_query)
            if idx != -1:
                cls = "reading" if is_romaji else ""
                return self._build_snippet(content, idx, len(normalized_query), max_len, cls)

        # 3. Match in normalized content (kanji reading match — e.g. 好き matched by すき)
        if content_normalized and normalized_query:
            idx = content_normalized.find(normalized_query)
            if idx != -1:
                mapping = self._map_reading_to_original(content, idx, normalized_query)
                if mapping:
                    orig_idx, orig_len = mapping
                    return self._build_snippet(content, orig_idx, orig_len, max_len, "reading")

        # 4. No match found — show beginning of content
        return content[:max_len] + ("..." if len(content) > max_len else "")

    # ------------------------------------------------------------------
    # Blog snippet generation
    # ------------------------------------------------------------------

    def _make_blog_snippet(
        self,
        title: str,
        content: str,
        query: str,
        content_normalized: str = "",
        title_normalized: str = "",
        max_len: int = 80,
    ) -> str:
        """Generate a highlighted snippet for a blog search result.

        Priority:
        1. Match in content body (delegated to ``_make_snippet``)
        2. Match in title with ``<mark>`` highlighting
        3. First *max_len* chars of content as fallback
        """
        normalized_query = self._normalize_query(query)
        is_romaji = _is_romaji(query)

        # 1. Try content body match
        if content:
            snippet = self._make_snippet(
                content, query, content_normalized, normalized_query,
                max_len=max_len, is_romaji=is_romaji,
            )
            # _make_snippet returns highlighted text with <mark> if found;
            # if it fell through to the "no match" fallback it won't have <mark>.
            if "<mark" in snippet:
                return snippet

        # 2. Try title match
        if title:
            lower_title = title.lower()
            lower_query = query.lower()
            idx = lower_title.find(lower_query)
            if idx != -1:
                matched = title[idx:idx + len(query)]
                before = title[:idx]
                after = title[idx + len(query):]
                return f"{before}<mark>{matched}</mark>{after}"
            # Normalized match in title
            if normalized_query and normalized_query != lower_query:
                idx = lower_title.find(normalized_query)
                if idx != -1:
                    matched = title[idx:idx + len(normalized_query)]
                    before = title[:idx]
                    after = title[idx + len(normalized_query):]
                    cls = ' class="reading"' if is_romaji else ""
                    return f"{before}<mark{cls}>{matched}</mark>{after}"
            # Reading match in title_normalized
            if title_normalized and normalized_query:
                idx = title_normalized.find(normalized_query)
                if idx != -1:
                    mapping = self._map_reading_to_original(title, idx, normalized_query)
                    if mapping:
                        orig_idx, orig_len = mapping
                        matched = title[orig_idx:orig_idx + orig_len]
                        before = title[:orig_idx]
                        after = title[orig_idx + orig_len:]
                        return f'{before}<mark class="reading">{matched}</mark>{after}'

        # 3. Fallback: first max_len chars of content
        if content:
            return content[:max_len] + ("..." if len(content) > max_len else "")
        return title or ""

    # ------------------------------------------------------------------
    # Blog search (sync, runs in executor)
    # ------------------------------------------------------------------

    def _search_blogs_sync(
        self,
        query: str,
        service: Optional[str],
        member_id: Optional[int],
        limit: int,
        offset: int,
        *,
        services: Optional[List[str]] = None,
        member_ids: Optional[List[int]] = None,
        member_filters: Optional[List[tuple]] = None,
        exact_only: bool = False,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        raw_rows_only: bool = False,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Search indexed blog content. Returns ``(results, total_count)``.

        When *raw_rows_only* is True, returns lightweight dicts without
        snippet computation (used by the merged "all" code path to defer
        expensive work until after pagination).
        """
        conn = self._get_conn()

        normalized_query = self._normalize_query(query)

        # --- Filter clauses ---
        filter_clauses: list[str] = []
        filter_params: list[Any] = []

        if service:
            filter_clauses.append("b.service = ?")
            filter_params.append(service)
        if member_id is not None:
            filter_clauses.append("b.member_id = ?")
            filter_params.append(member_id)

        # Multi-service/member OR filter
        if services or member_ids or member_filters:
            or_parts: list[str] = []
            if services:
                placeholders = ",".join("?" for _ in services)
                or_parts.append(f"b.service IN ({placeholders})")
                filter_params.extend(services)
            if member_ids:
                placeholders = ",".join("?" for _ in member_ids)
                or_parts.append(f"b.member_id IN ({placeholders})")
                filter_params.extend(member_ids)
            if member_filters:
                for svc_id, mid in member_filters:
                    or_parts.append("(b.service = ? AND b.member_id = ?)")
                    filter_params.extend([svc_id, mid])
            filter_clauses.append(f"({' OR '.join(or_parts)})")

        # Date range filters (uses published_at)
        if date_from:
            filter_clauses.append("b.published_at >= ?")
            filter_params.append(date_from)
        if date_to:
            filter_clauses.append("b.published_at <= ?")
            filter_params.append(date_to)

        filter_sql = ""
        if filter_clauses:
            filter_sql = " AND " + " AND ".join(filter_clauses)

        # --- Build query ---
        all_params: list[Any] = []

        if len(normalized_query) >= 3:
            # FTS5 MATCH — escape double quotes to prevent syntax injection
            safe_query = query.lower().replace('"', '""')
            safe_normalized = normalized_query.replace('"', '""')
            if exact_only:
                match_expr = f'{{title content}}: "{safe_query}"'
            else:
                match_expr = (
                    f'{{title title_normalized content content_normalized}}: '
                    f'"{safe_normalized}"'
                )
            data_sql = (
                "SELECT b.blog_id, b.title, b.title_normalized, b.content, "
                "b.content_normalized, b.service, b.member_id, b.member_name, "
                "b.published_at, b.blog_url "
                "FROM search_blogs_fts f "
                "JOIN search_blogs b ON f.rowid = b.rowid "
                f"WHERE search_blogs_fts MATCH ? {filter_sql} "
                "ORDER BY b.published_at DESC"
            )
            all_params.append(match_expr)
            all_params.extend(filter_params)
        else:
            # LIKE fallback
            like_clauses: list[str] = []
            if exact_only:
                like_clauses.append("(b.title LIKE ? OR b.content LIKE ?)")
                all_params.extend([f"%{query}%", f"%{query}%"])
            else:
                like_clauses.append(
                    "(b.title LIKE ? OR b.title_normalized LIKE ? "
                    "OR b.content LIKE ? OR b.content_normalized LIKE ?)"
                )
                all_params.extend([
                    f"%{query}%", f"%{normalized_query}%",
                    f"%{query}%", f"%{normalized_query}%",
                ])
            all_params.extend(filter_params)
            data_sql = (
                "SELECT b.blog_id, b.title, b.title_normalized, b.content, "
                "b.content_normalized, b.service, b.member_id, b.member_name, "
                "b.published_at, b.blog_url "
                f"FROM search_blogs b "
                f"WHERE {' AND '.join(like_clauses)} {filter_sql} "
                "ORDER BY b.published_at DESC"
            )

        # --- Count ---
        count_sql = f"SELECT COUNT(*) FROM ({data_sql})"
        try:
            row = conn.execute(count_sql, list(all_params)).fetchone()
            total_count = row[0] if row else 0
        except Exception as e:
            logger.warning("Blog search count query failed", error=str(e))
            total_count = 0

        # --- Paginated results ---
        if limit > 0:
            page_sql = f"{data_sql} LIMIT ? OFFSET ?"
            page_params = list(all_params) + [limit, offset]
        else:
            # limit=0 means fetch all (used for merged "all" queries)
            page_sql = data_sql
            page_params = list(all_params)

        try:
            rows = conn.execute(page_sql, page_params).fetchall()
        except Exception as e:
            logger.warning("Blog search query failed", error=str(e))
            rows = []

        # --- Build results ---
        results: list[Dict[str, Any]] = []
        for r in rows:
            title = r[1] or ""
            title_norm = r[2] or ""
            content = r[3] or ""
            content_norm = r[4] or ""

            # Determine match_type for ordering (exact > reading)
            query_lower = query.lower()
            has_exact = query_lower in title.lower() or query_lower in content.lower()
            blog_match_type = "exact" if has_exact else "reading"

            if raw_rows_only:
                # Lightweight dict — skip expensive snippet computation
                results.append({
                    "result_type": "blog",
                    "blog_id": r[0],
                    "title": title,
                    "title_normalized": title_norm,
                    "content": content,
                    "content_normalized": content_norm,
                    "service": r[5],
                    "member_id": r[6],
                    "member_name": r[7],
                    "published_at": r[8],
                    "blog_url": r[9],
                    "match_type": blog_match_type,
                })
            else:
                snippet = self._make_blog_snippet(
                    title, content, query,
                    content_normalized=content_norm,
                    title_normalized=title_norm,
                )

                results.append({
                    "result_type": "blog",
                    "blog_id": r[0],
                    "title": title,
                    "snippet": snippet,
                    "service": r[5],
                    "member_id": r[6],
                    "member_name": r[7],
                    "published_at": r[8],
                    "blog_url": r[9],
                    "match_type": blog_match_type,
                })

        return results, total_count

    # ------------------------------------------------------------------
    # Message result helpers
    # ------------------------------------------------------------------

    def _build_message_result_dict(
        self,
        row: tuple,
        query_info: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Build a single message result dict with snippet and match_type.

        *row* is a DB row with columns:
            (message_id, content, content_normalized, service, group_id,
             group_name, member_id, member_name, timestamp, match_type)

        *query_info* bundles the pre-computed search query metadata:
            first_term, first_norm, query_is_romaji, is_multi_word, words,
            exact_only.
        """
        content = row[1] or ""
        content_norm = row[2] or ""
        lower_content = content.lower()

        first_term = query_info["first_term"]
        first_norm = query_info["first_norm"]
        query_is_romaji = query_info["query_is_romaji"]
        is_multi_word = query_info["is_multi_word"]
        words = query_info["words"]
        exact_only = query_info["exact_only"]

        if exact_only:
            if is_multi_word:
                snippet = self._make_multi_word_snippet(content, words, content_norm)
            else:
                snippet = self._make_snippet(
                    content, first_term, content_norm, first_norm,
                    is_romaji=query_is_romaji,
                )
            match_type = "exact"
        elif is_multi_word:
            snippet = self._make_multi_word_snippet(content, words, content_norm)
            all_exact = all(w.lower() in lower_content for w in words)
            match_type = "exact" if all_exact else "reading"
        else:
            snippet = self._make_snippet(
                content, first_term, content_norm, first_norm,
                is_romaji=query_is_romaji,
            )
            has_exact = first_term.lower() in lower_content
            match_type = "exact" if has_exact else "reading"

        return {
            "result_type": "message",
            "message_id": row[0],
            "content": content,
            "snippet": snippet,
            "service": row[3],
            "group_id": row[4],
            "group_name": row[5],
            "member_id": row[6],
            "member_name": row[7],
            "timestamp": row[8],
            "type": "text",
            "match_type": match_type,
        }

    @staticmethod
    def _tag_is_group_chat(
        results: List[Dict[str, Any]],
        conn: sqlite3.Connection,
    ) -> None:
        """Add ``is_group_chat`` flag to message results in-place.

        Queries the index for the distinct member count per
        (service, group_id) and marks results from multi-member groups.
        Only message results (those with a ``group_id`` key) are tagged.
        """
        group_ids = list({r["group_id"] for r in results if "group_id" in r})
        if not group_ids:
            return
        placeholders = ",".join("?" for _ in group_ids)
        gc_rows = conn.execute(
            f"SELECT service, group_id, COUNT(DISTINCT member_id) "
            f"FROM search_messages "
            f"WHERE group_id IN ({placeholders}) "
            f"GROUP BY service, group_id",
            group_ids,
        ).fetchall()
        group_chat_set = {(svc, gid) for svc, gid, cnt in gc_rows if cnt > 1}
        for r in results:
            if "group_id" in r:
                r["is_group_chat"] = (r["service"], r["group_id"]) in group_chat_set

    # ------------------------------------------------------------------
    # Search (sync, runs in executor)
    # ------------------------------------------------------------------

    def _search_sync(
        self,
        query: str,
        service: Optional[str],
        group_id: Optional[int],
        member_id: Optional[int],
        limit: int,
        offset: int,
        *,
        services: Optional[List[str]] = None,
        member_ids: Optional[List[int]] = None,
        member_filters: Optional[List[tuple]] = None,
        exact_only: bool = False,
        exclude_unread: bool = False,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        content_type: str = "all",
    ) -> Dict[str, Any]:
        conn = self._get_conn()

        # --- Blog-only short circuit ---
        if content_type == "blogs":
            blog_results, blog_total = self._search_blogs_sync(
                query, service, member_id, limit, offset,
                services=services, member_ids=member_ids,
                member_filters=member_filters,
                exact_only=exact_only,
                date_from=date_from, date_to=date_to,
            )
            first_norm = self._normalize_query(query)
            return {
                "query": query,
                "normalized_query": first_norm,
                "total_count": blog_total,
                "results": blog_results,
                "has_more": (offset + limit) < blog_total,
            }

        words = query.strip().split()
        is_multi_word = len(words) > 1

        # --- Alias / nickname resolution (single-word only) ---
        if not is_multi_word:
            terms = self._expand_query(query)
            nickname_info = self._resolve_nickname(query)
        else:
            terms = words
            nickname_info = None

        extra_member_name: Optional[str] = None
        if nickname_info:
            extra_member_name = nickname_info.get("member_name")
            if nickname_info.get("service") and service is None:
                service = nickname_info["service"]
            if nickname_info.get("group_id") and group_id is None:
                group_id = nickname_info["group_id"]
            if nickname_info.get("member_id") and member_id is None:
                member_id = nickname_info["member_id"]

        normalized_terms = [self._normalize_query(t) for t in terms]

        # --- Filter clauses ---
        filter_clauses: list[str] = []
        filter_params: list[Any] = []

        # Single service filter (from nickname resolution or legacy single-service param)
        if service:
            filter_clauses.append("m.service = ?")
            filter_params.append(service)
        if group_id is not None:
            filter_clauses.append("m.group_id = ?")
            filter_params.append(group_id)
        if member_id is not None:
            filter_clauses.append("m.member_id = ?")
            filter_params.append(member_id)
        if extra_member_name and member_id is None:
            filter_clauses.append("m.member_name = ?")
            filter_params.append(extra_member_name)

        # Multi-service/member OR filter (from search filter UI chips)
        # These are combined with OR: any matching service OR any matching member
        if services or member_ids or member_filters:
            or_parts: list[str] = []
            if services:
                placeholders = ",".join("?" for _ in services)
                or_parts.append(f"m.service IN ({placeholders})")
                filter_params.extend(services)
            if member_ids:
                placeholders = ",".join("?" for _ in member_ids)
                or_parts.append(f"m.member_id IN ({placeholders})")
                filter_params.extend(member_ids)
            # Service-scoped member pairs: matches all groups for that member within the service
            if member_filters:
                for svc_id, mid in member_filters:
                    or_parts.append("(m.service = ? AND m.member_id = ?)")
                    filter_params.extend([svc_id, mid])
            filter_clauses.append(f"({' OR '.join(or_parts)})")

        # Date range filters
        if date_from:
            filter_clauses.append("m.timestamp >= ?")
            filter_params.append(date_from)
        if date_to:
            filter_clauses.append("m.timestamp <= ?")
            filter_params.append(date_to)

        # Unread filter: exclude messages not yet read
        # Uses read_states table to determine read boundary per conversation.
        # JOIN on (service, group_id) only — not member_id — because:
        #   - Individual chats: one read_states row per (service, group_id, member_id)
        #   - Group chats: one read_states row with member_id=0, but search_messages
        #     stores the actual author's member_id per message
        # MAX(last_read_id) handles both cases correctly.
        # Also includes individually revealed messages (revealed_ids in read_states).
        unread_join_sql = ""
        if exclude_unread:
            unread_join_sql = (
                " LEFT JOIN ("
                "SELECT service, group_id, MAX(last_read_id) as last_read_id "
                "FROM read_states GROUP BY service, group_id"
                ") rs ON m.service = rs.service AND m.group_id = rs.group_id"
            )
            # Collect all revealed_ids so they bypass the last_read_id boundary
            all_revealed: set[int] = set()
            try:
                rs_rows = conn.execute(
                    "SELECT revealed_ids FROM read_states WHERE revealed_ids != '[]'"
                ).fetchall()
                for (rids_json,) in rs_rows:
                    try:
                        all_revealed.update(json.loads(rids_json))
                    except Exception:
                        pass
            except Exception:
                pass
            if all_revealed:
                placeholders = ",".join("?" for _ in all_revealed)
                filter_clauses.append(
                    f"(m.message_id <= COALESCE(rs.last_read_id, 0) "
                    f"OR m.message_id IN ({placeholders}))"
                )
                filter_params.extend(list(all_revealed))
            else:
                filter_clauses.append("m.message_id <= COALESCE(rs.last_read_id, 0)")

        filter_sql = ""
        if filter_clauses:
            filter_sql = " AND " + " AND ".join(filter_clauses)

        # --- Build query ---
        all_params: list[Any] = []

        if is_multi_word:
            # Multi-word: all words must appear in the same message (AND logic)
            # Use normalized length for FTS5 check — romaji "suki" normalizes to "すき" (2 chars)
            use_fts = all(len(self._normalize_query(w)) >= 3 for w in words)
            if use_fts:
                match_parts = []
                for w in words:
                    norm_w = self._normalize_query(w)
                    if exact_only:
                        # Exact match only -- literal substring match in original
                        # text, NOT Levenshtein fuzzy search. Skips
                        # pronunciation/reading-based matching via
                        # pykakasi-normalized kana column.
                        match_parts.append(f'{{content}}: "{w.lower()}"')
                    elif _is_romaji(w) and len(w) >= 3:
                        # Search both English content and reading
                        match_parts.append(
                            f'({{content}}: "{w.lower()}" OR '
                            f'{{content content_normalized}}: "{norm_w}")'
                        )
                    else:
                        match_parts.append(
                            f'{{content content_normalized}}: "{norm_w}"'
                        )
                match_expr = " AND ".join(match_parts)
                data_sql = (
                    "SELECT m.message_id, m.content, m.content_normalized, "
                    "m.service, m.group_id, m.group_name, m.member_id, m.member_name, "
                    "m.timestamp, 0 as match_type "
                    "FROM search_fts f "
                    "JOIN search_messages m ON f.rowid = m.rowid "
                    f"{unread_join_sql}"
                    f"WHERE search_fts MATCH ? {filter_sql} "
                    "ORDER BY m.timestamp DESC"
                )
                all_params.append(match_expr)
                all_params.extend(filter_params)
            else:
                # LIKE fallback: each word must match (AND)
                like_clauses: list[str] = []
                for w in words:
                    norm_w = self._normalize_query(w)
                    if exact_only:
                        like_clauses.append("m.content LIKE ?")
                        all_params.append(f"%{w}%")
                    else:
                        like_clauses.append(
                            "(m.content LIKE ? OR m.content_normalized LIKE ?)"
                        )
                        all_params.extend([f"%{w}%", f"%{norm_w}%"])
                all_params.extend(filter_params)
                data_sql = (
                    "SELECT m.message_id, m.content, m.content_normalized, "
                    "m.service, m.group_id, m.group_name, m.member_id, m.member_name, "
                    "m.timestamp, 0 as match_type "
                    f"FROM search_messages m {unread_join_sql} "
                    f"WHERE {' AND '.join(like_clauses)} {filter_sql} "
                    "ORDER BY m.timestamp DESC"
                )
        else:
            # Single-word: existing logic with UNION for alias-expanded terms
            sub_queries: list[str] = []
            for i, term in enumerate(terms):
                norm = normalized_terms[i]
                is_term_romaji = _is_romaji(term)

                if len(norm) >= 3:
                    if exact_only:
                        # Exact match only -- literal substring match in original
                        # text, NOT Levenshtein fuzzy search. Skips
                        # pronunciation/reading-based matching via
                        # pykakasi-normalized kana column.
                        match_expr = f'{{content}}: "{term.lower()}"'
                    else:
                        # Reading match (match_type=1) when romaji, exact (0) otherwise
                        mt = 1 if is_term_romaji else 0
                        match_expr = f'{{content content_normalized}}: "{norm}"'

                    sq_mt = 0 if exact_only else (1 if is_term_romaji else 0)
                    sq = (
                        "SELECT m.message_id, m.content, m.content_normalized, "
                        "m.service, m.group_id, m.group_name, m.member_id, m.member_name, "
                        f"m.timestamp, {sq_mt} as match_type "
                        "FROM search_fts f "
                        f"JOIN search_messages m ON f.rowid = m.rowid {unread_join_sql} "
                        f"WHERE search_fts MATCH ? {filter_sql}"
                    )
                    all_params.append(match_expr)
                    all_params.extend(filter_params)
                    sub_queries.append(sq)

                    # Romaji: also search English text (skip in exact_only mode -- already covered above)
                    if not exact_only and is_term_romaji and len(term) >= 3:
                        en_match = f'{{content}}: "{term.lower()}"'
                        sq_en = (
                            "SELECT m.message_id, m.content, m.content_normalized, "
                            "m.service, m.group_id, m.group_name, m.member_id, m.member_name, "
                            "m.timestamp, 0 as match_type "
                            "FROM search_fts f "
                            f"JOIN search_messages m ON f.rowid = m.rowid {unread_join_sql} "
                            f"WHERE search_fts MATCH ? {filter_sql}"
                        )
                        all_params.append(en_match)
                        all_params.extend(filter_params)
                        sub_queries.append(sq_en)
                else:
                    if exact_only:
                        sq = (
                            "SELECT m.message_id, m.content, m.content_normalized, "
                            "m.service, m.group_id, m.group_name, m.member_id, m.member_name, "
                            "m.timestamp, 0 as match_type "
                            f"FROM search_messages m {unread_join_sql} "
                            f"WHERE m.content LIKE ? {filter_sql}"
                        )
                        all_params.append(f"%{term}%")
                    else:
                        sq = (
                            "SELECT m.message_id, m.content, m.content_normalized, "
                            "m.service, m.group_id, m.group_name, m.member_id, m.member_name, "
                            "m.timestamp, 0 as match_type "
                            f"FROM search_messages m {unread_join_sql} "
                            f"WHERE (m.content LIKE ? OR m.content_normalized LIKE ?) {filter_sql}"
                        )
                        all_params.append(f"%{term}%")
                        all_params.append(f"%{norm}%")
                    all_params.extend(filter_params)
                    sub_queries.append(sq)

            if not sub_queries:
                if content_type == "all":
                    # No message results, but still search blogs
                    blog_results, blog_total = self._search_blogs_sync(
                        query, service, member_id, limit, offset,
                        services=services, member_ids=member_ids,
                        member_filters=member_filters,
                        exact_only=exact_only,
                        date_from=date_from, date_to=date_to,
                    )
                    first_norm = self._normalize_query(query)
                    return {
                        "query": query,
                        "normalized_query": first_norm,
                        "total_count": blog_total,
                        "results": blog_results,
                        "has_more": (offset + limit) < blog_total,
                    }
                return {
                    "query": query,
                    "normalized_query": "",
                    "total_count": 0,
                    "results": [],
                    "has_more": False,
                }

            union_sql = " UNION ALL ".join(sub_queries)
            data_sql = (
                f"SELECT message_id, content, content_normalized, service, group_id, group_name, "
                f"member_id, member_name, timestamp, MIN(match_type) as match_type "
                f"FROM ({union_sql}) "
                f"GROUP BY message_id "
                f"ORDER BY match_type, timestamp DESC"
            )

        # --- Execute with count + pagination ---
        count_sql = f"SELECT COUNT(*) FROM ({data_sql})"
        count_params = list(all_params)
        try:
            row = conn.execute(count_sql, count_params).fetchone()
            total_count = row[0] if row else 0
        except Exception as e:
            logger.warning("Search count query failed", error=str(e))
            total_count = 0

        page_sql = f"{data_sql} LIMIT ? OFFSET ?"
        page_params = list(all_params) + [limit, offset]

        try:
            rows = conn.execute(page_sql, page_params).fetchall()
        except Exception as e:
            logger.warning("Search query failed", error=str(e))
            rows = []

        # --- Build results ---
        first_term = words[0] if is_multi_word else query
        first_norm = self._normalize_query(first_term)
        query_is_romaji = _is_romaji(first_term)
        query_info: Dict[str, Any] = {
            "first_term": first_term,
            "first_norm": first_norm,
            "query_is_romaji": query_is_romaji,
            "is_multi_word": is_multi_word,
            "words": words,
            "exact_only": exact_only,
        }
        results: list[Dict[str, Any]] = [
            self._build_message_result_dict(r, query_info) for r in rows
        ]

        # Sort results: exact matches first.  Stable sort preserves the
        # original SQL timestamp-DESC ordering within each group.
        results.sort(key=lambda x: 0 if x["match_type"] == "exact" else 1)

        # revealed_ids are now handled in SQL via the unread filter clause
        # (OR m.message_id IN (...)) so no post-processing needed.

        # Tag results with is_group_chat based on distinct member count per
        # (service, group_id).  group_id is NOT unique across services, so we
        # must include service in the grouping to avoid false positives.
        if results:
            self._tag_is_group_chat(results, conn)

        # --- Merge blog results for "all" content_type ---
        if content_type == "all":
            # Deferred-snippet merge: fetch lightweight rows first, sort,
            # paginate, then compute expensive snippets only for the page.

            # 1. Fetch ALL lightweight blog rows (no snippet computation)
            raw_blog_results, blog_total = self._search_blogs_sync(
                query, service, member_id, limit=0, offset=0,
                services=services, member_ids=member_ids,
                member_filters=member_filters,
                exact_only=exact_only,
                date_from=date_from, date_to=date_to,
                raw_rows_only=True,
            )

            # 2. Fetch ALL lightweight message rows (raw DB tuples)
            try:
                all_msg_rows = conn.execute(data_sql, list(all_params)).fetchall()
            except Exception as e:
                logger.warning("Search full query failed for merge", error=str(e))
                all_msg_rows = rows  # fall back to paginated results

            # 3. Build unified lightweight sort list:
            #    (match_type_int, sort_timestamp, source_type, raw_data)
            #    raw_data is a DB row tuple for messages, a raw dict for blogs
            combined_lightweight: list[Tuple[int, str, str, Any]] = []
            for r in all_msg_rows:
                ts = r[8] or ""  # timestamp column
                # match_type column is at index 9 in the SQL result
                # 0=exact, 1=reading from SQL
                mt = r[9] if len(r) > 9 else 0
                combined_lightweight.append((mt, ts, "message", r))
            for b in raw_blog_results:
                ts = b.get("published_at", "") or ""
                mt = 0 if b.get("match_type") == "exact" else 1
                combined_lightweight.append((mt, ts, "blog", b))

            # 4. Sort: match_type ASC (exact=0 first), then timestamp DESC
            #    Use Python's stable sort: sort by secondary key first,
            #    then primary key.
            combined_lightweight.sort(key=lambda x: x[1], reverse=True)  # timestamp DESC
            combined_lightweight.sort(key=lambda x: x[0])  # match_type ASC (stable)

            combined_total = len(combined_lightweight)

            # 5. Paginate (slice)
            if limit > 0:
                page_items = combined_lightweight[offset:offset + limit]
            else:
                page_items = combined_lightweight

            # 6. Build full result dicts with snippets ONLY for the page
            paginated: list[Dict[str, Any]] = []
            for _mt, _ts, source_type, raw_data in page_items:
                if source_type == "message":
                    paginated.append(
                        self._build_message_result_dict(raw_data, query_info)
                    )
                else:
                    # raw_data is a lightweight blog dict — compute snippet now
                    blog_item = raw_data
                    snippet = self._make_blog_snippet(
                        blog_item["title"],
                        blog_item.get("content", ""),
                        query,
                        content_normalized=blog_item.get("content_normalized", ""),
                        title_normalized=blog_item.get("title_normalized", ""),
                    )
                    paginated.append({
                        "result_type": "blog",
                        "blog_id": blog_item["blog_id"],
                        "title": blog_item["title"],
                        "snippet": snippet,
                        "service": blog_item["service"],
                        "member_id": blog_item["member_id"],
                        "member_name": blog_item["member_name"],
                        "published_at": blog_item["published_at"],
                        "blog_url": blog_item["blog_url"],
                        "match_type": blog_item.get("match_type", "reading"),
                    })

            # Tag message results with is_group_chat
            msg_results = [r for r in paginated if r.get("result_type") == "message"]
            if msg_results:
                self._tag_is_group_chat(msg_results, conn)

            return {
                "query": query,
                "normalized_query": first_norm,
                "total_count": combined_total,
                "results": paginated,
                "has_more": (offset + (limit if limit > 0 else combined_total)) < combined_total,
            }

        # --- Messages-only return (content_type == "messages") ---
        return {
            "query": query,
            "normalized_query": first_norm,
            "total_count": total_count,
            "results": results,
            "has_more": (offset + limit) < total_count,
        }

    # ------------------------------------------------------------------
    # Service resolution
    # ------------------------------------------------------------------

    def _resolve_service_id(self, display_name: str) -> Optional[str]:
        """Map service display name to service identifier."""
        try:
            return get_service_identifier(display_name)
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Index building (sync, runs in executor)
    # ------------------------------------------------------------------

    def _build_full_index_sync(self) -> int:
        self._building = True
        count = 0
        try:
            output_dir = get_output_dir()
            if not output_dir.exists():
                logger.warning("Output directory does not exist, skipping index build", path=str(output_dir))
                return 0

            conn = self._get_conn()
            batch: list[Tuple[Any, ...]] = []

            for service_dir in output_dir.iterdir():
                if not service_dir.is_dir():
                    continue

                service_id = get_service_identifier(service_dir.name)
                if service_id is None:
                    continue

                messages_dir = service_dir / "messages"
                if not messages_dir.exists():
                    continue

                for group_dir in messages_dir.iterdir():
                    if not group_dir.is_dir():
                        continue

                    parts = group_dir.name.split(" ", 1)
                    if len(parts) != 2:
                        continue
                    try:
                        gid = int(parts[0])
                    except ValueError:
                        continue
                    g_name = parts[1]

                    for member_dir in group_dir.iterdir():
                        if not member_dir.is_dir():
                            continue

                        m_parts = member_dir.name.split(" ", 1)
                        if len(m_parts) != 2:
                            continue
                        try:
                            mid = int(m_parts[0])
                        except ValueError:
                            continue
                        m_name = m_parts[1]

                        msg_file = member_dir / "messages.json"
                        if not msg_file.exists():
                            continue

                        try:
                            with open(msg_file, "r", encoding="utf-8") as f:
                                data = json.load(f)
                        except Exception as e:
                            logger.warning("Failed to read messages file for indexing", path=str(msg_file), error=str(e))
                            continue

                        for msg in data.get("messages", []):
                            content = msg.get("content")
                            if content is None:
                                continue
                            normalized = self._normalize_with_readings(content)
                            batch.append((
                                msg.get("id"),
                                service_id,
                                gid,
                                g_name,
                                mid,
                                m_name,
                                msg.get("timestamp"),
                                content,
                                normalized,
                            ))
                            if len(batch) >= _BATCH_SIZE:
                                conn.executemany(
                                    "INSERT OR REPLACE INTO search_messages "
                                    "(message_id, service, group_id, group_name, member_id, member_name, "
                                    "timestamp, content, content_normalized) "
                                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                    batch,
                                )
                                conn.commit()
                                count += len(batch)
                                batch.clear()

            if batch:
                conn.executemany(
                    "INSERT OR REPLACE INTO search_messages "
                    "(message_id, service, group_id, group_name, member_id, member_name, "
                    "timestamp, content, content_normalized) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    batch,
                )
                conn.commit()
                count += len(batch)
                batch.clear()

            blog_count = self._build_blog_index_sync()

            now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                "INSERT OR REPLACE INTO search_meta (key, value) VALUES (?, ?)",
                ("last_full_build", now),
            )
            conn.execute(
                "INSERT OR REPLACE INTO search_meta (key, value) VALUES (?, ?)",
                ("index_message_count", str(count)),
            )
            conn.execute(
                "INSERT OR REPLACE INTO search_meta (key, value) VALUES (?, ?)",
                ("index_blog_count", str(blog_count)),
            )
            conn.execute(
                "INSERT OR REPLACE INTO search_meta (key, value) VALUES (?, ?)",
                ("schema_version", "1"),
            )
            conn.commit()
            logger.info("Full search index built", count=count, blog_count=blog_count)
        finally:
            self._building = False
        return count

    def _build_blog_index_sync(self) -> int:
        """Index blog content from output/{service_display}/blogs/ directories."""
        output_dir = get_output_dir()
        if not output_dir.exists():
            return 0

        conn = self._get_conn()
        count = 0
        batch: list[Tuple[Any, ...]] = []

        for service_dir in output_dir.iterdir():
            if not service_dir.is_dir():
                continue

            service_id = self._resolve_service_id(service_dir.name)
            if service_id is None:
                continue

            blogs_dir = service_dir / "blogs"
            if not blogs_dir.exists():
                continue

            index_file = blogs_dir / "index.json"
            if not index_file.exists():
                continue

            try:
                with open(index_file, "r", encoding="utf-8") as f:
                    index_data = json.load(f)
            except Exception as e:
                logger.warning(
                    "Failed to read blog index.json",
                    path=str(index_file),
                    error=str(e),
                )
                continue

            members = index_data.get("members", {})
            for member_id_str, member_info in members.items():
                if member_info.get("blogs_removed", False):
                    continue

                try:
                    member_id = int(member_id_str)
                except ValueError:
                    continue

                member_name = member_info.get("name", "")
                blog_entries = member_info.get("blogs", [])

                for entry in blog_entries:
                    blog_id = entry.get("id")
                    if blog_id is None:
                        continue

                    published_at = entry.get("published_at", "")
                    # Derive date prefix from published_at for directory lookup
                    # Format: YYYYMMDD from ISO timestamp like "2026-01-17T22:21:00+09:00"
                    date_prefix = ""
                    if published_at:
                        try:
                            date_prefix = published_at[:10].replace("-", "")
                        except Exception:
                            pass

                    blog_dir = blogs_dir / member_name / f"{date_prefix}_{blog_id}"
                    blog_json_path = blog_dir / "blog.json"

                    if not blog_json_path.exists():
                        continue

                    try:
                        with open(blog_json_path, "r", encoding="utf-8") as f:
                            blog_data = json.load(f)
                    except Exception as e:
                        logger.warning(
                            "Failed to read blog.json",
                            path=str(blog_json_path),
                            error=str(e),
                        )
                        continue

                    meta = blog_data.get("meta", {})
                    content_obj = blog_data.get("content", {})
                    html_content = content_obj.get("html", "")

                    title = meta.get("title", entry.get("title", ""))
                    blog_url = meta.get("url", entry.get("url", ""))

                    # Strip HTML and normalize
                    plain_content = _strip_html(html_content)
                    content_normalized = self._normalize_with_readings(plain_content)
                    title_normalized = self._normalize_with_readings(title) if title else ""

                    batch.append((
                        str(blog_id),
                        service_id,
                        member_id,
                        member_name,
                        title,
                        title_normalized,
                        published_at,
                        blog_url,
                        plain_content,
                        content_normalized,
                    ))

                    if len(batch) >= _BATCH_SIZE:
                        conn.executemany(
                            "INSERT OR REPLACE INTO search_blogs "
                            "(blog_id, service, member_id, member_name, title, title_normalized, "
                            "published_at, blog_url, content, content_normalized) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            batch,
                        )
                        conn.commit()
                        count += len(batch)
                        batch.clear()

        if batch:
            conn.executemany(
                "INSERT OR REPLACE INTO search_blogs "
                "(blog_id, service, member_id, member_name, title, title_normalized, "
                "published_at, blog_url, content, content_normalized) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                batch,
            )
            conn.commit()
            count += len(batch)
            batch.clear()

        logger.info("Blog index built", blog_count=count)
        return count

    def _index_members_sync(self, members: List[Tuple[Dict, Dict]], service: str) -> int:
        """Incrementally index only NEW messages for members that changed.

        Queries the max indexed message_id per member and only processes
        messages with a higher ID, avoiding redundant pykakasi calls.
        """
        conn = self._get_conn()
        output_dir = get_output_dir()
        if not output_dir.exists():
            return 0

        service_display = get_service_display_name(service)
        count = 0
        batch: list[Tuple[Any, ...]] = []

        for group_dict, member_dict in members:
            gid = group_dict.get("id")
            g_name = group_dict.get("name", "")
            mid = member_dict.get("id")
            m_name = member_dict.get("name", "")

            # Find the highest message_id already indexed for this member
            row = conn.execute(
                "SELECT MAX(message_id) FROM search_messages "
                "WHERE service = ? AND group_id = ? AND member_id = ?",
                (service, gid, mid),
            ).fetchone()
            max_indexed_id = row[0] if row and row[0] is not None else 0

            group_dir_name = f"{gid} {g_name}"
            member_dir_name = f"{mid} {m_name}"
            msg_file = output_dir / service_display / "messages" / group_dir_name / member_dir_name / "messages.json"

            if not msg_file.exists():
                continue

            try:
                with open(msg_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                logger.warning("Failed to read messages for incremental index", path=str(msg_file), error=str(e))
                continue

            for msg in data.get("messages", []):
                msg_id = msg.get("id")
                if msg_id is None:
                    continue
                # Skip messages already indexed
                if msg_id <= max_indexed_id:
                    continue
                content = msg.get("content")
                if content is None:
                    continue
                normalized = self._normalize_with_readings(content)
                batch.append((
                    msg_id,
                    service,
                    gid,
                    g_name,
                    mid,
                    m_name,
                    msg.get("timestamp"),
                    content,
                    normalized,
                ))
                if len(batch) >= _BATCH_SIZE:
                    conn.executemany(
                        "INSERT OR REPLACE INTO search_messages "
                        "(message_id, service, group_id, group_name, member_id, member_name, "
                        "timestamp, content, content_normalized) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        batch,
                    )
                    conn.commit()
                    count += len(batch)
                    batch.clear()

        if batch:
            conn.executemany(
                "INSERT OR REPLACE INTO search_messages "
                "(message_id, service, group_id, group_name, member_id, member_name, "
                "timestamp, content, content_normalized) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                batch,
            )
            conn.commit()
            count += len(batch)

        logger.info("Incremental index update", service=service, new_messages=count)
        return count

    def _index_blogs_for_service_sync(self, service: str) -> int:
        """Incrementally index new cached blogs for a single service.

        Only processes blogs not already present in the index, avoiding
        expensive pykakasi normalization of already-indexed content.
        """
        conn = self._get_conn()
        output_dir = get_output_dir()
        if not output_dir.exists():
            return 0

        # Find the service display directory
        service_dir = None
        for d in output_dir.iterdir():
            if d.is_dir() and self._resolve_service_id(d.name) == service:
                service_dir = d
                break
        if not service_dir:
            return 0

        blogs_dir = service_dir / "blogs"
        if not blogs_dir.is_dir():
            return 0

        index_path = blogs_dir / "index.json"
        if not index_path.exists():
            return 0
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                index_data = json.load(f)
        except Exception:
            return 0

        # Get already-indexed blog IDs for this service to skip them
        existing_ids: set[str] = set()
        for row in conn.execute(
            "SELECT blog_id FROM search_blogs WHERE service = ?", (service,)
        ):
            existing_ids.add(row[0])

        total = 0
        batch: list[Tuple[Any, ...]] = []
        members = index_data.get("members", {})

        for member_id_str, member_info in members.items():
            if member_info.get("blogs_removed", False):
                continue
            try:
                member_id = int(member_id_str)
            except ValueError:
                continue

            member_name = member_info.get("name", "")
            member_dir = blogs_dir / member_name
            if not member_dir.is_dir():
                continue

            for entry in member_info.get("blogs", []):
                blog_id = entry.get("id")
                if blog_id is None:
                    continue

                # Skip already-indexed blogs
                if str(blog_id) in existing_ids:
                    continue

                published_at = entry.get("published_at", "")
                date_prefix = ""
                if published_at:
                    try:
                        date_prefix = published_at[:10].replace("-", "")
                    except Exception:
                        pass

                blog_json_path = member_dir / f"{date_prefix}_{blog_id}" / "blog.json"
                if not blog_json_path.exists():
                    continue

                try:
                    with open(blog_json_path, "r", encoding="utf-8") as f:
                        blog_data = json.load(f)
                except Exception:
                    continue

                html_content = blog_data.get("content", {}).get("html", "")
                if not html_content:
                    continue

                meta = blog_data.get("meta", {})
                title = meta.get("title", entry.get("title", ""))
                blog_url = meta.get("url", entry.get("url", ""))
                plain_content = _strip_html(html_content)
                content_normalized = self._normalize_with_readings(plain_content)
                title_normalized = self._normalize_with_readings(title) if title else ""

                batch.append((
                    str(blog_id), service, member_id, member_name,
                    title, title_normalized, published_at, blog_url,
                    plain_content, content_normalized,
                ))
                if len(batch) >= _BATCH_SIZE:
                    conn.executemany(
                        "INSERT OR REPLACE INTO search_blogs "
                        "(blog_id, service, member_id, member_name, title, title_normalized, "
                        "published_at, blog_url, content, content_normalized) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        batch,
                    )
                    conn.commit()
                    total += len(batch)
                    batch.clear()

        if batch:
            conn.executemany(
                "INSERT OR REPLACE INTO search_blogs "
                "(blog_id, service, member_id, member_name, title, title_normalized, "
                "published_at, blog_url, content, content_normalized) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                batch,
            )
            conn.commit()
            total += len(batch)

        logger.info("Blog index updated for service", service=service, new_blogs=total)
        return total

    def _get_status_sync(self) -> Dict[str, Any]:
        conn = self._get_conn()
        row = conn.execute("SELECT COUNT(*) FROM search_messages").fetchone()
        indexed_count = row[0] if row else 0

        row = conn.execute("SELECT COUNT(*) FROM search_blogs").fetchone()
        blog_indexed_count = row[0] if row else 0

        last_build = None
        row = conn.execute("SELECT value FROM search_meta WHERE key = 'last_full_build'").fetchone()
        if row:
            last_build = row[0]

        schema_version = None
        row = conn.execute("SELECT value FROM search_meta WHERE key = 'schema_version'").fetchone()
        if row:
            schema_version = row[0]

        db_size = 0
        if self._db_path.exists():
            db_size = self._db_path.stat().st_size

        return {
            "indexed_count": indexed_count,
            "blog_indexed_count": blog_indexed_count,
            "last_build": last_build,
            "schema_version": schema_version,
            "is_building": self._building,
            "db_size_bytes": db_size,
        }

    def _rebuild_sync(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None
        if self._db_path.exists():
            self._db_path.unlink()
        self._build_full_index_sync()

    # ------------------------------------------------------------------
    # Read states
    # ------------------------------------------------------------------

    def _get_all_read_states_sync(self) -> Dict[str, Any]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT service, group_id, member_id, last_read_id, read_count, revealed_ids, updated_at "
            "FROM read_states"
        ).fetchall()
        result = {}
        for r in rows:
            key = f"{r[0]}/{r[1]}/{r[2]}"
            result[key] = {
                "service": r[0],
                "group_id": r[1],
                "member_id": r[2],
                "last_read_id": r[3],
                "read_count": r[4],
                "revealed_ids": json.loads(r[5]) if r[5] else [],
                "updated_at": r[6],
            }
        return result

    def _upsert_read_state_sync(
        self,
        service: str,
        group_id: int,
        member_id: int,
        last_read_id: int,
        read_count: int,
        revealed_ids: List[int],
    ) -> None:
        conn = self._get_conn()
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO read_states (service, group_id, member_id, last_read_id, read_count, revealed_ids, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(service, group_id, member_id) DO UPDATE SET "
            "last_read_id=excluded.last_read_id, read_count=excluded.read_count, "
            "revealed_ids=excluded.revealed_ids, updated_at=excluded.updated_at",
            (service, group_id, member_id, last_read_id, read_count, json.dumps(revealed_ids), now),
        )
        conn.commit()

    def _batch_upsert_read_states_sync(self, entries: List[Dict[str, Any]]) -> int:
        conn = self._get_conn()
        now = datetime.now(timezone.utc).isoformat()
        count = 0
        for i in range(0, len(entries), _BATCH_SIZE):
            batch = entries[i : i + _BATCH_SIZE]
            for entry in batch:
                conn.execute(
                    "INSERT INTO read_states (service, group_id, member_id, last_read_id, read_count, revealed_ids, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(service, group_id, member_id) DO UPDATE SET "
                    "last_read_id=excluded.last_read_id, read_count=excluded.read_count, "
                    "revealed_ids=excluded.revealed_ids, updated_at=excluded.updated_at",
                    (
                        entry["service"],
                        entry["group_id"],
                        entry["member_id"],
                        entry.get("last_read_id", 0),
                        entry.get("read_count", 0),
                        json.dumps(entry.get("revealed_ids", [])),
                        now,
                    ),
                )
                count += 1
            conn.commit()
        return count

    # ------------------------------------------------------------------
    # Members list (sync, runs in executor)
    # ------------------------------------------------------------------

    def _get_members_sync(self) -> Dict[str, Any]:
        """Get all indexed members and services for the filter autocomplete."""
        conn = self._get_conn()

        # Members
        member_rows = conn.execute(
            "SELECT service, group_id, group_name, member_id, member_name, COUNT(*) as message_count "
            "FROM ("
            "  SELECT service, group_id, group_name, member_id, member_name FROM search_messages "
            "  UNION ALL "
            "  SELECT service, 0 as group_id, member_name as group_name, member_id, member_name FROM search_blogs"
            ") "
            "GROUP BY service, member_id "
            "ORDER BY service, member_name"
        ).fetchall()

        members = [
            {
                "service": r[0],
                "group_id": r[1],
                "group_name": r[2],
                "member_id": r[3],
                "member_name": r[4],
                "message_count": r[5],
            }
            for r in member_rows
        ]

        # Services
        service_rows = conn.execute(
            "SELECT service, COUNT(DISTINCT member_id) as member_count, COUNT(*) as message_count "
            "FROM ("
            "  SELECT service, member_id FROM search_messages "
            "  UNION ALL "
            "  SELECT service, member_id FROM search_blogs"
            ") "
            "GROUP BY service "
            "ORDER BY service"
        ).fetchall()

        services = [
            {
                "service": r[0],
                "member_count": r[1],
                "message_count": r[2],
            }
            for r in service_rows
        ]

        return {"members": members, "services": services}

    def _check_missing_services_sync(self) -> set:
        """Check for services in output dir not yet in the search index."""
        conn = self._get_conn()

        indexed_services: set[str] = set()
        for row in conn.execute("SELECT DISTINCT service FROM search_messages"):
            indexed_services.add(row[0])
        for row in conn.execute("SELECT DISTINCT service FROM search_blogs"):
            indexed_services.add(row[0])

        output_dir = get_output_dir()
        if not output_dir.exists():
            return set()

        available_services: set[str] = set()
        for d in output_dir.iterdir():
            if d.is_dir() and (d / "messages").exists():
                sid = self._resolve_service_id(d.name)
                if sid:
                    available_services.add(sid)

        return available_services - indexed_services

    # ------------------------------------------------------------------
    # Public async API
    # ------------------------------------------------------------------

    def _needs_build(self) -> bool:
        """Check if the index needs a full build (missing DB or incomplete previous build).

        Uses a separate short-lived connection to avoid thread-affinity issues
        with the main ``_conn`` (which lives in the executor thread).
        """
        if not self._db_path.exists():
            return True
        try:
            conn = sqlite3.connect(str(self._db_path))
            try:
                row = conn.execute("SELECT value FROM search_meta WHERE key = 'last_full_build'").fetchone()
                return row is None
            finally:
                conn.close()
        except Exception:
            return True

    async def search(
        self,
        query: str,
        service: Optional[str] = None,
        group_id: Optional[int] = None,
        member_id: Optional[int] = None,
        limit: int = 50,
        offset: int = 0,
        *,
        services: Optional[List[str]] = None,
        member_ids: Optional[List[int]] = None,
        member_filters: Optional[List[tuple]] = None,
        exact_only: bool = False,
        exclude_unread: bool = False,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        content_type: str = "all",
    ) -> Dict[str, Any]:
        if self._needs_build():
            await self.build_full_index()
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            self._executor,
            lambda: self._search_sync(
                query, service, group_id, member_id, limit, offset,
                services=services, member_ids=member_ids,
                member_filters=member_filters,
                exact_only=exact_only, exclude_unread=exclude_unread,
                date_from=date_from, date_to=date_to,
                content_type=content_type,
            ),
        )

    async def build_full_index(self) -> int:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, self._build_full_index_sync)

    async def index_members(self, members: List[Tuple[Dict, Dict]], service: str) -> int:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, self._index_members_sync, members, service)

    async def index_blogs_for_service(self, service: str) -> int:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, self._index_blogs_for_service_sync, service)

    async def get_status(self) -> Dict[str, Any]:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, self._get_status_sync)

    async def rebuild(self) -> None:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(self._executor, self._rebuild_sync)

    async def get_all_read_states(self) -> Dict[str, Any]:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, self._get_all_read_states_sync)

    async def upsert_read_state(
        self, service: str, group_id: int, member_id: int,
        last_read_id: int, read_count: int, revealed_ids: List[int],
    ) -> None:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            self._executor, self._upsert_read_state_sync,
            service, group_id, member_id, last_read_id, read_count, revealed_ids,
        )

    async def batch_upsert_read_states(self, entries: List[Dict[str, Any]]) -> int:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, self._batch_upsert_read_states_sync, entries)

    async def get_members(self) -> Dict[str, Any]:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(self._executor, self._get_members_sync)
        # Check for unindexed services and trigger rebuild if needed
        missing = await loop.run_in_executor(
            self._executor, self._check_missing_services_sync
        )
        if missing and not self._building:
            logger.info(
                "Found unindexed services, triggering rebuild",
                missing=list(missing),
            )
            asyncio.create_task(self.build_full_index())
        return result


# ------------------------------------------------------------------
# Singleton
# ------------------------------------------------------------------

_search_service: Optional[SearchService] = None


def get_search_service() -> SearchService:
    global _search_service
    if _search_service is None:
        db_path = get_app_data_dir() / "search_index.db"
        _search_service = SearchService(db_path)
    return _search_service
