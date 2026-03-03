# Blog Search Integration Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add blog content to the existing global search (Cmd+K), so users can search across both messages and blog posts in a unified experience.

**Architecture:** Separate `search_blogs` + `search_blogs_fts` tables in the existing search index DB. HTML stripped to plain text at index time, normalized with pykakasi like messages. Search queries UNION both tables. Frontend renders blog results with title + snippet + type badge in the same result list.

**Tech Stack:** Same as message search (SQLite FTS5 trigram, pykakasi, React + Zustand + Tailwind). HTML stripping via regex.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Result layout | Unified list | Blog and message results interleaved by timestamp. Type badge distinguishes them. Simpler UX. |
| Index scope | Cached blogs only | Only index blogs where blog.json exists locally. UI notice guides users to cache all blogs in Settings. |
| Text extraction | Strip HTML tags | Simple tag removal, same normalization pipeline as messages. |
| Filters | Shared + content type toggle | All existing filters (member, service, date, exact match) apply to both types. New content type dropdown: All / Messages / Blogs. |
| Navigation | Open BlogReader, scroll to match | Click blog result → switch to blogs feature → open BlogReader → highlight and scroll to matched text. |
| DB schema | Separate table + FTS | Avoids ID collisions and nullable field sprawl in search_messages. Clean separation. |

---

## Database Schema

New tables in `search_index.db` (alongside existing `search_messages` + `search_fts`):

```sql
CREATE TABLE search_blogs (
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

CREATE VIRTUAL TABLE search_blogs_fts USING fts5(
    title,
    title_normalized,
    content,
    content_normalized,
    content=search_blogs,
    content_rowid=rowid,
    tokenize="trigram"
);
```

- `title` + `title_normalized`: Blog title is searchable (users search for blog titles too).
- `content`: HTML-stripped plain text of the blog body.
- `content_normalized`: pykakasi readings for kana cross-matching.
- FTS5 triggers for INSERT/UPDATE/DELETE sync (same pattern as messages).

---

## API Changes

### `GET /api/search` — new param

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| content_type | str | "all" | Filter by content type: `all`, `messages`, `blogs` |

### Response — `result_type` field added

Each result gains a `result_type` discriminator:

**Message result** (unchanged, plus `result_type`):
```json
{
  "result_type": "message",
  "message_id": 19408,
  "snippet": "今日は<mark>デート</mark>に行きました！",
  "service": "hinatazaka46",
  "group_id": 34,
  "group_name": "金村 美玖",
  "member_id": 58,
  "member_name": "金村 美玖",
  "timestamp": "2020-05-28T12:23:03Z",
  "is_group_chat": false
}
```

**Blog result** (new):
```json
{
  "result_type": "blog",
  "blog_id": "67615",
  "title": "読めばだんだん常夏に感じてくるブログ",
  "snippet": "...旅行で<mark>デート</mark>スポットを...",
  "service": "hinatazaka46",
  "member_id": 12,
  "member_name": "金村 美玖",
  "published_at": "2026-01-17T22:21:00+09:00",
  "blog_url": "https://www.hinatazaka46.com/..."
}
```

### Query Strategy

Backend UNIONs message and blog sub-queries:
- When `content_type=all`: query both tables, UNION, sort by timestamp DESC.
- When `content_type=messages`: skip blog table entirely.
- When `content_type=blogs`: skip message table entirely.

Pagination (LIMIT/OFFSET) applies to the combined UNION result.

### `GET /api/search/status` — extended

Add `blog_indexed_count` and `blog_total_cached` fields so the UI can determine if a "cache all blogs" notice is needed.

---

## Frontend: Result Rendering

`SearchResult` becomes a discriminated union type:

```typescript
interface MessageSearchResult {
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
  is_group_chat?: boolean;
}

interface BlogSearchResult {
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

type SearchResult = MessageSearchResult | BlogSearchResult;
```

### SearchResultItem layout

**Message** (unchanged):
```
[●] 金村 美玖 · 34 金村 美玖          💬
"...今日は[デート]に行きま..."
                                   14:30
```

**Blog** (new):
```
[●] 金村 美玖                        📝
読めばだんだん常夏に感じてくるブログ
"...旅行で[デート]スポットを..."
                              2026-01-17
```

