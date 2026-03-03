# Blog Search Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add blog content to the existing global search (Cmd+K), so users can search across both messages and blog posts in a unified experience.

**Architecture:** Separate `search_blogs` + `search_blogs_fts` tables in the existing search index DB. HTML stripped to plain text at index time, normalized with pykakasi like messages. Search queries UNION both tables. Frontend renders blog results with title + snippet + type badge in the same unified list.

**Tech Stack:** SQLite FTS5 trigram, pykakasi, Python regex for HTML stripping, React + Zustand + Tailwind

**Design doc:** `docs/plans/2026-03-03-blog-search-design.md`

---

## Task 1: Backend — Blog Schema, HTML Stripping, and Blog Indexing

**Files:**
- Modify: `backend/services/search_service.py`

**Context:**
- The existing schema is defined in `_SCHEMA_SQL` (lines 25-85). It creates `search_messages`, `search_fts`, triggers, indices, `search_meta`, and `read_states`.
- The full index build is `_build_full_index_sync` (lines 806-924), which walks `output/{service}/messages/` dirs, reads `messages.json`, normalizes content, and batch-inserts into `search_messages`.
- Blog data lives at `output/{service_display}/blogs/{member_name}/{YYYYMMDD}_{blog_id}/blog.json`. Each blog.json has: `meta.id`, `meta.member_name`, `meta.title`, `meta.published_at`, `meta.url`, `content.html`.
- The blog index.json at `output/{service_display}/blogs/index.json` has `members[member_id].name` and `members[member_id].blogs[].id/.title/.published_at`.

**Step 1: Add blog tables and triggers to `_SCHEMA_SQL`**

After the existing `read_states` table (line 84), add:

```sql
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
```

**Step 2: Add `_strip_html` utility method**

Add as a module-level function near the top of the file (after the imports, around line 20):

```python
import re
from html import unescape

def _strip_html(html: str) -> str:
    """Strip HTML tags, decode entities, collapse whitespace."""
    text = re.sub(r'<[^>]+>', ' ', html)
    text = unescape(text)
    return re.sub(r'\s+', ' ', text).strip()
```

Note: `re` is already imported. `unescape` from `html` is new — add to imports.

**Step 3: Add `_build_blog_index_sync` method to `SearchService`**

Add after `_build_full_index_sync` (after line 924). This method walks blog directories, reads `blog.json` files, strips HTML, normalizes, and batch-inserts:

```python
def _build_blog_index_sync(self) -> int:
    """Index all cached blog posts. Called after message indexing."""
    conn = self._get_conn()
    output_dir = self._output_dir

    total = 0
    batch: list[tuple] = []

    for service_dir in output_dir.iterdir():
        if not service_dir.is_dir():
            continue
        blogs_dir = service_dir / "blogs"
        if not blogs_dir.is_dir():
            continue

        # Determine service identifier from display name
        service_id = self._resolve_service_id(service_dir.name)
        if not service_id:
            continue

        # Load index.json for member metadata
        index_path = blogs_dir / "index.json"
        if not index_path.exists():
            continue
        try:
            index_data = json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            continue

        members = index_data.get("members", {})

        for member_id_str, member_info in members.items():
            member_name = member_info.get("name", "")
            member_id = int(member_id_str)
            if member_info.get("blogs_removed"):
                continue

            member_dir = blogs_dir / member_name
            if not member_dir.is_dir():
                continue

            for blog_entry in member_info.get("blogs", []):
                blog_id = blog_entry.get("id")
                if not blog_id:
                    continue

                # Find cached blog.json
                published = blog_entry.get("published_at", "")
                date_prefix = published[:10].replace("-", "") if published else ""
                cache_dir = member_dir / f"{date_prefix}_{blog_id}"
                blog_json_path = cache_dir / "blog.json"

                if not blog_json_path.exists():
                    continue

                try:
                    blog_data = json.loads(blog_json_path.read_text(encoding="utf-8"))
                except Exception:
                    continue

                html_content = blog_data.get("content", {}).get("html", "")
                if not html_content:
                    continue

                meta = blog_data.get("meta", {})
                title = meta.get("title", "")
                plain_text = _strip_html(html_content)

                title_normalized = self._normalize_with_readings(title) if title else ""
                content_normalized = self._normalize_with_readings(plain_text)

                batch.append((
                    blog_id,
                    service_id,
                    member_id,
                    member_name,
                    title,
                    title_normalized,
                    meta.get("published_at", ""),
                    meta.get("url", ""),
                    plain_text,
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

    logger.info("Blog indexing complete", blog_count=total)
    return total
```

