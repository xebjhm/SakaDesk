import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Image, Calendar } from 'lucide-react';
import { BaseModal, ModalEmptyState } from '../../../core/common';
import { PhotoPlayer } from '../../../core/media/PhotoPlayer';
import { formatDateTime } from '../../../utils/classnames';
import { CalendarModal } from '../../../core/modals/CalendarModal';
import { MediaViewerModal } from '../../../core/media/PhotoDetailModal';
import type { MediaViewerItem } from '../../../core/media/PhotoDetailModal';
import type { DateCount } from '../../../core/modals/CalendarModal';
import type { BlogMeta } from '../../../types';
import { useBlogTheme } from '../hooks';
import { getBlogContent } from '../api';
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
    blogs: BlogMeta[];
    serviceId: string;
    backupEnabled: boolean;
    onJumpToBlog: (blog: BlogMeta) => void;
}

export const BlogPhotoGalleryModal: React.FC<BlogPhotoGalleryModalProps> = ({
    isOpen,
    onClose,
    blogs,
    serviceId,
    backupEnabled,
    onJumpToBlog,
}) => {
    const theme = useBlogTheme();
    const { t } = useTranslation();

    const [photos, setPhotos] = useState<BlogPhotoItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const [showCalendar, setShowCalendar] = useState(false);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const monthRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const itemRefs = useRef<Map<string, HTMLElement>>(new Map());

    useEffect(() => {
        if (!isOpen || !backupEnabled) return;

        let cancelled = false;
        const loadPhotos = async () => {
            setLoading(true);
            monthRefs.current.clear();
            itemRefs.current.clear();

            const cachedBlogs = blogs.filter((b) => b.cached);
            const results = await Promise.allSettled(
                cachedBlogs.map((blog) => getBlogContent(serviceId, blog.id).then((content) => ({ blog, content })))
            );

            if (cancelled) return;

            const allPhotos: BlogPhotoItem[] = [];
            for (const result of results) {
                if (result.status !== 'fulfilled') continue;
                const { blog, content } = result.value;
                content.images.forEach((img, idx) => {
                    if (img.local_url) {
                        allPhotos.push({
                            src: img.local_url,
                            blogId: blog.id,
                            blogTitle: blog.title,
                            publishedAt: blog.published_at,
                            imageIndex: idx,
                        });
                    }
                });
            }

            allPhotos.sort((a, b) => {
                const dateDiff = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
                if (dateDiff !== 0) return dateDiff;
                return a.imageIndex - b.imageIndex;
            });
            setPhotos(allPhotos);
            setLoading(false);
        };

        loadPhotos();
        return () => { cancelled = true; };
    }, [isOpen, backupEnabled, blogs, serviceId]);

    // Pre-built index for O(1) flat-array lookups in the grid
    const photoIndexMap = useMemo(() => {
        const map = new Map<BlogPhotoItem, number>();
        photos.forEach((item, idx) => map.set(item, idx));
        return map;
    }, [photos]);

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

    const dateCounts = useMemo((): DateCount[] => {
        const counts = new Map<string, number>();
        photos.forEach((item) => {
            const date = new Date(item.publishedAt);
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            counts.set(dateStr, (counts.get(dateStr) || 0) + 1);
        });
        return Array.from(counts.entries()).map(([date, count]) => ({ date, count }));
    }, [photos]);

    const formatDateKey = (timestamp: string) => {
        const date = new Date(timestamp);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

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

    const viewerItems = useMemo((): MediaViewerItem[] => {
        return photos.map((photo) => ({
            src: photo.src,
            type: 'picture' as const,
            timestamp: photo.publishedAt,
            sourceLabel: `${formatDateTime(photo.publishedAt)} — ${photo.blogTitle}`,
            onSourceJump: () => {
                // Close viewer and gallery, then jump to the blog post
                setViewerIndex(null);
                onClose();
                const blog = blogs.find((b) => b.id === photo.blogId);
                if (blog) onJumpToBlog(blog);
            },
        }));
    }, [photos, blogs, onClose, onJumpToBlog]);

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
                                    {group.items.map((item) => {
                                        const dateKey = formatDateKey(item.publishedAt);
                                        const isFirstOfDate = !seenDates.has(dateKey);
                                        if (isFirstOfDate) seenDates.add(dateKey);

                                        const flatIndex = photoIndexMap.get(item) ?? 0;

                                        return (
                                            <PhotoPlayer
                                                key={`${item.blogId}-${item.imageIndex}`}
                                                variant="gallery-thumb"
                                                src={item.src}
                                                onClick={() => setViewerIndex(flatIndex)}
                                                anchorRef={isFirstOfDate ? (el) => {
                                                    if (el) itemRefs.current.set(dateKey, el);
                                                } : undefined}
                                            />
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
