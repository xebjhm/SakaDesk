import React, { useState, useMemo, useRef, useCallback, useEffect, memo } from 'react';
import { Image, Calendar } from 'lucide-react';
import { Modal, Button, StatusBlock } from '../../../design/primitives';
import { logDialogLoad } from '../../../design/dialog/dialogLog';
import { formatDateTime } from '../../../utils/classnames';
import { CalendarModal } from '../../../core/modals/CalendarModal';
import { MediaViewerModal } from '../../../core/media/PhotoDetailModal';
import {
    MediaTileButton, PregenProgressBar, VirtualMediaGrid, useHeldLoading, usePregenProgress,
    type MediaGridGroup, type VirtualMediaGridHandle,
} from '../../../core/media/grid';
import type { MediaViewerItem } from '../../../core/media/PhotoDetailModal';
import type { DateCount } from '../../../core/modals/CalendarModal';
import type { BlogGalleryImage, BlogMeta } from '../../../types';
import { getBlogGallery } from '../api';
import { useTranslation } from '../../../i18n';

interface BlogPhotoGalleryModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** The member's blog list (the timeline's), used to hand the viewer's "jump to blog" the listed blog. */
    blogs: BlogMeta[];
    serviceId: string;
    /** The member whose blog photos the gallery shows (one `GET /api/blogs/gallery` per open). */
    memberId: string;
    backupEnabled: boolean;
    onJumpToBlog: (blog: BlogMeta) => void;
}

/** The settled gallery request (`key` = the request it answers, so a newer one never shows an older result). */
interface Settled {
    key: string;
    ok: boolean;
    images: BlogGalleryImage[];
}

const EMPTY: BlogGalleryImage[] = [];

const imageKey = (item: BlogGalleryImage) => `${item.blog_id}:${item.image_index}`;
const imageUrl = (item: BlogGalleryImage) => item.media_url;

/** A timestamp's local date as YYYY-MM-DD (calendar counts and jump to date). */
const formatDateKey = (timestamp: string) => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

interface BlogTileProps {
    item: BlogGalleryImage;
    flatIndex: number;
    tilePx: number;
    onOpen: (flatIndex: number) => void;
}

/**
 * One photo tile: the shared `MediaTileButton` (the media route's thumbnail, never the full
 * image). Blogs have no ★, so tiles stop at the default 480 thumbnail. A failed tile retries on
 * click instead of opening the viewer, and its accessible name says so.
 */
const BlogTile = memo(function BlogTile({ item, flatIndex, tilePx, onOpen }: BlogTileProps) {
    const { t } = useTranslation();
    const date = formatDateTime(item.published_at);
    return (
        <MediaTileButton
            url={item.media_url}
            kind="picture"
            cssPx={tilePx}
            label={t('media.gallery.openPhoto', { date })}
            retryLabel={t('media.gallery.retryPhoto', { date })}
            onOpen={() => onOpen(flatIndex)}
        />
    );
});

/**
 * The member blog photo gallery: one `getBlogGallery` request per open (the backend lists every
 * cached image in one pass), then the shared virtualised grid (`VirtualMediaGrid grid="blogs"`)
 * with month headers. Grid-level states: the first load (`StatusBlock` after the L1 reveal, held
 * at least `minVisible`, slow and very-slow copy), an error with Retry (the same request again),
 * the unchanged empty and no-backup states, and the quiet "Preparing thumbnails" bar while the
 * background worker runs. Logs `dialog_load` (`blog_gallery`: `ok` with the image count, `error`,
 * or `cancelled` when it closes first); codes and counts only.
 */