**Step 4: Add `_resolve_service_id` helper**

The blog directories use display names like `日向坂46`, but the search index stores service identifiers like `hinatazaka46`. Add a helper that maps display name → service ID. Place it in the SearchService class:

```python
def _resolve_service_id(self, display_name: str) -> Optional[str]:
    """Map service display name to service identifier."""
    try:
        from backend.services.service_utils import get_service_identifier
        return get_service_identifier(display_name)
    except Exception:
        return None
```

Note: `get_service_identifier` already exists in `backend/services/service_utils.py` (lines 23-42) and does exactly this reverse lookup.

**Step 5: Call `_build_blog_index_sync` from `_build_full_index_sync`**

At the end of `_build_full_index_sync`, just before the final `logger.info` and metadata update (around line 920), add:

```python
# Index blog posts (cached only)
blog_count = self._build_blog_index_sync()
```

And include `blog_count` in the log message.

**Step 6: Add `_rebuild_sync` blog cleanup**

In `_rebuild_sync` (around line 1028), the method deletes and rebuilds the DB. No extra work needed — the schema re-creation will create blog tables, and `_build_full_index_sync` now calls `_build_blog_index_sync`.

**Verification:**

```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk
uv run python -c "
from backend.services.search_service import get_search_service
import asyncio
svc = get_search_service()
asyncio.run(svc.rebuild())
status = asyncio.run(svc.get_status())
print(status)
"
```

Expected: Rebuild completes, status shows indexed_count for messages. Blog rows should appear in the DB.

**Commit:**
```bash
git add backend/services/search_service.py
git commit -m "feat(search): add blog schema, HTML stripping, and blog indexing"
```

---

## Task 2: Backend — Blog Search Queries (UNION)

**Files:**
- Modify: `backend/services/search_service.py`

**Context:**
- `_search_sync` (lines 418-800) builds SQL queries, executes them, processes results with snippets, and returns a dict.
- The method handles: multi-word queries, single-word queries with alias expansion, nickname resolution, filters, pagination, and match_type classification.
- We need to add a parallel blog search path and UNION the results.

**Step 1: Add `content_type` parameter to `_search_sync`**

Extend the method signature (line 418) to accept `content_type: str = "all"`:

```python
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
```

**Step 2: Add blog search method `_search_blogs_sync`**

Create a new method that queries `search_blogs_fts` / `search_blogs` with the same query logic as messages but adapted for blog columns. Place it after the existing `_search_sync` method.

The blog search needs to:
1. Build filter clauses for blogs (service, member_id, date range — no group_id, no unread filter).
2. For queries >= 3 chars: FTS5 MATCH on `{title title_normalized content content_normalized}`.
3. For queries < 3 chars: LIKE fallback on title + content + their normalized versions.
4. Generate snippets (prefer title match, fallback to content match).
5. Return results with `result_type: "blog"`.

