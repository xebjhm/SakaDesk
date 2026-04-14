# Blog Photo Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a blog photo gallery to `MemberTimelineModal` that lets users skim all inline photos from a member's blog posts, with the same grid layout, calendar jump, and photo viewer as the message media gallery.

**Architecture:** New `BlogPhotoGalleryModal` component in the blogs feature, gated on `blogs_full_backup`. Extends `MediaViewerModal` with source-agnostic `sourceLabel`/`onSourceJump` props. Extends `CalendarModal` with a `dates` mode for direct `DateCount[]` input. Extends `BlogContentResponse` type with `local_url`.

**Tech Stack:** React, TypeScript, Tailwind CSS, existing `BaseModal`/`CalendarModal`/`MediaViewerModal` components, existing blog API (`getBlogList`, `getBlogContent`).

---

### Task 1: Extend `BlogContentResponse` type with `local_url`

**Files:**
- Modify: `frontend/src/types/index.ts:115-118`

- [ ] **Step 1: Add `local_url` to the images array type**

In `frontend/src/types/index.ts`, update the `BlogContentResponse.images` type:

```typescript
images: Array<{
    original_url: string;
    local_path: string | null;
    local_url?: string;  // Set by backend when image is cached locally
}>;
```

- [ ] **Step 2: Verify no type errors**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors (existing code doesn't reference `local_url` yet, so adding an optional field is safe).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(types): add local_url to BlogContentResponse images"
```

---

### Task 2: Extend `MediaViewerItem` with source label and jump

**Files:**
- Modify: `frontend/src/core/media/PhotoDetailModal.tsx:11-21` (interface), `104-171` (render)

- [ ] **Step 1: Add `sourceLabel` and `onSourceJump` to `MediaViewerItem`**

In `frontend/src/core/media/PhotoDetailModal.tsx`, add two fields to the `MediaViewerItem` interface:

```typescript
export interface MediaViewerItem {
    src: string;
    type: 'picture' | 'video' | 'voice';
    timestamp: string;
    avatarUrl?: string;
    memberName?: string;
    isMuted?: boolean;
    /** Source context label (e.g. blog post title, message preview). */
    sourceLabel?: string;
    /** Called when sourceLabel is clicked — jumps to the source (blog post, message, etc). */
    onSourceJump?: () => void;
}
```

- [ ] **Step 2: Render the source label in the viewer**

In the same file, inside the `MediaViewerModal` component's JSX, add the source label between the navigation counter and the download button. Find the `{/* Navigation counter */}` section (line ~164) and add the source label right after it:

```tsx
{/* Source label */}
{item.sourceLabel && item.onSourceJump && (
    <button
        onClick={(e) => { e.stopPropagation(); item.onSourceJump!(); }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/70 hover:text-white text-sm max-w-[60vw] truncate transition-colors underline underline-offset-2 decoration-white/30 hover:decoration-white/60"
    >
        {item.sourceLabel}
    </button>
)}
```

Then move the navigation counter to avoid overlap. Change the counter position from `bottom-6 left-6` to `bottom-14 left-6` so it sits above the source label:

```tsx
{/* Navigation counter */}
{mediaItems.length > 1 && (
    <div className={cn(
        "absolute left-6 text-white/60 text-sm",
        item.sourceLabel && item.onSourceJump ? "bottom-14" : "bottom-6"
    )}>
        {currentIndex + 1} / {mediaItems.length}
    </div>
)}
```

Note: This requires adding `cn` to the imports. Add it:

```typescript
import { cn, formatDownloadFilename } from '../../utils/classnames';
```

Also move the download button position similarly when source label is present. Change the download button's className from `bottom-6 right-6` to use a conditional:

```tsx
{goldenFingerActive && item.type === 'picture' && (
    <button
        onClick={(e) => { e.stopPropagation(); handleDownload(); }}
        className={cn(
            "absolute right-6 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg text-sm flex items-center gap-2 backdrop-blur-sm transition-colors",
            item.sourceLabel && item.onSourceJump ? "bottom-14" : "bottom-6"
        )}
    >
        <Download className="w-4 h-4" />
        {t('common.download')}
    </button>
)}
```

- [ ] **Step 3: Verify no type errors**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors. Existing callers pass `MediaViewerItem` without `sourceLabel`/`onSourceJump` — both are optional, so backward compatible.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/core/media/PhotoDetailModal.tsx
git commit -m "feat(media): add source label with jump action to MediaViewerModal"
```

---

### Task 3: Extend `CalendarModal` to accept direct dates array

**Files:**
- Modify: `frontend/src/core/modals/CalendarModal.tsx:25-46` (props), `82-95` (date computation)

The current `CalendarModal` has two modes: API (with `conversationPath`) and Messages (with `messages: Message[]`). We need a third mode: Dates (with `dates: DateCount[]`), so the blog photo gallery can pass pre-computed date counts without needing to construct fake `Message` objects.

- [ ] **Step 1: Add a `CalendarModalPropsDates` variant**

In `frontend/src/core/modals/CalendarModal.tsx`, add a third props interface variant after `CalendarModalPropsMessages`:

```typescript
interface CalendarModalPropsDates extends CalendarModalPropsBase {
    /** Pre-computed date counts (for blog photo gallery and other non-message sources) */
    dates: DateCount[];
    /** Callback when a date is selected (receives Date object) */
    onSelectDate: (date: Date) => void;
    conversationPath?: never;
    messages?: never;
}

type CalendarModalProps = CalendarModalPropsAPI | CalendarModalPropsMessages | CalendarModalPropsDates;
```

Also export the `DateCount` interface so callers can use it:

```typescript
export interface DateCount {
    date: string;
    count: number;
}
```

- [ ] **Step 2: Update mode detection and active dates logic**

Update the mode detection (around line 77-78) to handle the new variant:

```typescript
const isMessagesMode = 'messages' in props && props.messages !== undefined;
const isDatesMode = 'dates' in props && props.dates !== undefined;
const conversationPath = !isMessagesMode && !isDatesMode ? (props as CalendarModalPropsAPI).conversationPath : undefined;
const messages = isMessagesMode ? (props as CalendarModalPropsMessages).messages : undefined;
const directDates = isDatesMode ? (props as CalendarModalPropsDates).dates : undefined;
```

Update the `activeDates` line (around line 98):

```typescript
const activeDates = isDatesMode ? directDates! : isMessagesMode ? messageDates : apiDates;
```

Update the fetch effect (around line 122-126) to also skip in dates mode:

```typescript
useEffect(() => {
    if (isOpen && !isMessagesMode && !isDatesMode) {
        fetchDates();
    }
}, [isOpen, isMessagesMode, isDatesMode, fetchDates]);
```

Update `handleDateClick` (around line 203-211) to handle dates mode:

```typescript
const handleDateClick = (dateStr: string, date: Date) => {
    if (datesWithMessages.has(dateStr)) {
        if (isMessagesMode || isDatesMode) {
            (props as CalendarModalPropsMessages | CalendarModalPropsDates).onSelectDate(date);
        } else {
            (props as CalendarModalPropsAPI).onSelectDate(dateStr);
        }
        onClose();
    }
};
```

- [ ] **Step 3: Verify no type errors**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors. Existing callers use either API or Messages mode — both still work.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/core/modals/CalendarModal.tsx
git commit -m "feat(calendar): add dates mode for direct DateCount[] input"
```

---

### Task 4: Add i18n keys for blog photo gallery

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/ja.json`
- Modify: `frontend/src/i18n/locales/zh-TW.json`
- Modify: `frontend/src/i18n/locales/zh-CN.json`
- Modify: `frontend/src/i18n/locales/yue.json`

- [ ] **Step 1: Add keys to en.json**

Add the following keys under a new `"blogGallery"` section in `en.json`:

```json
"blogGallery": {
    "title": "Photo Gallery",
    "button": "Photo Gallery",
    "loading": "Loading photos...",
    "emptyNoBackup": "Enable full blog backup in Settings to browse photos",
    "emptyNoPhotos": "No photos found",
    "count": "{{count}} photos",
    "jumpToDate": "Jump to Date"
}
```

- [ ] **Step 2: Add keys to ja.json**

```json
"blogGallery": {
    "title": "フォトギャラリー",
    "button": "フォトギャラリー",
    "loading": "写真を読み込み中...",
    "emptyNoBackup": "写真を閲覧するには、設定でブログの完全バックアップを有効にしてください",
    "emptyNoPhotos": "写真が見つかりませんでした",
    "count": "{{count}}枚の写真",
    "jumpToDate": "日付にジャンプ"
}
```

- [ ] **Step 3: Add keys to zh-TW.json**

```json
"blogGallery": {
    "title": "相簿",
    "button": "相簿",
    "loading": "載入相片中...",
    "emptyNoBackup": "請在設定中啟用完整部落格備份以瀏覽相片",
    "emptyNoPhotos": "找不到相片",
    "count": "{{count}} 張相片",
    "jumpToDate": "跳至日期"
}
```

- [ ] **Step 4: Add keys to zh-CN.json**

```json
"blogGallery": {
    "title": "相册",
    "button": "相册",
    "loading": "加载照片中...",
    "emptyNoBackup": "请在设置中启用完整博客备份以浏览照片",
    "emptyNoPhotos": "未找到照片",
    "count": "{{count}} 张照片",
    "jumpToDate": "跳至日期"
}
```

- [ ] **Step 5: Add keys to yue.json**

```json
"blogGallery": {
    "title": "相簿",
    "button": "相簿",
    "loading": "載入相片中...",
    "emptyNoBackup": "請喺設定入面啟用完整網誌備份嚟睇相片",
    "emptyNoPhotos": "搵唔到相片",
    "count": "{{count}} 張相片",
    "jumpToDate": "跳去日期"
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/i18n/locales/*.json
git commit -m "feat(i18n): add blog photo gallery translations"
```

---

### Task 5: Build `BlogPhotoGalleryModal`

**Files:**
- Create: `frontend/src/features/blogs/components/BlogPhotoGalleryModal.tsx`

This is the main new component. It mirrors `MediaGalleryModal`'s grid layout but uses blog content as its data source.

- [ ] **Step 1: Create the component file with types and data extraction**

Create `frontend/src/features/blogs/components/BlogPhotoGalleryModal.tsx`:

```tsx
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Image, Calendar } from 'lucide-react';
import { cn } from '../../../utils/classnames';
import { BaseModal, SafeImage, ModalEmptyState } from '../../../core/common';
import { CalendarModal } from '../../../core/modals/CalendarModal';
import { MediaViewerModal } from '../../../core/media/PhotoDetailModal';
import type { MediaViewerItem } from '../../../core/media/PhotoDetailModal';
import type { DateCount } from '../../../core/modals/CalendarModal';
import type { BlogMeta, BlogContentResponse } from '../../../types';
import { useBlogTheme } from '../hooks';
import { getBlogContent } from '../api';
import { useAppStore } from '../../../store/appStore';
import { useTranslation } from '../../../i18n';

interface BlogPhotoItem {
    src: string;
    blogId: string;
    blogTitle: string;
    publishedAt: string;
    imageIndex: number;
}

interface MonthGroup {
    key: string;
    label: string;
    items: BlogPhotoItem[];
}

interface BlogPhotoGalleryModalProps {
    isOpen: boolean;
    onClose: () => void;
    memberName: string;
    memberId: string;
    blogs: BlogMeta[];
    serviceId: string;
    onJumpToBlog: (blog: BlogMeta) => void;
}

export const BlogPhotoGalleryModal: React.FC<BlogPhotoGalleryModalProps> = ({
    isOpen,
    onClose,
    memberName,
    memberId,
    blogs,
    serviceId,
    onJumpToBlog,
}) => {
    const theme = useBlogTheme();
    const { t } = useTranslation();
    const appSettings = useAppStore((s) => s.appSettings);
    const backupEnabled = appSettings?.blogs_full_backup ?? false;

    const [photos, setPhotos] = useState<BlogPhotoItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const [showCalendar, setShowCalendar] = useState(false);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const monthRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const itemRefs = useRef<Map<string, HTMLElement>>(new Map());

    // Load photos from cached blog content on open
    useEffect(() => {
        if (!isOpen || !backupEnabled) return;

        let cancelled = false;
        const loadPhotos = async () => {
            setLoading(true);
            const allPhotos: BlogPhotoItem[] = [];

            const cachedBlogs = blogs.filter((b) => b.cached);
            for (const blog of cachedBlogs) {
                try {
                    const content: BlogContentResponse = await getBlogContent(serviceId, blog.id);
                    content.images.forEach((img, idx) => {
                        const src = img.local_url ?? null;
                        if (src) {
                            allPhotos.push({
                                src,
                                blogId: blog.id,
                                blogTitle: blog.title,
                                publishedAt: blog.published_at,
                                imageIndex: idx,
                            });
                        }
                    });
                } catch {
                    // Skip blogs that fail to load — non-critical
                }
            }

            if (!cancelled) {
                // Sort: newest blog first, then by image order within blog
                allPhotos.sort((a, b) => {
                    const dateDiff = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
                    if (dateDiff !== 0) return dateDiff;
                    return a.imageIndex - b.imageIndex;
                });
                setPhotos(allPhotos);
                setLoading(false);
            }
        };

        loadPhotos();
        return () => { cancelled = true; };
    }, [isOpen, backupEnabled, blogs, serviceId]);

    // Group photos by month
    const groupedPhotos = useMemo(() => {
        const groups: Map<string, BlogPhotoItem[]> = new Map();
        photos.forEach((item) => {
            const date = new Date(item.publishedAt);
            const key = `${date.getFullYear()}-${date.getMonth()}`;
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(item);
        });

        const result: MonthGroup[] = [];
        groups.forEach((items, key) => {
            const date = new Date(items[0].publishedAt);
            result.push({
                key,
                label: `${date.getFullYear()} / ${(date.getMonth() + 1).toString().padStart(2, '0')}`,
                items,
            });
        });

        return result;
    }, [photos]);

    // Date counts for calendar
    const dateCounts = useMemo((): DateCount[] => {
        const counts = new Map<string, number>();
        photos.forEach((item) => {
            const date = new Date(item.publishedAt);
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            counts.set(dateStr, (counts.get(dateStr) || 0) + 1);
        });
        return Array.from(counts.entries()).map(([date, count]) => ({ date, count }));
    }, [photos]);

    // Format date to YYYY-MM-DD for item refs
    const formatDateKey = (timestamp: string) => {
        const date = new Date(timestamp);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    // Handle calendar date selection
    const handleCalendarDateSelect = useCallback((date: Date) => {
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const itemElement = itemRefs.current.get(dateKey);

        if (itemElement) {
            itemElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        const monthElement = monthRefs.current.get(monthKey);
        if (monthElement) {
            monthElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, []);

    // Map photos to MediaViewerItems for the viewer
    const viewerItems = useMemo((): MediaViewerItem[] => {
        return photos.map((photo) => ({
            src: photo.src,
            type: 'picture' as const,
            timestamp: photo.publishedAt,
            sourceLabel: photo.blogTitle,
            onSourceJump: () => {
                // Close viewer and gallery, then jump to the blog post
                setViewerIndex(null);
                onClose();
                const blog = blogs.find((b) => b.id === photo.blogId);
                if (blog) onJumpToBlog(blog);
            },
        }));
    }, [photos, blogs, onClose, onJumpToBlog]);

    // Render backup-not-enabled state
    if (isOpen && !backupEnabled) {
        return (
            <BaseModal
                isOpen={isOpen}
                onClose={onClose}
                title={t('blogGallery.title')}
                icon={Image}
                maxWidth="max-w-4xl"
                className="h-[80vh]"
            >
                <div className="flex-1 flex items-center justify-center py-12">
                    <ModalEmptyState
                        icon={Image}
                        message={t('blogGallery.emptyNoBackup')}
                    />
                </div>
            </BaseModal>
        );
    }

    // Track which dates we've seen for item refs
    const seenDates = new Set<string>();

    return (
        <>
            <BaseModal
                isOpen={isOpen}
                onClose={onClose}
                title={t('blogGallery.title')}
                icon={Image}
                maxWidth="max-w-4xl"
                className="h-[80vh]"
                footer={
                    <div className="bg-gray-50 px-4 py-3 border-t border-gray-100 flex justify-between items-center">
                        <span className="text-sm text-gray-500">
                            {t('blogGallery.count', { count: photos.length })}
                        </span>
                        <button
                            onClick={() => setShowCalendar(true)}
                            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm font-medium px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                            <Calendar className="w-4 h-4" />
                            {t('blogGallery.jumpToDate')}
                        </button>
                    </div>
                }
            >
                {/* Content */}
                {loading ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-12 gap-4">
                        <div className="relative">
                            <div
                                className="w-10 h-10 rounded-full animate-spin"
                                style={{
                                    background: `conic-gradient(from 0deg, transparent, ${theme.primaryColor})`,
                                }}
                            />
                            <div className="absolute inset-1 rounded-full bg-white" />
                        </div>
                        <span className="text-sm text-gray-400">{t('blogGallery.loading')}</span>
                    </div>
                ) : photos.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center py-12">
                        <ModalEmptyState
                            icon={Image}
                            message={t('blogGallery.emptyNoPhotos')}
                        />
                    </div>
                ) : (
                    <div ref={scrollContainerRef} className="bg-white">
                        {groupedPhotos.map((group) => (
                            <div
                                key={group.key}
                                ref={(el) => {
                                    if (el) monthRefs.current.set(group.key, el);
                                }}
                            >
                                {/* Month header */}
                                <div className="px-4 py-3 text-sm font-medium text-gray-700 bg-white sticky top-0 z-10">
                                    {group.label}
                                </div>

                                {/* Grid */}
                                <div className="grid grid-cols-4 gap-0.5 px-1">
                                    {group.items.map((item, itemIdx) => {
                                        const dateKey = formatDateKey(item.publishedAt);
                                        const isFirstOfDate = !seenDates.has(dateKey);
                                        if (isFirstOfDate) seenDates.add(dateKey);

                                        // Find the index in the flat photos array for viewer navigation
                                        const flatIndex = photos.indexOf(item);

                                        return (
                                            <button
                                                key={`${item.blogId}-${item.imageIndex}`}
                                                ref={isFirstOfDate ? (el) => {
                                                    if (el) itemRefs.current.set(dateKey, el);
                                                } : undefined}
                                                onClick={() => setViewerIndex(flatIndex)}
                                                className="aspect-square relative bg-gray-100"
                                            >
                                                <SafeImage
                                                    src={item.src}
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </BaseModal>

            {/* Photo Viewer */}
            {viewerIndex !== null && (
                <MediaViewerModal
                    mediaItems={viewerItems}
                    currentIndex={viewerIndex}
                    onClose={() => setViewerIndex(null)}
                    onNavigate={setViewerIndex}
                />
            )}

            {/* Calendar */}
            <CalendarModal
                isOpen={showCalendar}
                onClose={() => setShowCalendar(false)}
                title={t('blogGallery.jumpToDate')}
                dates={dateCounts}
                onSelectDate={handleCalendarDateSelect}
            />
        </>
    );
};
```

- [ ] **Step 2: Verify no type errors**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: PASS — all imports resolve, types align with the extensions from Tasks 1-3.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/blogs/components/BlogPhotoGalleryModal.tsx
git commit -m "feat(blogs): add BlogPhotoGalleryModal component"
```

---

### Task 6: Add photo gallery button to `MemberTimelineModal`

**Files:**
- Modify: `frontend/src/features/blogs/components/MemberTimelineModal.tsx:10-18` (props), `130-143` (header)

- [ ] **Step 1: Add `onOpenPhotoGallery` prop**

In `frontend/src/features/blogs/components/MemberTimelineModal.tsx`, add the prop to the interface:

```typescript
interface MemberTimelineModalProps {
    isOpen: boolean;
    onClose: () => void;
    member: BlogMember;
    blogs: BlogMeta[];
    loading: boolean;
    error: string | null;
    onSelectBlog: (blog: BlogMeta) => void;
    onRetry: () => void;
    onOpenPhotoGallery?: () => void;
}
```

Destructure it in the component:

```typescript
export const MemberTimelineModal: React.FC<MemberTimelineModalProps> = ({
    isOpen,
    onClose,
    member,
    blogs,
    loading,
    error,
    onSelectBlog,
    onRetry,
    onOpenPhotoGallery,
}) => {
```

- [ ] **Step 2: Add the photo gallery button in the header**

Add the `Image` icon to imports:

```typescript
import { Image } from 'lucide-react';
```

In the header section (around line 130-143), add a button next to the post count:

```tsx
<div className="flex items-center justify-between">
    <h2
        className="text-xl font-bold"
        style={{ color: theme.memberNameColor }}
    >
        {memberNameJp}
    </h2>
    <div className="flex items-center gap-3">
        {onOpenPhotoGallery && (
            <button
                onClick={onOpenPhotoGallery}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full transition-all duration-200 hover:scale-105"
                style={{
                    color: theme.primaryColor,
                    background: `${theme.primaryColor}15`,
                }}
                title={t('blogGallery.button')}
            >
                <Image className="w-4 h-4" />
                {t('blogGallery.button')}
            </button>
        )}
        {blogs.length > 0 && (
            <span className="text-sm text-gray-400">
                {t('blogs.post', { count: blogs.length })}
            </span>
        )}
    </div>
</div>
```

- [ ] **Step 3: Verify no type errors**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: PASS — the new prop is optional, so existing callers don't break.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/blogs/components/MemberTimelineModal.tsx
git commit -m "feat(blogs): add photo gallery button to MemberTimelineModal"
```

---

### Task 7: Wire up `BlogPhotoGalleryModal` in `BlogsFeature`

**Files:**
- Modify: `frontend/src/features/blogs/BlogsFeature.tsx`

- [ ] **Step 1: Add state and import**

Add the import at the top of `BlogsFeature.tsx`:

```typescript
import { BlogPhotoGalleryModal } from './components/BlogPhotoGalleryModal';
```

Add state variables near the other modal state (around the `isTimelineModalOpen` state):

```typescript
const [isPhotoGalleryOpen, setIsPhotoGalleryOpen] = useState(false);
```

- [ ] **Step 2: Add the gallery open handler**

Near `handleSelectBlogFromTimeline` (around line 408), add:

```typescript
const handleOpenPhotoGallery = () => {
    setIsPhotoGalleryOpen(true);
};
```

- [ ] **Step 3: Add the jump-to-blog handler for the gallery**

Near the same area, add a handler for when the user clicks a source label in the viewer:

```typescript
const handleJumpToBlogFromGallery = (blog: BlogMeta) => {
    if (timelineMember) {
        setIsPhotoGalleryOpen(false);
        setIsTimelineModalOpen(false);
        setViewState({ view: 'reader', blog, member: timelineMember, content: null, fromView: 'timeline' });
    }
};
```

- [ ] **Step 4: Pass the callback to `MemberTimelineModal`**

Find the `<MemberTimelineModal>` JSX (around line 488) and add the `onOpenPhotoGallery` prop:

```tsx
<MemberTimelineModal
    isOpen={isTimelineModalOpen}
    onClose={() => setIsTimelineModalOpen(false)}
    member={timelineMember}
    blogs={memberBlogs}
    loading={timelineLoading}
    error={timelineError}
    onSelectBlog={handleSelectBlogFromTimeline}
    onRetry={handleTimelineRetry}
    onOpenPhotoGallery={handleOpenPhotoGallery}
/>
```

- [ ] **Step 5: Render the `BlogPhotoGalleryModal`**

Add the modal render next to the `MemberTimelineModal` render:

```tsx
{timelineMember && (
    <BlogPhotoGalleryModal
        isOpen={isPhotoGalleryOpen}
        onClose={() => setIsPhotoGalleryOpen(false)}
        memberName={timelineMember.name}
        memberId={timelineMember.id}
        blogs={timelineBlogs}
        serviceId={activeService ?? ''}
        onJumpToBlog={handleJumpToBlogFromGallery}
    />
)}
```

- [ ] **Step 6: Verify no type errors**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/blogs/BlogsFeature.tsx
git commit -m "feat(blogs): wire up BlogPhotoGalleryModal in BlogsFeature"
```

---

### Task 8: Manual testing and verification

- [ ] **Step 1: Start the dev server**

Run: `cd frontend && npm run dev`

- [ ] **Step 2: Test the happy path**

1. Navigate to Blogs feature
2. Select a member with full blog backup enabled
3. Open their timeline modal
4. Click the "Photo Gallery" button
5. Verify: grid loads with photos grouped by month
6. Verify: clicking a photo opens the viewer with blog title as source label
7. Verify: arrow keys navigate through all photos
8. Verify: clicking the blog title label closes viewer+gallery and opens that blog post
9. Verify: calendar jump works — dots appear on dates with photos, clicking scrolls to correct position

- [ ] **Step 3: Test edge cases**

1. Test with backup disabled — should show the "enable backup" empty state
2. Test with a member who has no blog posts — should show "no photos" empty state
3. Test with a member whose blogs have no inline images — should show "no photos" empty state
4. Test escape key closes the gallery modal
5. Test escape key in viewer closes only the viewer, not the gallery

- [ ] **Step 4: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix(blogs): address issues found during blog photo gallery testing"
```
