import React, { useState, useMemo, useRef, useCallback, useEffect, memo } from 'react';
import { Image as ImageIcon, Film, Volume2, Calendar, VolumeX, Download, X, ZoomIn, ZoomOut, Shrink } from 'lucide-react';
import { cn, formatDateTime, formatDuration, formatDownloadFilename } from '../../utils/classnames';
import { timeNeighbours } from '../../utils/timeOrder';
import { downloadMedia } from '../../utils/download';
import type { Message } from '../../types';
import { VoicePlayer } from './VoicePlayer';
import { VideoPlayer } from './VideoPlayer';
import { PhotoPlayer } from './PhotoPlayer';
import { Modal, Button, IconButton, Avatar, StatusBlock, ProgressBar } from '../../design/primitives';
import {
    MediaTile, VirtualMediaGrid, useHeldLoading, usePregenProgress, type MediaGridGroup, type VirtualMediaGridHandle,
} from './grid';
import { CalendarModal } from '../modals/CalendarModal';
import type { BaseModalProps } from '../../types/modal';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { useClipboardShortcut } from './useClipboardShortcut';
import { useZoomPan, MIN_ZOOM, MAX_ZOOM } from './useZoomPan';
import { useTranscription } from '../../hooks/useTranscription';

interface MediaGalleryModalProps extends BaseModalProps {
    messages: Message[];
    memberName: string;
    memberAvatar?: string;
    serviceId?: string;  // Service ID for building correct media URLs
    memberPath?: string; // Relative path to member directory for transcription
    /**
     * Called when the user clicks "jump to message" on any media item. The
     * host is responsible for closing the gallery (and any wrapping menu)
     * and scrolling the message list to the target message.
     */
    onSourceJump?: (messageId: number) => void;
    /**
     * The room's message list (the gallery's items): `loading` while its first load runs (a
     * `StatusBlock` after the L1 reveal delay, held at least `minVisible`), `error` when it failed
     * (a `StatusBlock` with Retry, `onRetryList`). Default `ready`.
     */
    listStatus?: 'loading' | 'error' | 'ready';
    /** Retry the failed list load (the error state's Retry button). */
    onRetryList?: () => void;
}

type MediaTab = 'photos' | 'videos' | 'voice';

interface VoiceRowProps {
    item: Message;
    isSelected: boolean;
    onSelect: () => void;
    memberName: string;
    memberAvatar?: string;
    serviceId?: string;
    memberPath?: string;
    dateAnchorRef?: (el: HTMLButtonElement | null) => void;
}

/**
 * A single row in the voice list. Fetches its own cached transcription so the
 * preview text stays paired with its owning message instead of sliding to
 * whichever row was last clicked.
 */
const VoiceRow: React.FC<VoiceRowProps> = ({
    item,
    isSelected,
    onSelect,
    memberName,
    memberAvatar,
    serviceId,
    memberPath,
    dateAnchorRef,
}) => {
    const { t } = useTranslation();
    const { transcription } = useTranscription(serviceId, item.id, memberPath);
    const previewText = transcription?.full_text;

    return (
        <button
            ref={dateAnchorRef}
            type="button"
            onClick={onSelect}
            aria-pressed={isSelected}
            className={cn(
                'flex w-full items-center gap-3 rounded-card px-4 py-4 text-left transition-colors duration-fast ease-standard',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                isSelected ? 'bg-accent-subtle' : 'hover:bg-sunken',
            )}
        >
            <Avatar src={memberAvatar} name={memberName} size="md" className="h-12 w-12" decorative />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span lang="ja" className={cn('text-small font-semibold', isSelected ? 'text-accent-strong' : 'text-primary')}>{memberName}</span>
                {previewText ? (
                    <span lang="ja" className="truncate text-caption text-muted">{previewText}</span>
                ) : isSelected ? (
                    <span className="text-caption italic text-muted">{t('transcription.noTranscript')}</span>
                ) : null}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1 text-small">
                <span className="text-muted">{formatDateTime(item.timestamp)}</span>
                <span className={cn('tabular-nums', isSelected ? 'text-accent-strong' : 'text-muted')}>{formatDuration(item.media_duration)}</span>
            </span>
        </button>
    );
};