```python
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
) -> tuple[list[dict], int]:
    """Search blog posts. Returns (results, total_count)."""
    conn = self._get_conn()
    norm = self._normalize_query(query)

    # Blog filter clauses
    filter_clauses: list[str] = []
    filter_params: list[Any] = []
    if service:
        filter_clauses.append("b.service = ?")
        filter_params.append(service)
    if member_id:
        filter_clauses.append("b.member_id = ?")
        filter_params.append(member_id)
    if services:
        ph = ",".join("?" for _ in services)
        filter_clauses.append(f"b.service IN ({ph})")
        filter_params.extend(services)
    if member_ids:
        ph = ",".join("?" for _ in member_ids)
        filter_clauses.append(f"b.member_id IN ({ph})")
        filter_params.extend(member_ids)
    if member_filters:
        or_parts = []
        for svc_id, mid in member_filters:
            or_parts.append("(b.service = ? AND b.member_id = ?)")
            filter_params.extend([svc_id, mid])
        filter_clauses.append(f"({' OR '.join(or_parts)})")
    if date_from:
        filter_clauses.append("b.published_at >= ?")
        filter_params.append(date_from)
    if date_to:
        filter_clauses.append("b.published_at <= ?")
        filter_params.append(date_to)

    filter_sql = ""
    if filter_clauses:
        filter_sql = " AND " + " AND ".join(filter_clauses)

    # Build query
    all_params: list[Any] = []
    if len(norm) >= 3:
        if exact_only:
            match_expr = f'{{title content}}: "{query.lower()}"'
        else:
            match_expr = f'{{title title_normalized content content_normalized}}: "{norm}"'
        all_params.append(match_expr)
        all_params.extend(filter_params)
        data_sql = (
            "SELECT b.blog_id, b.title, b.content, b.content_normalized, "
            "b.service, b.member_id, b.member_name, b.published_at, b.blog_url "
            "FROM search_blogs_fts f "
            "JOIN search_blogs b ON f.rowid = b.rowid "
            f"WHERE search_blogs_fts MATCH ? {filter_sql} "
            "ORDER BY b.published_at DESC"
        )
    else:
        # LIKE fallback for short queries
        if exact_only:
            all_params.extend([f"%{query}%", f"%{query}%"])
        else:
            all_params.extend([f"%{query}%", f"%{norm}%", f"%{query}%", f"%{norm}%"])
        all_params.extend(filter_params)
        if exact_only:
            like_clause = "(b.title LIKE ? OR b.content LIKE ?)"
        else:
            like_clause = "(b.title LIKE ? OR b.title_normalized LIKE ? OR b.content LIKE ? OR b.content_normalized LIKE ?)"
        data_sql = (
            "SELECT b.blog_id, b.title, b.content, b.content_normalized, "
            "b.service, b.member_id, b.member_name, b.published_at, b.blog_url "
            f"FROM search_blogs b "
            f"WHERE {like_clause} {filter_sql} "
            "ORDER BY b.published_at DESC"
        )

    # Count
    count_sql = f"SELECT COUNT(*) FROM ({data_sql})"
    total = conn.execute(count_sql, all_params).fetchone()[0]

    # Paginated results
    paginated_sql = f"{data_sql} LIMIT ? OFFSET ?"
    rows = conn.execute(paginated_sql, all_params + [limit, offset]).fetchall()

    results = []
    for row in rows:
        blog_id, title, content, content_norm, svc, mid, mname, pub_at, blog_url = row
        # Generate snippet from content (or title if match is in title)
        snippet = self._make_blog_snippet(title, content, query, norm, content_norm, exact_only)
        results.append({
            "result_type": "blog",
            "blog_id": blog_id,
            "title": title,
            "snippet": snippet,
            "service": svc,
            "member_id": mid,
            "member_name": mname,
            "published_at": pub_at,
            "blog_url": blog_url,
        })

    return results, total
```

**Step 3: Add `_make_blog_snippet` method**

Blog snippet generation: search in title first, then content body. Reuse the existing `_make_snippet` logic pattern:

```python
def _make_blog_snippet(
    self,
    title: str,
    content: str,
    query: str,
    norm_query: str,
    content_norm: str,
    exact_only: bool,
) -> str:
    """Generate highlighted snippet for blog result."""
    # Try content body first (more interesting for snippet)
    if content:
        snippet = self._make_snippet(
            content, query, content_norm, norm_query,
            is_romaji=_is_romaji(query),
        )
        if snippet:
            return snippet

    # Fallback to title
    if title:
        lower_title = title.lower()
        lower_query = query.lower()
        idx = lower_title.find(lower_query)
        if idx != -1:
            return (
                title[:idx]
                + "<mark>"
                + title[idx : idx + len(query)]
                + "</mark>"
                + title[idx + len(query) :]
            )

    return content[:200] if content else title or ""
```

**Step 4: Integrate blog results into `_search_sync`**

At the end of `_search_sync`, after message results are built and sorted (around line 800), add blog search and merge:

```python
# --- Blog search (UNION) ---
if content_type in ("all", "blogs"):
    blog_results, blog_total = self._search_blogs_sync(
        query, service, None, member_id, limit, offset,
        services=services, member_ids=member_ids,
        member_filters=member_filters, exact_only=exact_only,
        date_from=date_from, date_to=date_to,
    )
else:
    blog_results, blog_total = [], 0

if content_type == "blogs":
    # Blog-only mode: return blog results directly
    return {
        "query": query,
        "normalized_query": first_norm,
        "total_count": blog_total,
        "results": blog_results[:limit],
        "has_more": blog_total > offset + limit,
    }

if content_type == "messages":
    # Message-only: skip blog merge, return as before
    pass  # existing return at end of method
else:
    # All: merge and re-sort by timestamp
    all_results = results + blog_results
    all_results.sort(
        key=lambda x: x.get("timestamp") or x.get("published_at") or "",
        reverse=True,
    )
    combined_total = total_count + blog_total
    return {
        "query": query,
        "normalized_query": first_norm,
        "total_count": combined_total,
        "results": all_results[:limit],
        "has_more": combined_total > offset + limit,
    }
```