export const BlogPhotoGalleryModal: React.FC<BlogPhotoGalleryModalProps> = ({
    isOpen,
    onClose,
    blogs,
    serviceId,
    memberId,
    backupEnabled,
    onJumpToBlog,
}) => {
    const { t } = useTranslation();

    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const [showCalendar, setShowCalendar] = useState(false);
    const [reload, setReload] = useState(0);
    // Each open is a new request (derived during render, so a reopen never shows the last open's grid for a frame).
    const [openSeq, setOpenSeq] = useState(0);
    const [wasOpen, setWasOpen] = useState(false);
    if (isOpen !== wasOpen) {
        setWasOpen(isOpen);
        if (isOpen) setOpenSeq((n) => n + 1);
    }
    const requestKey = isOpen && backupEnabled ? `${openSeq}|${reload}|${serviceId}|${memberId}` : null;
    const [settled, setSettled] = useState<Settled | null>(null);

    useEffect(() => {
        if (requestKey === null) return undefined;
        let cancelled = false;
        const controller = new AbortController();
        getBlogGallery(serviceId, memberId, controller.signal).then(
            (data) => {
                if (cancelled) { logDialogLoad('blog_gallery', 'cancelled'); return; }
                const images = Array.isArray(data?.images) ? data.images : EMPTY;
                setSettled({ key: requestKey, ok: true, images });
                logDialogLoad('blog_gallery', 'ok', images.length);
            },
            () => {
                if (cancelled) { logDialogLoad('blog_gallery', 'cancelled'); return; }
                setSettled({ key: requestKey, ok: false, images: EMPTY });
                logDialogLoad('blog_gallery', 'error');
            },
        );
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [requestKey, serviceId, memberId]);

    const current = settled !== null && settled.key === requestKey ? settled : null;
    const status: 'loading' | 'error' | 'ready' = current === null ? 'loading' : current.ok ? 'ready' : 'error';
    const photos = current?.ok ? current.images : EMPTY;

    // The Modal body scrolls the grid (`customScrollParent`); the grid mounts once it is known.
    const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
    const gridRef = useRef<VirtualMediaGridHandle>(null);

    // Month groups, newest first (the images arrive newest first).
    const groups = useMemo((): MediaGridGroup<BlogGalleryImage>[] => {
        const byMonth = new Map<string, BlogGalleryImage[]>();
        for (const item of photos) {
            const date = new Date(item.published_at);
            const key = `${date.getFullYear()}-${date.getMonth()}`;
            const list = byMonth.get(key);
            if (list) list.push(item);
            else byMonth.set(key, [item]);
        }
        return Array.from(byMonth, ([key, items]) => {
            const date = new Date(items[0].published_at);
            return { key, label: `${date.getFullYear()} / ${(date.getMonth() + 1).toString().padStart(2, '0')}`, items };
        });
    }, [photos]);

    // The viewer's list is the grid's flat order.
    const flatPhotos = useMemo(() => groups.flatMap((g) => g.items), [groups]);

    const dateCounts = useMemo((): DateCount[] => {
        const counts = new Map<string, number>();
        for (const item of flatPhotos) {
            const key = formatDateKey(item.published_at);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return Array.from(counts, ([date, count]) => ({ date, count }));
    }, [flatPhotos]);

    // Local date → the flat grid index of its first (newest) photo.
    const firstIndexByDate = useMemo(() => {
        const map = new Map<string, number>();
        flatPhotos.forEach((item, i) => {
            const key = formatDateKey(item.published_at);
            if (!map.has(key)) map.set(key, i);
        });
        return map;
    }, [flatPhotos]);

    // The grid unmounts far rows, so the calendar scrolls by index, never by a DOM lookup.
    const handleCalendarDateSelect = useCallback((date: Date) => {
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const flatIndex = firstIndexByDate.get(dateKey);
        if (flatIndex !== undefined) gridRef.current?.scrollToItem(flatIndex);
        else gridRef.current?.scrollToGroup(`${date.getFullYear()}-${date.getMonth()}`);
    }, [firstIndexByDate]);

    const viewerItems = useMemo((): MediaViewerItem[] => {
        return flatPhotos.map((photo) => ({
            src: photo.src,
            type: 'picture' as const,
            timestamp: photo.published_at,
            sourceLabel: `${formatDateTime(photo.published_at)} — ${photo.title}`,
            onSourceJump: () => {
                // Close viewer and gallery, then jump to the blog post (the listed one, else built from the photo).
                setViewerIndex(null);
                onClose();
                const blog = blogs.find((b) => b.id === photo.blog_id)
                    ?? { id: photo.blog_id, title: photo.title, published_at: photo.published_at, url: '', thumbnail: null, cached: true };
                onJumpToBlog(blog);
            },
        }));
    }, [flatPhotos, blogs, onClose, onJumpToBlog]);

    const openViewer = useCallback((flatIndex: number) => setViewerIndex(flatIndex), []);
    const renderTile = useCallback(
        (item: BlogGalleryImage, flatIndex: number, tilePx: number) => (
            <BlogTile item={item} flatIndex={flatIndex} tilePx={tilePx} onOpen={openViewer} />
        ),
        [openViewer],
    );

    // L1 timing: shown after `reveal`, slow / very-slow copy, held at least `minVisible`.
    const showLoading = useHeldLoading(requestKey !== null && status === 'loading');
    const pregen = usePregenProgress(requestKey !== null && status === 'ready' && photos.length > 0, serviceId);

    if (isOpen && !backupEnabled) {
        return (
            <Modal isOpen onClose={onClose} title={t('blogGallery.title')} icon={<Image />} closeLabel={t('common.close')} logId="blog_gallery" className="h-[80vh] max-w-4xl">
                <StatusBlock kind="empty" variant="dialog" surface="blog_gallery" icon={<Image />} title={t('blogGallery.emptyNoBackup')} />
            </Modal>
        );
    }

    const renderContent = () => {
        if (showLoading) {
            return <StatusBlock kind="loading" variant="dialog" surface="blog_gallery" label={t('blogGallery.loading')} labelVisibility="always" />;
        }
        if (status === 'error') {
            return <StatusBlock kind="error" variant="dialog" surface="blog_gallery" onRetry={() => setReload((n) => n + 1)} />;
        }
        if (photos.length === 0) {
            return <StatusBlock kind="empty" variant="dialog" surface="blog_gallery" icon={<Image />} title={t('blogGallery.emptyNoPhotos')} />;
        }
        if (!bodyEl) return null;
        return (
            <VirtualMediaGrid<BlogGalleryImage>
                ref={gridRef}
                groups={groups}
                itemKey={imageKey}
                mediaUrl={imageUrl}
                renderTile={renderTile}
                scrollParent={bodyEl}
                grid="blogs"
                className="px-1"
            />
        );
    };

    const ready = !showLoading && status === 'ready';

    return (
        <>
            <Modal
                isOpen={isOpen}
                onClose={onClose}
                title={t('blogGallery.title')}
                icon={<Image />}
                closeLabel={t('common.close')}
                logId="blog_gallery"
                className="h-[80vh] max-w-4xl"
                bodyClassName="px-0 pb-0 pt-0"
                bodyRef={setBodyEl}
                footer={
                    <>
                        {/* An empty count while loading keeps the Jump to date button on the right. */}
                        <div className="mr-auto flex min-w-0 flex-1 flex-col gap-1">
                            <p className="text-small text-muted">{ready ? t('blogGallery.count', { count: photos.length }) : null}</p>
                            {/* Quiet background progress: thumbnails still being prepared (or paused). */}
                            {ready && pregen && <PregenProgressBar progress={pregen} />}
                        </div>
                        <Button variant="ghost" onClick={() => setShowCalendar(true)}>
                            <Calendar className="h-4 w-4" />
                            {t('blogGallery.jumpToDate')}
                        </Button>
                    </>
                }
            >
                {renderContent()}
            </Modal>

            {/* Photo Viewer */}
            {viewerIndex !== null && (
                <MediaViewerModal
                    mediaItems={viewerItems}
                    currentIndex={viewerIndex}
                    onClose={() => setViewerIndex(null)}
                    onNavigate={setViewerIndex}
                    order="newest_first"
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