interface GalleryTileProps {
    item: Message;
    url: string;
    kind: 'picture' | 'video';
    tilePx: number;
    onOpen: (item: Message) => void;
}

/**
 * One photo / video tile of the grid: a labelled button around the shared `MediaTile` (a
 * thumbnail or poster, never a full-size image or a `<video>`), with the video mute and duration
 * overlays. ★ items ask for the large (640) thumbnail, which pre-generation makes for them. A tile
 * whose image failed retries on click (the `onFail` handle) instead of opening the viewer.
 */
const GalleryTile = memo(function GalleryTile({ item, url, kind, tilePx, onOpen }: GalleryTileProps) {
    const { t } = useTranslation();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const retryRef = useRef<(() => void) | null>(null);
    const onFail = useCallback((retry: () => void) => { retryRef.current = retry; }, []);
    const onClick = () => {
        const failed = buttonRef.current?.querySelector('[data-state="failed"]') !== null;
        if (failed && retryRef.current) {
            retryRef.current();
            return;
        }
        onOpen(item);
    };
    return (
        <button
            ref={buttonRef}
            type="button"
            onClick={onClick}
            aria-label={t(kind === 'picture' ? 'media.gallery.openPhoto' : 'media.gallery.openVideo', { date: formatDateTime(item.timestamp) })}
            className="relative block aspect-square w-full overflow-hidden bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
            <MediaTile url={url} kind={kind} cssPx={tilePx} large={item.is_favorite === true} onFail={onFail} className="h-full w-full" />
            {kind === 'video' && (
                <>
                    {/* Mute icon - bottom left with background like official app */}
                    {item.is_muted && (
                        <div className="absolute bottom-1 left-1 rounded-pill bg-toast p-1">
                            <VolumeX className="h-4 w-4 text-viewer" />
                        </div>
                    )}
                    {/* Duration overlay - bottom right */}
                    <div className="absolute bottom-1 right-1 rounded-pill bg-toast px-2 text-caption tabular-nums text-viewer">
                        {formatDuration(item.media_duration)}
                    </div>
                </>
            )}
        </button>
    );
});

const messageKey = (item: Message) => String(item.id);

/** A timestamp's local date as YYYY-MM-DD (jump to date). */
const formatDateKey = (timestamp: string) => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

// Tab configuration - module level constant to avoid recreation on each render
const MEDIA_TABS: { id: MediaTab; icon: React.ElementType; labelKey: string }[] = [
    { id: 'photos', icon: ImageIcon, labelKey: 'media.tabs.photos' },
    { id: 'videos', icon: Film, labelKey: 'media.tabs.videos' },
    { id: 'voice', icon: Volume2, labelKey: 'media.tabs.voice' },
];

// Group items by month
interface MonthGroup {
    key: string;  // Year-month key for scrolling (e.g., "2024-11")
    label: string;
    items: Message[];
}