Also add `"result_type": "message"` to each message result dict (around line 730 where result dicts are built).

**Step 5: Pass `content_type` through the async wrapper**

In the `search` async method (lines 1174-1203), add `content_type` to the kwargs:

```python
async def search(self, ..., content_type: str = "all") -> Dict[str, Any]:
    ...
    return await loop.run_in_executor(
        self._executor,
        lambda: self._search_sync(
            query, service, group_id, member_id, limit, offset,
            ...,
            content_type=content_type,
        ),
    )
```

**Step 6: Extend `_get_status_sync` for blog count**

In `_get_status_sync` (lines 998-1023), add blog statistics:

```python
blog_indexed_count = conn.execute("SELECT COUNT(*) FROM search_blogs").fetchone()[0]
```

Include `blog_indexed_count` in the returned dict.

**Verification:**

```bash
uv run python -c "
from backend.services.search_service import get_search_service
import asyncio
svc = get_search_service()
# Rebuild to index blogs
asyncio.run(svc.rebuild())
# Search for a common word that should appear in blogs
result = asyncio.run(svc.search('ブログ'))
for r in result['results'][:5]:
    print(r.get('result_type'), r.get('blog_id') or r.get('message_id'), r.get('snippet', '')[:60])
print('Total:', result['total_count'])
"
```

Expected: Mix of `message` and `blog` result types in the output.

**Commit:**
```bash
git add backend/services/search_service.py
git commit -m "feat(search): add blog search queries with UNION and content_type filter"
```

---

## Task 3: Backend — API Layer Changes

**Files:**
- Modify: `backend/api/search.py`

**Context:**
- `search.py` (lines 8-48) defines the `GET /api/search` endpoint with query params.
- Currently passes all params to `svc.search()`.

**Step 1: Add `content_type` parameter to search endpoint**

Add to the endpoint function signature (around line 19):

```python
content_type: str = Query("all", description="Content type filter: all, messages, blogs"),
```

Pass it through to `svc.search()`:

```python
return await svc.search(
    q, service, group_id, member_id, limit, offset,
    ...,
    content_type=content_type,
)
```

**Verification:**

```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk
uv run python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
sleep 2
# Test message-only
curl -s "http://localhost:8000/api/search?q=おはよう&content_type=messages&limit=3" | python -m json.tool | head -20
# Test blog-only
curl -s "http://localhost:8000/api/search?q=ブログ&content_type=blogs&limit=3" | python -m json.tool | head -20
# Test all (default)
curl -s "http://localhost:8000/api/search?q=ライブ&limit=5" | python -m json.tool | head -30
kill %1
```

Expected: Each response has `result_type` field. Blog-only returns blog results. Messages-only returns message results. All returns both.

**Commit:**
```bash
git add backend/api/search.py
git commit -m "feat(search): add content_type param to search API endpoint"
```

---

## Task 4: Backend — Incremental Blog Indexing After Sync

**Files:**
- Modify: `backend/services/search_service.py` (add `index_blogs` method)
- Modify: `backend/services/sync_service.py` (hook after blog sync)

**Context:**
- `sync_service.py` Phase 5 (lines 489-515) runs blog sync after messages.
- The existing message index hook is at lines 428-439 (after Phase 2).
- We need: after blog sync completes, re-index that service's blogs.

**Step 1: Add `_index_blogs_for_service_sync` method**

Similar to `_build_blog_index_sync` but scoped to one service:

```python
def _index_blogs_for_service_sync(self, service: str) -> int:
    """Re-index all cached blogs for a single service."""
    conn = self._get_conn()
    output_dir = self._output_dir

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

    # Delete existing blogs for this service before re-indexing
    conn.execute("DELETE FROM search_blogs WHERE service = ?", (service,))
    conn.commit()

    # Re-index (same logic as _build_blog_index_sync but for one service)
    index_path = blogs_dir / "index.json"
    if not index_path.exists():
        return 0
    try:
        index_data = json.loads(index_path.read_text(encoding="utf-8"))
    except Exception:
        return 0

    total = 0
    batch: list[tuple] = []
    members = index_data.get("members", {})

    for member_id_str, member_info in members.items():
        member_name = member_info.get("name", "")
        member_id = int(member_id_str)
        if member_info.get("blogs_removed"):
            continue
        member_dir = blogs_dir / member_name
        if not member_dir.is_dir():
            continue
        for blog_entry in member_info.get("blogs", []):
            blog_id = blog_entry.get("id")
            if not blog_id:
                continue
            published = blog_entry.get("published_at", "")
            date_prefix = published[:10].replace("-", "") if published else ""
            cache_dir = member_dir / f"{date_prefix}_{blog_id}"
            blog_json_path = cache_dir / "blog.json"
            if not blog_json_path.exists():
                continue
            try:
                blog_data = json.loads(blog_json_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            html_content = blog_data.get("content", {}).get("html", "")
            if not html_content:
                continue
            meta = blog_data.get("meta", {})
            title = meta.get("title", "")
            plain_text = _strip_html(html_content)
            title_normalized = self._normalize_with_readings(title) if title else ""
            content_normalized = self._normalize_with_readings(plain_text)
            batch.append((
                blog_id, service, member_id, member_name, title, title_normalized,
                meta.get("published_at", ""), meta.get("url", ""),
                plain_text, content_normalized,
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
    logger.info("Blog index updated for service", service=service, blog_count=total)
    return total
```

**Step 2: Add async wrapper**

```python
async def index_blogs_for_service(self, service: str) -> int:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        self._executor, self._index_blogs_for_service_sync, service
    )
```

**Step 3: Hook into `sync_service.py`**

After the blog sync in Phase 5 (around line 515), add:

```python
# Update blog search index (non-fatal)
try:
    from backend.services.search_service import get_search_service
    search_svc = get_search_service()
    await search_svc.index_blogs_for_service(self._service)
except Exception as e:
    logger.warning("Blog search index update failed (non-fatal)", error=str(e))
```

**Commit:**
```bash
git add backend/services/search_service.py backend/services/sync_service.py
git commit -m "feat(search): add incremental blog indexing after sync"
```

---

## Task 5: Frontend — Types and Content Type Filter

**Files:**
- Modify: `frontend/src/features/search/types.ts`
- Modify: `frontend/src/features/search/components/SearchFilterBar.tsx`
- Modify: `frontend/src/features/search/SearchModal.tsx`

**Context:**
- `types.ts` currently has a flat `SearchResult` interface (lines 1-13).
- `SearchFilterBar.tsx` has a toggle row (lines 191-246) with checkboxes and a date dropdown.
- `SearchModal.tsx` has filter state (lines 40-44) and `buildFilterParams` (lines 94-116).

**Step 1: Update `types.ts` with discriminated union**

Replace the `SearchResult` interface with:

```typescript
export interface MessageSearchResult {
  result_type: 'message';
  message_id: number;
  content: string | null;
  snippet: string | null;
  service: string;
  group_id: number;
  group_name: string;
  member_id: number;
  member_name: string;
  timestamp: string;
  type: string;
  is_group_chat?: boolean;
}

export interface BlogSearchResult {
  result_type: 'blog';
  blog_id: string;
  title: string;
  snippet: string | null;
  service: string;
  member_id: number;
  member_name: string;
  published_at: string;
  blog_url: string;
}

export type SearchResult = MessageSearchResult | BlogSearchResult;

export type ContentTypeFilter = 'all' | 'messages' | 'blogs';
```

Keep all other types unchanged (`SearchResponse`, `FilterChip`, `DateRangePreset`, etc.).

**Step 2: Add content type dropdown to `SearchFilterBar`**

Add `contentType` and `onContentTypeChange` props:

```typescript
interface SearchFilterBarProps {
  // ... existing props ...
  contentType: ContentTypeFilter;
  onContentTypeChange: (value: ContentTypeFilter) => void;
}
```

Add a `CONTENT_TYPE_PRESETS` constant (same pattern as `DATE_PRESETS`):

```typescript
const CONTENT_TYPE_PRESETS: { value: ContentTypeFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'search.contentAll' },
  { value: 'messages', labelKey: 'search.contentMessages' },
  { value: 'blogs', labelKey: 'search.contentBlogs' },
];
```

Add the dropdown in Row 2 (line 192), between the toggles and the date dropdown. Copy the exact date dropdown pattern:

```tsx
{/* Content type dropdown */}
<div className="relative" ref={contentTypeDropdownRef}>
  <button
    className="flex items-center gap-1 text-gray-500 hover:text-gray-700 transition-colors"
    onClick={() => setShowContentTypeDropdown(!showContentTypeDropdown)}
  >
    {t(CONTENT_TYPE_PRESETS.find(p => p.value === contentType)?.labelKey || 'search.contentAll')}
    <ChevronDown className="w-3 h-3" />
  </button>
  {showContentTypeDropdown && (
    <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1">
      {CONTENT_TYPE_PRESETS.map((preset) => (
        <button
          key={preset.value}
          className={`w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 ${
            contentType === preset.value ? 'text-blue-600 font-medium' : 'text-gray-700'
          }`}
          onClick={() => {
            onContentTypeChange(preset.value);
            setShowContentTypeDropdown(false);
          }}
        >
          {t(preset.labelKey)}
        </button>
      ))}
    </div>
  )}
</div>
```

Add `contentTypeDropdownRef` and `showContentTypeDropdown` state. Add outside-click handler (same pattern as date dropdown).

**Step 3: Wire `contentType` state in `SearchModal`**

Add state variable (after line 44):

```typescript
const [contentType, setContentType] = useState<ContentTypeFilter>('all');
```

Add to `resetState` (line 51):

```typescript
setContentType('all');
```

Add to `buildFilterParams` (line 94):

```typescript
if (contentType !== 'all') params.set('content_type', contentType);
```

Pass to `SearchFilterBar`:

```tsx
<SearchFilterBar
  // ... existing props ...
  contentType={contentType}
  onContentTypeChange={setContentType}
/>
```

Add `contentType` to the `buildFilterParams` dependency array.

**Commit:**
```bash
git add frontend/src/features/search/types.ts frontend/src/features/search/components/SearchFilterBar.tsx frontend/src/features/search/SearchModal.tsx
git commit -m "feat(search): add content type filter (All/Messages/Blogs) to search UI"
```

---

## Task 6: Frontend — Blog Result Rendering

**Files:**
- Modify: `frontend/src/features/search/components/SearchResultItem.tsx`

**Context:**
- `SearchResultItem` (lines 7-80) renders a single search result with service dot, member name, group name, snippet, and timestamp.
- Now `SearchResult` is a discriminated union — we need to branch on `result_type`.

**Step 1: Add type badge icons**

Import lucide icons at the top:

```typescript
import { MessageSquare, FileText } from 'lucide-react';
```

**Step 2: Branch rendering based on `result_type`**

Update the component body to handle both types. The key differences for blog items:
- Show `FileText` icon instead of `MessageSquare` in top-right
- Show blog title in bold above the snippet
- Show `published_at` date (date only) instead of message timestamp
- No group name
- Use `formatName(result.member_name)` for member (same as messages)

```tsx
const isBlog = result.result_type === 'blog';
const timestamp = isBlog ? result.published_at : result.timestamp;
const formattedDate = timestamp
  ? isBlog
    ? new Date(timestamp).toLocaleDateString('ja-JP')
    : new Date(timestamp).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '';
```

For the layout:
- **Header row**: service dot + member name + (group name for messages) + type icon
- **Title row** (blog only): bold blog title
- **Snippet row**: same as before
- **Date**: right-aligned

**Step 3: Update any TypeScript narrowing**

Anywhere the component accesses `result.message_id`, `result.group_name`, etc., guard with `result.result_type === 'message'` checks. The discriminated union makes this type-safe.

**Commit:**
```bash
git add frontend/src/features/search/components/SearchResultItem.tsx
git commit -m "feat(search): render blog results with title and type badge in result list"
```

---

## Task 7: Frontend — Blog Navigation from Search

**Files:**
- Modify: `frontend/src/store/appStore.ts`
- Modify: `frontend/src/features/search/SearchModal.tsx`
- Modify: `frontend/src/features/blogs/BlogsFeature.tsx`
- Modify: `frontend/src/features/blogs/components/BlogReader.tsx`

**Context:**
- `appStore.ts` has `targetMessageId` (lines 135-138, 239-240) for message search navigation, excluded from `partialize` (lines 253-261).
- `SearchModal.tsx` `handleNavigate` (lines 185-227) sets activeFeature, selectedConversation, targetMessageId for messages.
- `BlogsFeature.tsx` manages view state (lines 34-35), opens BlogReader (lines 317-332), fetches content (lines 252-293).
- `BlogReader.tsx` renders HTML via DOMPurify (lines 85-95, 201-204).

**Step 1: Add `targetBlog` to appStore**

In the AppState interface (around line 135):

```typescript
targetBlog: { blogId: string; service: string; memberId: number; searchQuery: string } | null;
setTargetBlog: (target: { blogId: string; service: string; memberId: number; searchQuery: string } | null) => void;
```

In the store body (around line 239):

