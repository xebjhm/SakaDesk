import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Image as ImageIcon, Film, Volume2, Calendar, VolumeX, Download, X } from 'lucide-react';
import { cn, formatDateTime, formatDuration, formatDownloadFilename } from '../../utils/classnames';
import { downloadMedia } from '../../utils/download';
import type { Message } from '../../types';
import { VoicePlayer } from './VoicePlayer';
import { VideoPlayer } from './VideoPlayer';
import { LazyVideo } from './LazyVideo';
import { PhotoPlayer } from './PhotoPlayer';
import { Modal, Button, IconButton, Avatar } from '../../design/primitives';
import { DialogStatus } from '../common/DialogStatus';
import { CalendarModal } from '../modals/CalendarModal';
import type { BaseModalProps } from '../../types/modal';
import { useAppStore } from '../../store/appStore';
import { groupRoles } from '../../design/tokens';
import { serviceGroupId } from '../../config/serviceGroup';
import { useTranslation } from '../../i18n';
import { useClipboardShortcut } from './useClipboardShortcut';
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
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-group',
                isSelected ? 'bg-group-subtle' : 'hover:bg-sunken',
            )}
        >
            <Avatar src={memberAvatar} name={memberName} size="md" className="h-12 w-12" decorative />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={cn('text-small font-semibold', isSelected ? 'text-group-strong' : 'text-primary')}>{memberName}</span>
                {previewText ? (
                    <span className="truncate text-caption text-muted">{previewText}</span>
                ) : isSelected ? (
                    <span className="text-caption italic text-muted">{t('transcription.noTranscript')}</span>
                ) : null}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1 text-small">
                <span className="text-muted">{formatDateTime(item.timestamp)}</span>
                <span className={cn('tabular-nums', isSelected ? 'text-group-strong' : 'text-muted')}>{formatDuration(item.media_duration)}</span>
            </span>
        </button>
    );
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
}) => {
    // Get per-service theme colors
    const activeService = useAppStore((state) => state.activeService);
    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);
    const voiceAccent = groupRoles(serviceGroupId(activeService)).action;
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

    const getMediaUrl = (mediaFile: string) => {
        // media_file is relative to service dir (e.g., "messages/62 石森 璃花/.../picture/123.jpg")
        // API expects full path from output dir with service prefix
        const encodedPath = mediaFile.split('/').map(encodeURIComponent).join('/');
        return serviceId
            ? `/api/content/media/${encodeURIComponent(serviceId)}/${encodedPath}`
            : `/api/content/media/${encodedPath}`;
    };

    // Format date to YYYY-MM-DD for item refs
    const formatDateKey = (timestamp: string) => {
        const date = new Date(timestamp);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    // Get current tab's messages for calendar
    const currentTabMessages = useMemo(() => {
        if (activeTab === 'photos') return mediaItems.photos;
        if (activeTab === 'videos') return mediaItems.videos;
        return mediaItems.voice;
    }, [activeTab, mediaItems]);

    // Handle calendar date selection - scroll to specific item or fall back to month
    const handleCalendarDateSelect = useCallback((date: Date) => {
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const itemElement = itemRefs.current.get(dateKey);

        if (itemElement) {
            // Scroll to specific item on that date
            itemElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        // Fall back to month if no item found
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        const monthElement = monthRefs.current.get(monthKey);

        if (monthElement) {
            monthElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, []);

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

        // Gallery grid reads left-to-right (newest top-left, oldest bottom-right).
        // Right = next in grid = index+1 (older).
        // Left = prev in grid = index-1 (newer).
        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                if (currentIdx > 0) {
                    setSelectedMedia(currentTabItems[currentIdx - 1]);
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (currentIdx < currentTabItems.length - 1) {
                    setSelectedMedia(currentTabItems[currentIdx + 1]);
                }
                break;
        }
    }, [selectedMedia, currentTabItems]);

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
                <div className="flex max-h-[90vh] w-full max-w-4xl flex-col gap-4 p-4">
                    <div className="flex flex-1 items-center justify-center overflow-hidden rounded-card bg-viewer-stage">
                        {selectedMedia.type === 'picture' && mediaUrl && (
                            <PhotoPlayer variant="fullscreen" src={mediaUrl} alt={t('common.mediaViewer')} className="max-h-[80vh]" />
                        )}
                        {selectedMedia.type === 'video' && mediaUrl && (
                            <VideoPlayer
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
                            <span>{memberName}</span>
                            <span aria-hidden="true" className="mx-2">•</span>
                            {handleSourceJump ? (
                                <button
                                    type="button"
                                    onClick={() => handleSourceJump(selectedMedia.id)}
                                    className="rounded-pill underline decoration-viewer underline-offset-2 transition-colors duration-fast ease-standard hover:text-viewer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group"
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

    // Render icon-only tabs (like official app) - sticky at top of scroll container
    const renderTabs = () => (
        <div role="tablist" aria-label={t('media.typeTabs')} className="sticky top-0 z-20 flex shrink-0 bg-sheet">
            {MEDIA_TABS.map((tab) => {
                const selected = activeTab === tab.id;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-label={t(tab.labelKey)}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            'relative flex flex-1 items-center justify-center py-3 transition-colors duration-fast ease-standard',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-group',
                            selected ? 'text-group-strong' : 'text-muted hover:text-secondary',
                        )}
                    >
                        <tab.icon className="h-6 w-6" />
                        {selected && <span aria-hidden="true" className="absolute bottom-0 left-4 right-4 h-1 rounded-pill bg-group-accent" />}
                    </button>
                );
            })}
        </div>
    );

    // Render photos/videos grid with month grouping
    const renderMediaGrid = () => {
        const EmptyIcon = getEmptyIcon();
        if (groupedItems.length === 0) {
            return (
                <DialogStatus kind="empty" icon={<EmptyIcon />} title={t(`media.empty.${activeTab}`)} />
            );
        }

        // Track which dates we've seen to register only first item per date
        const seenDates = new Set<string>();

        return (
            <div ref={scrollContainerRef}>
                {groupedItems.map((group) => (
                    <div
                        key={group.key}
                        ref={(el) => {
                            if (el) monthRefs.current.set(group.key, el);
                        }}
                    >
                        {/* Month header - sticky below tabs (top-12 = tabs height) */}
                        <div className="sticky top-12 z-10 bg-sheet px-4 py-3 text-small font-semibold text-secondary">
                            {group.label}
                        </div>

                        {/* Grid */}
                        <div className="grid grid-cols-4 gap-1 px-1">
                            {group.items.map((item) => {
                                const mediaUrl = item.media_file ? getMediaUrl(item.media_file) : null;
                                if (!mediaUrl) return null;

                                const dateKey = formatDateKey(item.timestamp);
                                const isFirstOfDate = !seenDates.has(dateKey);
                                if (isFirstOfDate) seenDates.add(dateKey);

                                // Photos use PhotoPlayer's gallery-thumb (own button),
                                // videos use LazyVideo's built-in button.
                                if (activeTab === 'photos') {
                                    return (
                                        <PhotoPlayer
                                            key={item.id}
                                            variant="gallery-thumb"
                                            src={mediaUrl}
                                            onClick={() => setSelectedMedia(item)}
                                            anchorRef={isFirstOfDate ? (el) => {
                                                if (el) itemRefs.current.set(dateKey, el);
                                            } : undefined}
                                        />
                                    );
                                }

                                // Video with lazy loading
                                return (
                                    <div
                                        key={item.id}
                                        ref={isFirstOfDate ? (el) => {
                                            if (el) itemRefs.current.set(dateKey, el);
                                        } : undefined}
                                        className="aspect-square"
                                    >
                                        <LazyVideo
                                            src={mediaUrl}
                                            className="w-full h-full"
                                            onClick={() => setSelectedMedia(item)}
                                        >
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
                                        </LazyVideo>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    // Render voice list with month grouping (for jump to date support)
    const renderVoiceList = () => {
        if (groupedItems.length === 0) {
            return (
                <DialogStatus kind="empty" icon={<Volume2 />} title={t('media.empty.voice')} />
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
                            {/* Month header - sticky below tabs (top-12 = tabs height) */}
                            <div className="sticky top-12 z-10 bg-sheet px-4 py-3 text-small font-semibold text-secondary">
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
                                accentColor={voiceAccent}
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

    // Render content based on active tab
    const renderContent = () => {
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
                closeLabel={t('common.close')}
                logId="media_gallery"
                className="h-[80vh] max-w-4xl"
                bodyClassName="px-0 pb-0"
                footer={
                    <>
                        <p className="mr-auto text-small text-muted">
                            {activeTab === 'photos' && t('media.count.photos', { count: mediaItems.photos.length })}
                            {activeTab === 'videos' && t('media.count.videos', { count: mediaItems.videos.length })}
                            {activeTab === 'voice' && t('media.count.voice', { count: mediaItems.voice.length })}
                        </p>
                        <Button variant="ghost" onClick={() => setShowCalendar(true)}>
                            <Calendar className="h-4 w-4" />
                            {t('media.jumpToDate')}
                        </Button>
                    </>
                }
            >
                {renderTabs()}
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
