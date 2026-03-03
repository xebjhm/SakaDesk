"""Search service for Japanese fuzzy search over synced message content."""
import asyncio
import json
import sqlite3
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
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
"""

_BATCH_SIZE = 500


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
    ) -> Dict[str, Any]:
        conn = self._get_conn()

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

        # Detect romaji: ASCII Latin input that normalizes to different hiragana
        def _is_romaji(term: str) -> bool:
            return (term.isascii()
                    and any(c.isalpha() for c in term)
                    and self._normalize_query(term) != term.lower())

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
        results: list[Dict[str, Any]] = []
        for r in rows:
            content = r[1] or ""
            content_norm = r[2] or ""
            lower_content = content.lower()

            # Compute match_type in Python: checks if original query text
            # appears literally in content.  More accurate than SQL match_type
            # for the LIKE fallback path where SQL always returns 0.
            if exact_only:
                # In exact_only mode, all results are "exact" by definition
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
            results.append({
                "message_id": r[0],
                "content": content,
                "snippet": snippet,
                "service": r[3],
                "group_id": r[4],
                "group_name": r[5],
                "member_id": r[6],
                "member_name": r[7],
                "timestamp": r[8],
                "type": "text",
                "match_type": match_type,
            })

        # Sort results: exact matches first.  Stable sort preserves the
        # original SQL timestamp-DESC ordering within each group.
        results.sort(key=lambda x: 0 if x["match_type"] == "exact" else 1)

        # revealed_ids are now handled in SQL via the unread filter clause
        # (OR m.message_id IN (...)) so no post-processing needed.

        # Tag results with is_group_chat based on distinct member count per
        # (service, group_id).  group_id is NOT unique across services, so we
        # must include service in the grouping to avoid false positives.
        if results:
            group_ids = list({r["group_id"] for r in results})
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
                r["is_group_chat"] = (r["service"], r["group_id"]) in group_chat_set

        return {
            "query": query,
            "normalized_query": first_norm,
            "total_count": total_count,
            "results": results,
            "has_more": (offset + limit) < total_count,
        }

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
                ("schema_version", "1"),
            )
            conn.commit()
            logger.info("Full search index built", count=count)
        finally:
            self._building = False
        return count

    def _index_members_sync(self, members: List[Tuple[Dict, Dict]], service: str) -> int:
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
                content = msg.get("content")
                if content is None:
                    continue
                normalized = self._normalize_with_readings(content)
                batch.append((
                    msg.get("id"),
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

        logger.info("Incremental index update", service=service, count=count)
        return count

    def _get_status_sync(self) -> Dict[str, Any]:
        conn = self._get_conn()
        row = conn.execute("SELECT COUNT(*) FROM search_messages").fetchone()
        indexed_count = row[0] if row else 0

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
            "FROM search_messages "
            "GROUP BY service, group_id, member_id "
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
            "FROM search_messages "
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
            ),
        )

    async def build_full_index(self) -> int:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, self._build_full_index_sync)

    async def index_members(self, members: List[Tuple[Dict, Dict]], service: str) -> int:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, self._index_members_sync, members, service)

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
        return await loop.run_in_executor(self._executor, self._get_members_sync)


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
