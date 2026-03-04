import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Image, Film, Volume2, Calendar, VolumeX, Download } from 'lucide-react';
import { cn, formatDateTime, formatDuration } from '../../utils/classnames';
import type { Message } from '../../types';
import { VoicePlayer } from './VoicePlayer';
import { LazyVideo } from './LazyVideo';
import { BaseModal, DetailModal, SafeImage, ModalEmptyState } from '../common';
import { CalendarModal } from '../modals/CalendarModal';
import type { BaseModalProps } from '../../types/modal';
import { useAppStore } from '../../store/appStore';
import { getThemeForService } from '../../config/groupThemes';
import { useTranslation } from '../../i18n';

interface MediaGalleryModalProps extends BaseModalProps {
    messages: Message[];
    memberName: string;
    memberAvatar?: string;
    serviceId?: string;  // Service ID for building correct media URLs
}

type MediaTab = 'photos' | 'videos' | 'voice';

// Tab configuration - module level constant to avoid recreation on each render
const MEDIA_TABS: { id: MediaTab; icon: React.ElementType; labelKey: string }[] = [
    { id: 'photos', icon: Image, labelKey: 'media.tabs.photos' },
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
}) => {
    // Get per-service theme colors
    const activeService = useAppStore((state) => state.activeService);
    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);
    const theme = getThemeForService(activeService);
    const { t } = useTranslation();

    const [activeTab, setActiveTab] = useState<MediaTab>('photos');
    const [selectedMedia, setSelectedMedia] = useState<Message | null>(null);
    const [selectedVoice, setSelectedVoice] = useState<Message | null>(null);
    const [showCalendar, setShowCalendar] = useState(false);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const monthRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const itemRefs = useRef<Map<string, HTMLElement>>(new Map());  // Keyed by date string YYYY-MM-DD

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

    // Detail view for selected media
    const renderDetailView = () => {
        if (!selectedMedia) return null;

        const mediaUrl = selectedMedia.media_file ? getMediaUrl(selectedMedia.media_file) : null;

        return (
            <DetailModal
                isOpen={!!selectedMedia}
                onClose={() => setSelectedMedia(null)}
                footer={
                    <>
                        <span>{memberName}</span>
                        <span className="mx-2">•</span>
                        <span>{formatDateTime(selectedMedia.timestamp)}</span>
                    </>
                }
            >
                {selectedMedia.type === 'picture' && mediaUrl && (
                    <SafeImage
                        src={mediaUrl}
                        alt="Media"
                        className="max-w-full max-h-[80vh] object-contain"
                    />
                )}
                {selectedMedia.type === 'picture' && mediaUrl && goldenFingerActive && (
                    <button
                        onClick={() => {
                            const link = document.createElement('a');
                            link.href = mediaUrl;
                            link.download = mediaUrl.split('/').pop() || 'photo.jpg';
                            link.click();
                        }}
                        className="mt-2 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white rounded-lg text-sm flex items-center gap-1.5 transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        Download
                    </button>
                )}
                {selectedMedia.type === 'video' && mediaUrl && (
                    <video
                        src={mediaUrl}
                        controls
                        controlsList="nodownload"
                        autoPlay
                        className="max-w-full max-h-[80vh]"
                    />
                )}
                {selectedMedia.type === 'video' && mediaUrl && goldenFingerActive && (
                    <button
                        onClick={() => {
                            const link = document.createElement('a');
                            link.href = mediaUrl;
                            link.download = mediaUrl.split('/').pop() || 'video.mp4';
                            link.click();
                        }}
                        className="mt-2 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white rounded-lg text-sm flex items-center gap-1.5 transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        Download
                    </button>
                )}
            </DetailModal>
        );
    };

    // Get empty state icon
    const getEmptyIcon = () => {
        switch (activeTab) {
            case 'photos': return Image;
            case 'videos': return Film;
            case 'voice': return Volume2;
        }
    };

    // Render icon-only tabs (like official app) - sticky at top of scroll container
    const renderTabs = () => (
        <div
            role="tablist"
            aria-label="Media type tabs"
            className="flex bg-white border-b border-gray-200 shrink-0 sticky top-0 z-20"
        >
            {MEDIA_TABS.map((tab) => (
                <button
                    key={tab.id}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    aria-label={t(tab.labelKey)}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                        "flex-1 flex items-center justify-center py-3 transition-colors relative",
                        activeTab !== tab.id && "text-gray-400 hover:text-gray-600"
                    )}
                    style={activeTab === tab.id ? { color: theme.modals.accentColor } : undefined}
                >
                    <tab.icon className="w-6 h-6" />
                    {/* Active indicator - colored line under */}
                    {activeTab === tab.id && (
                        <div
                            className="absolute bottom-0 left-4 right-4 h-1 rounded-t"
                            style={{ backgroundColor: theme.modals.accentColorMuted }}
                        />
                    )}
                </button>
            ))}
        </div>
    );

    // Render photos/videos grid with month grouping
    const renderMediaGrid = () => {
        if (groupedItems.length === 0) {
            return (
                <div className="flex-1 flex items-center justify-center py-12">
                    <ModalEmptyState
                        icon={getEmptyIcon()}
                        message={t(`media.empty.${activeTab}`)}
                    />
                </div>
            );
        }

        // Track which dates we've seen to register only first item per date
        const seenDates = new Set<string>();

        return (
            <div ref={scrollContainerRef} className="bg-white">
                {groupedItems.map((group) => (
                    <div
                        key={group.key}
                        ref={(el) => {
                            if (el) monthRefs.current.set(group.key, el);
                        }}
                    >
                        {/* Month header - sticky below tabs (top-12 = tabs height) */}
                        <div className="px-4 py-3 text-sm font-medium text-gray-700 bg-white sticky top-12 z-10">
                            {group.label}
                        </div>

                        {/* Grid */}
                        <div className="grid grid-cols-4 gap-0.5 px-1">
                            {group.items.map((item) => {
                                const mediaUrl = item.media_file ? getMediaUrl(item.media_file) : null;
                                if (!mediaUrl) return null;

                                const dateKey = formatDateKey(item.timestamp);
                                const isFirstOfDate = !seenDates.has(dateKey);
                                if (isFirstOfDate) seenDates.add(dateKey);

                                // Photos use button wrapper, videos use LazyVideo's built-in button
                                if (activeTab === 'photos') {
                                    return (
                                        <button
                                            key={item.id}
                                            ref={isFirstOfDate ? (el) => {
                                                if (el) itemRefs.current.set(dateKey, el);
                                            } : undefined}
                                            onClick={() => setSelectedMedia(item)}
                                            className="aspect-square relative bg-gray-100"
                                        >
                                            <SafeImage
                                                src={mediaUrl}
                                                alt=""
                                                className="w-full h-full object-cover"
                                                loading="lazy"
                                            />
                                        </button>
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
                                                <div className="absolute bottom-1 left-1 bg-black/50 rounded p-0.5">
                                                    <VolumeX className="w-4 h-4 text-white" />
                                                </div>
                                            )}
                                            {/* Duration overlay - bottom right */}
                                            <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1 rounded">
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
                <div className="flex-1 flex items-center justify-center py-12">
                    <ModalEmptyState
                        icon={Volume2}
                        message={t('media.empty.voice')}
                    />
                </div>
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
                <div ref={scrollContainerRef} className="bg-white">
                    {groupedItems.map((group) => (
                        <div
                            key={group.key}
                            ref={(el) => {
                                if (el) monthRefs.current.set(group.key, el);
                            }}
                        >
                            {/* Month header - sticky below tabs (top-12 = tabs height) */}
                            <div className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 sticky top-12 z-10">
                                {group.label}
                            </div>

                            {/* Voice items in this month */}
                            <div className="divide-y divide-gray-100">
                                {group.items.map((item) => {
                                    const mediaUrl = item.media_file ? getMediaUrl(item.media_file) : null;
                                    if (!mediaUrl) return null;

                                    const isSelected = currentVoice?.id === item.id;
                                    const dateKey = formatDateKey(item.timestamp);
                                    const isFirstOfDate = !seenDates.has(dateKey);
                                    if (isFirstOfDate) seenDates.add(dateKey);

                                    return (
                                        <button
                                            key={item.id}
                                            ref={isFirstOfDate ? (el) => {
                                                if (el) itemRefs.current.set(dateKey, el);
                                            } : undefined}
                                            onClick={() => setSelectedVoice(item)}
                                            className={cn(
                                                "w-full flex items-center gap-3 px-4 py-4 text-left transition-colors",
                                                !isSelected && "hover:bg-gray-50"
                                            )}
                                            style={isSelected ? { backgroundColor: theme.modals.accentColorLight } : undefined}
                                        >
                                            {/* Avatar */}
                                            <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-200 shrink-0">
                                                {memberAvatar ? (
                                                    <img src={memberAvatar} alt={memberName} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
                                                        {memberName.substring(0, 2)}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Name */}
                                            <div className="flex-1 min-w-0">
                                                <p
                                                    className="text-sm font-medium"
                                                    style={{ color: isSelected ? theme.modals.accentColor : '#111827' }}
                                                >{memberName}</p>
                                            </div>

                                            {/* Date and duration */}
                                            <div className="text-right shrink-0">
                                                <p className="text-sm text-gray-500">{formatDateTime(item.timestamp)}</p>
                                                <p
                                                    className="text-sm"
                                                    style={{ color: isSelected ? theme.modals.accentColor : '#9ca3af' }}
                                                >{formatDuration(item.media_duration)}</p>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Bottom voice player bar - sticky at bottom with gradient blur effect */}
                <div className="relative sticky bottom-0 z-20">
                    {/* Gradient blur layer - matches card height, fades from clear at top to blurred at bottom */}
                    <div
                        className="absolute inset-0 backdrop-blur-xl pointer-events-none"
                        style={{
                            maskImage: 'linear-gradient(to bottom, transparent 0%, black 100%)',
                            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 100%)',
                        }}
                    />
                    {/* Gradient background overlay - transparent at top, white at bottom */}
                    <div
                        className="absolute inset-0 bg-gradient-to-b from-transparent to-white pointer-events-none"
                    />
                    {/* Content */}
                    <div className="relative px-4 py-4">
                        <div className="max-w-lg mx-auto">
                            <VoicePlayer
                                key={currentVoice?.id}
                                src={currentVoiceUrl}
                                variant="premium"
                                avatarUrl={memberAvatar}
                                memberName={memberName}
                                timestamp={currentVoice ? formatDateTime(currentVoice.timestamp) : undefined}
                                durationText={currentVoice ? formatDuration(currentVoice.media_duration) : undefined}
                                accentColor={theme.modals.accentColor}
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
            <BaseModal
                isOpen={isOpen}
                onClose={onClose}
                title={t('media.title')}
                icon={Image}
                maxWidth="max-w-4xl"
                className="h-[80vh]"
                footer={
                    <div className="bg-gray-50 px-4 py-3 border-t border-gray-100 flex justify-between items-center">
                        <span className="text-sm text-gray-500">
                            {activeTab === 'photos' && t('media.count.photos', { count: mediaItems.photos.length })}
                            {activeTab === 'videos' && t('media.count.videos', { count: mediaItems.videos.length })}
                            {activeTab === 'voice' && t('media.count.voice', { count: mediaItems.voice.length })}
                        </span>
                        <button
                            onClick={() => setShowCalendar(true)}
                            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm font-medium px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                            <Calendar className="w-4 h-4" />
                            {t('media.jumpToDate')}
                        </button>
                    </div>
                }
            >
                {/* Tabs - sticky at top of scroll container */}
                {renderTabs()}

                {/* Content */}
                {renderContent()}
            </BaseModal>

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