- Type badge: `FileText` icon (lucide) for blogs, `MessageSquare` for messages. Small, top-right.
- Blog title displayed bold above snippet.
- Date only (no time) for blogs.
- No group name for blogs (not applicable).

---

## Frontend: Content Type Filter

New dropdown in SearchFilterBar's toggle row, beside existing toggles:

```
[✓ Exact match only]  [✓ Include unread]   Messages ▾  |  All time ▾
```

Becomes:

```
[✓ Exact match only]  [✓ Include unread]   All ▾      |  All time ▾
```

The "All ▾" dropdown has three options:
- **All** (default) — both messages and blogs
- **Messages** — messages only
- **Blogs** — blogs only

Maps to `content_type` API param. Same dropdown pattern as date range.

New type:
```typescript
export type ContentTypeFilter = 'all' | 'messages' | 'blogs';
```

---

## Frontend: Navigation to BlogReader

When clicking a **blog** result:

1. `handleNavigate` detects `result.result_type === 'blog'`:
   - Sets `activeFeature(service, 'blogs')`.
   - Stores target in Zustand: `setTargetBlog({ blogId, service, memberId, searchQuery })`.
   - Switches service if needed (same cross-service logic as messages).
   - Closes modal.

2. `BlogsFeature` picks up `targetBlog` from the store:
   - Fetches blog content via `/api/blogs/content?service=...&blog_id=...`.
   - Opens BlogReader with that blog post.
   - Passes `searchQuery` to BlogReader.

3. `BlogReader` highlights and scrolls to match:
   - After DOMPurify sanitization but before rendering, does a case-insensitive search in the HTML text content for the query string.
   - Wraps the first match in `<mark id="search-highlight">`.
   - After render, calls `document.getElementById('search-highlight')?.scrollIntoView({ behavior: 'smooth', block: 'center' })`.
   - Reuses existing `.search-snippet mark` styling from SearchModal.
   - Clears `targetBlog` from store after consuming.

### Zustand additions (appStore.ts):

```typescript
// Non-persisted
targetBlog: { blogId: string; service: string; memberId: number; searchQuery: string } | null;
setTargetBlog: (target: ...) => void;
clearTargetBlog: () => void;
```

---

## Frontend: "Cache All Blogs" Notice

Shown in the search modal footer when blogs are in scope:

```
15 results (3 blogs) · Press Enter to select
ℹ Only cached blogs are searchable. Cache all in Settings → Blogs.
```

Display conditions:
- Content type filter includes blogs (i.e., "All" or "Blogs").
- Not all blogs are cached (determined via `/api/search/status` blog coverage).

Single line of `text-gray-400` text below the result count. Non-intrusive.

---

## Index Building

### Full build (`build_full_index`)

After the existing message indexing pass, add a blog indexing pass:

1. Walk `output/{service}/blogs/` for each service.
2. Read `index.json` to get member metadata (member_id, member_name).
3. For each member directory, find `*/blog.json` files.
4. For each blog.json: strip HTML from `content.html`, normalize with pykakasi.
5. Batch INSERT into `search_blogs` (same 500-row batches).
6. Build FTS5 index via triggers.

### Incremental update (after blog sync)

After `sync_blog_metadata()` or `download_blog_content()` completes:
- Re-index only the affected service's blogs.
- Same non-fatal pattern as message sync integration.

### HTML stripping

Simple regex: remove all HTML tags, decode HTML entities, collapse whitespace.

```python
import re
from html import unescape

def strip_html(html: str) -> str:
    text = re.sub(r'<[^>]+>', ' ', html)
    text = unescape(text)
    return re.sub(r'\s+', ' ', text).strip()
```

---

## i18n Additions

| Key | en | ja |
|-----|----|----|
| search.contentAll | All | すべて |
| search.contentMessages | Messages | メッセージ |
| search.contentBlogs | Blogs | ブログ |
| search.blogCacheHint | Only cached blogs are searchable. Cache all in Settings. | キャッシュ済みのブログのみ検索可能です。設定で全てキャッシュできます。 |
| search.resultCountWithBlogs | {{count}} results ({{blogCount}} blogs) | {{count}}件の結果（{{blogCount}}件ブログ） |

(Plus zh-TW, zh-CN, yue translations.)