```typescript
targetBlog: null,
setTargetBlog: (target) => set({ targetBlog: target }),
```

Exclude from `partialize` (line 253 area) — it's already excluded by not being in the whitelist.

**Step 2: Add blog branch to `handleNavigate` in SearchModal**

In `handleNavigate` (line 185), add blog handling before the existing message logic:

```typescript
const handleNavigate = useCallback(
  (result: SearchResult) => {
    const {
      setActiveService,
      setActiveFeature,
      setSelectedConversation,
      triggerConversationNavigation,
      setTargetMessageId,
      setTargetBlog,
      activeService,
      selectedServices,
      setSelectedServices,
    } = useAppStore.getState();

    // Ensure service is in selectedServices
    if (!selectedServices.includes(result.service)) {
      setSelectedServices([...selectedServices, result.service]);
    }

    if (result.result_type === 'blog') {
      // Blog navigation
      setTargetBlog({
        blogId: result.blog_id,
        service: result.service,
        memberId: result.member_id,
        searchQuery: query,
      });
      setActiveFeature(result.service, 'blogs');
      if (activeService !== result.service) {
        setActiveService(result.service);
      }
      close();
      return;
    }

    // Message navigation (existing code)
    // ...
  },
  [close, query]
);
```

Note: add `query` to the dependency array since blog navigation passes it as `searchQuery`.

**Step 3: Handle `targetBlog` in BlogsFeature**

In `BlogsFeature.tsx`, add a useEffect that watches `targetBlog`:

```typescript
const targetBlog = useAppStore(s => s.targetBlog);
const setTargetBlog = useAppStore(s => s.setTargetBlog);

useEffect(() => {
  if (!targetBlog || !activeService || targetBlog.service !== activeService) return;

  // Fetch blog content and open reader
  const openTargetBlog = async () => {
    try {
      const content = await getBlogContent(activeService, targetBlog.blogId);
      // Build minimal blog/member objects for BlogReader
      const meta = content.meta;
      setViewState({
        view: 'reader',
        blog: {
          id: meta.id,
          title: meta.title,
          published_at: meta.published_at,
          url: meta.url,
          thumbnail: null,
          cached: true,
        },
        member: {
          id: targetBlog.memberId,
          name: meta.member_name,
        },
        content,
        fromView: 'recent',
        searchQuery: targetBlog.searchQuery,
      });
    } catch (err) {
      console.error('[BlogsFeature] Failed to open blog from search', err);
    }
  };

  openTargetBlog();
  setTargetBlog(null); // Consume
}, [targetBlog, activeService, setTargetBlog]);
```

Add `searchQuery` to the `ViewState` type (the `reader` variant):

```typescript
type ViewState =
  | { view: 'recent' }
  | { view: 'reader'; blog: BlogMeta; member: BlogMember; content: BlogContentResponse | null; fromView: string; searchQuery?: string };
```

Pass `searchQuery` through to BlogReader as a prop.

**Step 4: Add search highlight to BlogReader**

Add `searchQuery` prop to BlogReader:

```typescript
interface BlogReaderProps {
  // ... existing props ...
  searchQuery?: string;
}
```

In the HTML processing (lines 85-95), after DOMPurify sanitization, inject `<mark>` for the search query:

```typescript
const processedHtml = useMemo(() => {
  if (!content?.content?.html) return '';
  let html = sanitizeHtml(content.content.html); // existing sanitization

  // Highlight search query if present
  if (searchQuery) {
    const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    // Only replace in text nodes (not inside tags)
    html = html.replace(/>([^<]+)</g, (match, text) => {
      return '>' + text.replace(regex, '<mark id="search-highlight" class="search-snippet">$1</mark>') + '<';
    });
  }

  return html;
}, [content, searchQuery]);
```

After render, scroll to the highlight:

```typescript
useEffect(() => {
  if (searchQuery) {
    const timer = setTimeout(() => {
      document.getElementById('search-highlight')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 300); // Wait for content render
    return () => clearTimeout(timer);
  }
}, [searchQuery, content]);
```

Add the `.search-snippet mark` styles (same yellow highlight used in search results) — these are already globally defined in SearchModal.tsx (lines 392-403), so they'll work automatically.

**Commit:**
```bash
git add frontend/src/store/appStore.ts frontend/src/features/search/SearchModal.tsx frontend/src/features/blogs/BlogsFeature.tsx frontend/src/features/blogs/components/BlogReader.tsx
git commit -m "feat(search): add blog navigation from search results with scroll-to-match"
```

---