export const MediaGalleryModal: React.FC<MediaGalleryModalProps> = ({
    isOpen,
    onClose,
    messages,
    memberName,
    memberAvatar,
    serviceId,
    memberPath,
    onSourceJump,
    listStatus = 'ready',
    onRetryList,
}) => {
    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);
    const { t } = useTranslation();

    const [activeTab, setActiveTab] = useState<MediaTab>('photos');
    const [selectedMedia, setSelectedMedia] = useState<Message | null>(null);
    const [selectedVoice, setSelectedVoice] = useState<Message | null>(null);
    const [showCalendar, setShowCalendar] = useState(false);
    // Closing detail/voice state must happen BEFORE bubbling up — the
    // photo/video viewer is a sibling of the gallery's main dialog
    // so it wouldn't auto-close on parent state change, and leaving
    // audio running after navigating away is jarring. Memoised so
    // VoiceRow prop identity stays stable across renders.
    const handleSourceJump = useMemo(() => {
        if (!onSourceJump) return undefined;
        return (messageId: number) => {
            setSelectedMedia(null);
            setSelectedVoice(null);
            onSourceJump(messageId);
        };
    }, [onSourceJump]);

    // Voice/video transcription is owned by the player components themselves
    // (VoicePlayer variant="gallery", VideoPlayer variant="gallery").
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    // The Modal body, the scroller (reset to the top when the tab changes).
    const bodyRef = useRef<HTMLDivElement | null>(null);
    // The same element as state: the virtual grid scrolls with it (`customScrollParent`).
    const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
    const setBody = useCallback((el: HTMLDivElement | null) => {
        bodyRef.current = el;
        setBodyEl(el);
    }, []);
    const gridRef = useRef<VirtualMediaGridHandle>(null);
    // Voice list only (a plain list): the grid jumps through `gridRef.scrollToItem` instead.
    const monthRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const itemRefs = useRef<Map<string, HTMLElement>>(new Map());  // Keyed by date string YYYY-MM-DD

    // Clipboard shortcut for detail view — active when a photo/video is selected
    const selectedMediaUrl = selectedMedia?.media_file
        ? (serviceId
            ? `/api/content/media/${encodeURIComponent(serviceId)}/${selectedMedia.media_file.split('/').map(encodeURIComponent).join('/')}`
            : `/api/content/media/${selectedMedia.media_file.split('/').map(encodeURIComponent).join('/')}`)
        : undefined;
    const { toastMessage: clipboardToast } = useClipboardShortcut(
        selectedMediaUrl,
        selectedMedia?.type as 'picture' | 'video' | 'voice' | undefined,
    );

    // Photo zoom/pan for the detail view (same hook and controls as the dark viewer); resets per item.
    const zoomStageRef = useRef<HTMLDivElement>(null);
    const detailIsPhoto = selectedMedia?.type === 'picture' && !!selectedMedia.media_file;
    const { view, dragging, step, reset, stageHandlers } = useZoomPan(zoomStageRef, detailIsPhoto, selectedMedia?.id);

    // Filter messages by media type
    const mediaItems = useMemo(() => {
        const photos = messages.filter(m => m.type === 'picture' && m.media_file);
        const videos = messages.filter(m => m.type === 'video' && m.media_file);
        const voice = messages.filter(m => m.type === 'voice' && m.media_file);
        return { photos, videos, voice };
    }, [messages]);

    // Group items by month (for all tabs)
    const groupedItems = useMemo(() => {
        const items = activeTab === 'photos' ? mediaItems.photos :
                      activeTab === 'videos' ? mediaItems.videos :
                      mediaItems.voice;

        // Sort by timestamp descending
        const sorted = [...items].sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        // Group by year-month
        const groups: Map<string, Message[]> = new Map();
        sorted.forEach(item => {
            const date = new Date(item.timestamp);
            const key = `${date.getFullYear()}-${date.getMonth()}`;
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(item);
        });

        // Convert to array
        const result: MonthGroup[] = [];
        groups.forEach((items, key) => {
            const date = new Date(items[0].timestamp);
            result.push({
                key,
                label: `${date.getFullYear()} / ${(date.getMonth() + 1).toString().padStart(2, '0')}`,
                items,
            });
        });

        return result;
    }, [activeTab, mediaItems]);

    const getMediaUrl = useCallback((mediaFile: string) => {
        // media_file is relative to service dir (e.g., "messages/62 石森 璃花/.../picture/123.jpg")
        // API expects full path from output dir with service prefix
        const encodedPath = mediaFile.split('/').map(encodeURIComponent).join('/');
        return serviceId
            ? `/api/content/media/${encodeURIComponent(serviceId)}/${encodedPath}`
            : `/api/content/media/${encodedPath}`;
    }, [serviceId]);
    const gridMediaUrl = useCallback((item: Message) => (item.media_file ? getMediaUrl(item.media_file) : null), [getMediaUrl]);

    // The grid's groups: the month groups above (items always have a media file, see `mediaItems`).
    const gridGroups = useMemo<MediaGridGroup<Message>[]>(() => groupedItems, [groupedItems]);
    // Local date (YYYY-MM-DD) → the flat grid index of its first (newest) item, for jump to date.
    const firstIndexByDate = useMemo(() => {
        const map = new Map<string, number>();
        let flat = 0;
        for (const group of gridGroups) {
            for (const item of group.items) {
                const key = formatDateKey(item.timestamp);
                if (!map.has(key)) map.set(key, flat);
                flat += 1;
            }
        }
        return map;
    }, [gridGroups]);

    // Get current tab's messages for calendar
    const currentTabMessages = useMemo(() => {
        if (activeTab === 'photos') return mediaItems.photos;
        if (activeTab === 'videos') return mediaItems.videos;
        return mediaItems.voice;
    }, [activeTab, mediaItems]);

    // Handle calendar date selection - scroll to specific item or fall back to month
    const handleCalendarDateSelect = useCallback((date: Date) => {
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        if (activeTab !== 'voice') {
            // The grid unmounts far rows, so it scrolls by index, never by a DOM lookup.
            const flatIndex = firstIndexByDate.get(dateKey);
            if (flatIndex !== undefined) gridRef.current?.scrollToItem(flatIndex);
            else gridRef.current?.scrollToGroup(monthKey);
            return;
        }
        const itemElement = itemRefs.current.get(dateKey);

        if (itemElement) {
            // Scroll to specific item on that date
            itemElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        // Fall back to month if no item found
        const monthElement = monthRefs.current.get(monthKey);

        if (monthElement) {
            monthElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [activeTab, firstIndexByDate]);

    // Get the flat sorted list of items for the current tab
    const currentTabItems = useMemo(() => {
        const items = activeTab === 'photos' ? mediaItems.photos :
                      activeTab === 'videos' ? mediaItems.videos :
                      mediaItems.voice;
        return [...items].sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
    }, [activeTab, mediaItems]);

    // Keyboard navigation for detail view
    const handleDetailKeyDown = useCallback((e: KeyboardEvent) => {
        if (!selectedMedia) return;

        const currentIdx = currentTabItems.findIndex(m => m.id === selectedMedia.id);
        if (currentIdx === -1) return;

        // The grid is newest first, but ← is always the older item and → the newer one.
        const { older, newer } = timeNeighbours(currentIdx, currentTabItems.length, 'newest_first');
        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                if (older !== null) setSelectedMedia(currentTabItems[older]);
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (newer !== null) setSelectedMedia(currentTabItems[newer]);
                break;
            // ↑ / ↓ zoom a photo; videos leave them to the player (volume).
            case 'ArrowUp':
                if (detailIsPhoto) {
                    e.preventDefault();
                    step(1);
                }
                break;
            case 'ArrowDown':
                if (detailIsPhoto) {
                    e.preventDefault();
                    step(-1);
                }
                break;
        }
    }, [selectedMedia, currentTabItems, detailIsPhoto, step]);

    useEffect(() => {
        if (!selectedMedia) return;
        document.addEventListener('keydown', handleDetailKeyDown);
        return () => document.removeEventListener('keydown', handleDetailKeyDown);
    }, [selectedMedia, handleDetailKeyDown]);

    // Detail view for selected media
    const renderDetailView = () => {
        if (!selectedMedia) return null;

        const mediaUrl = selectedMedia.media_file ? getMediaUrl(selectedMedia.media_file) : null;
        const detailIdx = currentTabItems.findIndex(m => m.id === selectedMedia.id);

        return (
            <Modal isOpen onClose={() => setSelectedMedia(null)} tone="viewer" layout="bare" aria-label={t('common.mediaViewer')} logId="media_viewer">
                <IconButton variant="overlay" className="absolute right-4 top-4 z-10" aria-label={t('common.close')} icon={<X />} onClick={() => setSelectedMedia(null)} />
                {detailIsPhoto && (
                    // aria-disabled (not disabled) at the limits, so a focused button keeps focus and ← / → keep working.
                    <div className="absolute left-4 top-4 z-10 flex gap-2">
                        <IconButton variant="overlay" aria-label={t('common.zoomOut')} icon={<ZoomOut />} aria-disabled={view.scale <= MIN_ZOOM || undefined} onClick={() => step(-1)} />
                        <IconButton variant="overlay" aria-label={t('common.zoomFit')} icon={<Shrink />} aria-disabled={view.scale <= MIN_ZOOM || undefined} onClick={reset} />
                        <IconButton variant="overlay" aria-label={t('common.zoomIn')} icon={<ZoomIn />} aria-disabled={view.scale >= MAX_ZOOM || undefined} onClick={() => step(1)} />
                    </div>
                )}
                <div className="flex max-h-[90vh] w-full max-w-4xl flex-col gap-4 p-4">
                    <div className="flex flex-1 items-center justify-center overflow-hidden rounded-card bg-viewer-stage">
                        {selectedMedia.type === 'picture' && mediaUrl && (
                            <div
                                ref={zoomStageRef}
                                data-testid="viewer-stage"
                                className={cn(
                                    'flex touch-none select-none items-center justify-center',
                                    view.scale > MIN_ZOOM && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
                                )}
                                {...stageHandlers}
                            >
                                <PhotoPlayer
                                    variant="fullscreen"
                                    src={mediaUrl}
                                    alt={t('common.mediaViewer')}
                                    zoom={view.scale}
                                    pan={view}
                                    className={cn('max-h-[80vh]', dragging && 'transition-none')}
                                />
                            </div>
                        )}
                        {selectedMedia.type === 'video' && mediaUrl && (
                            <VideoPlayer
                                key={mediaUrl}
                                src={mediaUrl}
                                variant="gallery"
                                autoPlay
                                messageTimestamp={selectedMedia.timestamp}
                                noAudio={selectedMedia.is_muted}
                                videoClassName="max-w-full max-h-[80vh]"
                                messageId={selectedMedia.id}
                                service={serviceId}
                                memberPath={memberPath}
                            />
                        )}
                    </div>
                    <div className="flex w-full items-center justify-between text-small text-viewer-muted">
                        <div>
                            <span lang="ja">{memberName}</span>
                            <span aria-hidden="true" className="mx-2">•</span>
                            {handleSourceJump ? (
                                <button
                                    type="button"
                                    onClick={() => handleSourceJump(selectedMedia.id)}
                                    className="rounded-pill underline decoration-viewer underline-offset-2 transition-colors duration-fast ease-standard hover:text-viewer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    title={t('media.jumpToMessage')}
                                >
                                    {formatDateTime(selectedMedia.timestamp)}
                                </button>
                            ) : (
                                <span>{formatDateTime(selectedMedia.timestamp)}</span>
                            )}
                            {currentTabItems.length > 1 && (
                                <>
                                    <span aria-hidden="true" className="mx-2">•</span>
                                    <span className="tabular-nums">{currentTabItems.length - detailIdx} / {currentTabItems.length}</span>
                                </>
                            )}
                        </div>
                        {selectedMedia.type === 'picture' && mediaUrl && goldenFingerActive && (
                            <Button variant="overlay" size="sm" onClick={() => downloadMedia(mediaUrl, formatDownloadFilename(mediaUrl, selectedMedia.timestamp))}>
                                <Download className="h-4 w-4" />
                                {t('common.download')}
                            </Button>
                        )}
                    </div>
                </div>
                {clipboardToast && (
                    <div role="status" className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-pill bg-toast px-4 py-2 text-small text-viewer">
                        {clipboardToast}
                    </div>
                )}
            </Modal>
        );
    };

    // Get empty state icon
    const getEmptyIcon = () => {
        switch (activeTab) {
            case 'photos': return ImageIcon;
            case 'videos': return Film;
            case 'voice': return Volume2;
        }
    };

    const selectTab = (tab: MediaTab) => {
        if (tab === activeTab) return;
        // A different tab is a different list: start at its top, not at the old offset.
        if (bodyRef.current) bodyRef.current.scrollTop = 0;
        setActiveTab(tab);
    };

    // Render icon-only tabs (like official app) - in the Modal toolbar slot (outside the scroller)
    const renderTabs = () => (
        <div role="tablist" aria-label={t('media.typeTabs')} className="flex">
            {MEDIA_TABS.map((tab) => {
                const selected = activeTab === tab.id;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-label={t(tab.labelKey)}
                        onClick={() => selectTab(tab.id)}
                        className={cn(
                            'relative flex flex-1 items-center justify-center py-3 transition-colors duration-fast ease-standard',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                            selected ? 'text-accent-strong' : 'text-muted hover:text-secondary',
                        )}
                    >
                        <tab.icon className="h-6 w-6" />
                        {selected && <span aria-hidden="true" className="absolute bottom-0 left-4 right-4 h-1 rounded-pill bg-accent-border" />}
                    </button>
                );
            })}
        </div>
    );

    const openMedia = useCallback((item: Message) => setSelectedMedia(item), []);
    const gridKind = activeTab === 'videos' ? 'video' : 'picture';
    const renderGridTile = useCallback((item: Message, _flatIndex: number, tilePx: number) => {
        const url = gridMediaUrl(item);
        if (!url) return null;
        return <GalleryTile item={item} url={url} kind={gridKind} tilePx={tilePx} onOpen={openMedia} />;
    }, [gridMediaUrl, gridKind, openMedia]);

    // Render photos/videos grid with month grouping, virtualised (rows outside the overscan unmount)
    const renderMediaGrid = () => {
        const EmptyIcon = getEmptyIcon();
        if (groupedItems.length === 0) {
            return (
                <StatusBlock kind="empty" variant="dialog" surface="media_gallery" icon={<EmptyIcon />} title={t(`media.empty.${activeTab}`)} />
            );
        }

        // The grid scrolls with the Modal body, so it mounts once the body element is known.
        if (!bodyEl) return null;
        return (
            <VirtualMediaGrid<Message>
                key={activeTab}
                ref={gridRef}
                groups={gridGroups}
                itemKey={messageKey}
                mediaUrl={gridMediaUrl}
                renderTile={renderGridTile}
                scrollParent={bodyEl}
                grid="messages"
                className="px-1"
            />
        );
    };

    // Render voice list with month grouping (for jump to date support)
    const renderVoiceList = () => {
        if (groupedItems.length === 0) {
            return (
                <StatusBlock kind="empty" variant="dialog" surface="media_gallery" icon={<Volume2 />} title={t('media.empty.voice')} />
            );
        }

        // Get all voice items for selecting current voice
        const allVoiceItems = groupedItems.flatMap(g => g.items);
        const currentVoice = selectedVoice || allVoiceItems[0];
        const currentVoiceUrl = currentVoice?.media_file ? getMediaUrl(currentVoice.media_file) : '';

        // Track which dates we've seen to register only first item per date
        const seenDates = new Set<string>();

        return (
            <>
                <div ref={scrollContainerRef}>
                    {groupedItems.map((group) => (
                        <div
                            key={group.key}
                            ref={(el) => {
                                if (el) monthRefs.current.set(group.key, el);
                            }}
                        >
                            {/* Month header - sticky to the scroller's top edge (the tabs are in the toolbar) */}
                            <div className="sticky top-0 z-10 bg-sheet px-4 py-3 text-small font-semibold text-secondary">
                                {group.label}
                            </div>

                            {/* Voice items in this month */}
                            <div className="flex flex-col gap-1 px-2">
                                {group.items.map((item) => {
                                    const mediaUrl = item.media_file ? getMediaUrl(item.media_file) : null;
                                    if (!mediaUrl) return null;

                                    const isSelected = currentVoice?.id === item.id;
                                    const dateKey = formatDateKey(item.timestamp);
                                    const isFirstOfDate = !seenDates.has(dateKey);
                                    if (isFirstOfDate) seenDates.add(dateKey);

                                    return (
                                        <VoiceRow
                                            key={item.id}
                                            item={item}
                                            isSelected={isSelected}
                                            onSelect={() => setSelectedVoice(item)}
                                            memberName={memberName}
                                            memberAvatar={memberAvatar}
                                            serviceId={serviceId}
                                            memberPath={memberPath}
                                            dateAnchorRef={isFirstOfDate ? (el) => {
                                                if (el) itemRefs.current.set(dateKey, el);
                                            } : undefined}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Bottom voice player bar - sticky at bottom with gradient blur effect */}
                <div className="sticky bottom-0 z-20 bg-sheet shadow-card">
                    <div className="px-4 py-4">
                        <div className="mx-auto max-w-lg">
                            <VoicePlayer
                                key={currentVoice?.id}
                                src={currentVoiceUrl}
                                variant="gallery"
                                avatarUrl={memberAvatar}
                                memberName={memberName}
                                timestamp={currentVoice ? formatDateTime(currentVoice.timestamp) : undefined}
                                durationText={currentVoice ? formatDuration(currentVoice.media_duration) : undefined}
                                messageTimestamp={currentVoice?.timestamp}
                                viewerMode
                                onTimestampClick={currentVoice && handleSourceJump ? () => handleSourceJump(currentVoice.id) : undefined}
                                messageId={currentVoice?.id}
                                service={serviceId}
                                memberPath={memberPath}
                            />
                        </div>
                    </div>
                </div>
            </>
        );
    };

    // The list's first load (L1 timing: shown after `reveal`, slow / very-slow copy, held at least
    // `minVisible`) and its failure; pre-generation progress while the photos / videos grid is open.
    const listLoading = useHeldLoading(isOpen && listStatus === 'loading');
    const pregen = usePregenProgress(isOpen && activeTab !== 'voice' && listStatus === 'ready', serviceId);

    // Render content based on active tab
    const renderContent = () => {
        if (listLoading) {
            return <StatusBlock kind="loading" variant="dialog" surface="media_gallery" />;
        }
        if (listStatus === 'error' && onRetryList) {
            return <StatusBlock kind="error" variant="dialog" surface="media_gallery" onRetry={onRetryList} />;
        }
        if (activeTab === 'voice') {
            return renderVoiceList();
        }
        return renderMediaGrid();
    };

    return (
        <>
            <Modal
                isOpen={isOpen}
                onClose={onClose}
                title={t('media.title')}
                icon={<ImageIcon />}
                closeLabel={t('common.close')}
                logId="media_gallery"
                className="h-[80vh] max-w-4xl"
                bodyClassName="px-0 pb-0 pt-0"
                bodyRef={setBody}
                toolbar={renderTabs()}
                footer={
                    <>
                        <div className="mr-auto flex min-w-0 flex-1 flex-col gap-1">
                            <p className="text-small text-muted">
                                {activeTab === 'photos' && t('media.count.photos', { count: mediaItems.photos.length })}
                                {activeTab === 'videos' && t('media.count.videos', { count: mediaItems.videos.length })}
                                {activeTab === 'voice' && t('media.count.voice', { count: mediaItems.voice.length })}
                            </p>
                            {pregen && (
                                // Quiet background progress: thumbnails still being prepared.
                                <ProgressBar
                                    value={pregen.done / pregen.total}
                                    label={t('settings.mediaCachePreparing', { done: pregen.done, total: pregen.total })}
                                    valueText={`${pregen.done} / ${pregen.total}`}
                                    size="thin"
                                    showLabel
                                    labelClassName="text-caption text-muted"
                                    className="max-w-xs"
                                />
                            )}
                        </div>
                        <Button variant="ghost" onClick={() => setShowCalendar(true)}>
                            <Calendar className="h-4 w-4" />
                            {t('media.jumpToDate')}
                        </Button>
                    </>
                }
            >
                {renderContent()}
            </Modal>

            {renderDetailView()}

            <CalendarModal
                isOpen={showCalendar}
                onClose={() => setShowCalendar(false)}
                title={t('media.jumpToDate')}
                messages={currentTabMessages}
                onSelectDate={handleCalendarDateSelect}
            />
        </>
    );
};