## Task 8: i18n Strings

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/ja.json`
- Modify: `frontend/src/i18n/locales/zh-TW.json`
- Modify: `frontend/src/i18n/locales/zh-CN.json`
- Modify: `frontend/src/i18n/locales/yue.json`

**Context:**
- Search namespace is at the `"search"` key in each locale file.
- Current keys end with `"lastYear"` (around line 267 in en.json).

**Add these keys to the `"search"` namespace in ALL 5 locale files:**

| Key | en | ja | zh-TW | zh-CN | yue |
|-----|----|----|-------|-------|-----|
| contentAll | All | すべて | 全部 | 全部 | 全部 |
| contentMessages | Messages | メッセージ | 訊息 | 消息 | 訊息 |
| contentBlogs | Blogs | ブログ | 部落格 | 博客 | 網誌 |
| blogCacheHint | Only cached blogs are searchable. Cache all in Settings. | キャッシュ済みのブログのみ検索可能です。設定で全てキャッシュできます。 | 僅可搜尋已快取的部落格。可在設定中快取全部。 | 仅可搜索已缓存的博客。可在设置中缓存全部。 | 淨係搵到已快取嘅網誌。可以喺設定度快取全部。 |
| resultCountWithBlogs | {{count}} results ({{blogCount}} blogs) | {{count}}件の結果（{{blogCount}}件ブログ） | {{count}} 個結果（{{blogCount}} 個部落格） | {{count}} 个结果（{{blogCount}} 个博客） | {{count}} 個結果（{{blogCount}} 個網誌） |

Also update:
- `"placeholder"`: "Search messages..." → "Search messages and blogs..." (en only — update ja/zh/yue equivalents too)
- `"noResults"`: "No messages found" → "No results found" (and translations)

**Commit:**
```bash
git add frontend/src/i18n/locales/en.json frontend/src/i18n/locales/ja.json frontend/src/i18n/locales/zh-TW.json frontend/src/i18n/locales/zh-CN.json frontend/src/i18n/locales/yue.json
git commit -m "feat(i18n): add blog search translation strings for all locales"
```

---

## Task 9: Blog Cache Notice in Search Modal Footer

**Files:**
- Modify: `frontend/src/features/search/SearchModal.tsx`

**Context:**
- The search modal footer (lines 378-387) shows result count and "Press Enter to select".
- We need a conditional notice about blog caching.

**Step 1: Count blog results**

After results are set, compute blog count:

```typescript
const blogCount = useMemo(
  () => results.filter(r => r.result_type === 'blog').length,
  [results]
);
```

**Step 2: Add notice line to footer**

Below the existing footer span elements, add:

```tsx
{/* Blog cache hint */}
{blogCount > 0 && (
  <div className="px-4 py-1 border-t border-gray-100 bg-gray-50 text-xs text-gray-400 rounded-b-xl">
    {t('search.blogCacheHint')}
  </div>
)}
```

Move the `rounded-b-xl` from the existing footer div to this notice (when present) or keep it on the footer (when notice is hidden).

**Step 3: Update result count to show blog breakdown**

In the footer, when blogs are present, use the `resultCountWithBlogs` translation key:

```tsx
{blogCount > 0
  ? t('search.resultCountWithBlogs', { count: results.length, blogCount })
  : totalCount > results.length
    ? t('search.resultCountPartial', { shown: results.length, total: totalCount })
    : t('search.resultCount', { count: results.length })}
```

**Commit:**
```bash
git add frontend/src/features/search/SearchModal.tsx
git commit -m "feat(search): add blog cache notice and blog count in search footer"
```

---

## Verification Checklist

After all tasks are complete:

1. **Full rebuild:** Press Cmd+K, type a common word. Verify both message and blog results appear with different badges.
2. **Content type filter:** Toggle to "Blogs" — only blog results. Toggle to "Messages" — only message results.
3. **Blog navigation:** Click a blog result. Verify:
   - Switches to blogs feature
   - Opens BlogReader with correct blog
   - Highlighted text visible, scrolled into view
4. **Cross-service blog navigation:** Search in hinatazaka, click a sakurazaka blog result. Verify service switches correctly.
5. **Filters apply to blogs:** Add a member chip, verify blog results are filtered to that member.
6. **Blog cache notice:** Verify "Only cached blogs are searchable" appears in footer when blog results exist.
7. **Incremental sync:** Run a sync, verify new blog content appears in subsequent searches.
8. **Empty state:** Search for something that only matches blogs with content_type="messages" — should show no results.
