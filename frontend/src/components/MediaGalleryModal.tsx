import React, { useState, useMemo } from 'react';
import { Image, Film, Volume2, ChevronLeft, Calendar, VolumeX } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Message } from '../types';
import { VoicePlayer } from './VoicePlayer';
import { Portal } from './Portal';
import { DetailModal, SafeImage, ModalEmptyState } from './common';
import { Z_CLASS } from '../constants/zIndex';
import type { BaseModalProps } from '../types/modal';

interface MediaGalleryModalProps extends BaseModalProps {
    messages: Message[];
    memberName: string;
    memberAvatar?: string;
    onOpenCalendar?: () => void;
}

type MediaTab = 'photos' | 'videos' | 'voice';

// Group items by month
interface MonthGroup {
    label: string;
    items: Message[];
}

export const MediaGalleryModal: React.FC<MediaGalleryModalProps> = ({
    isOpen,
    onClose,
    messages,
    memberName,
    memberAvatar,
    onOpenCalendar,
}) => {
    const [activeTab, setActiveTab] = useState<MediaTab>('photos');
    const [selectedMedia, setSelectedMedia] = useState<Message | null>(null);

    // Filter messages by media type
    const mediaItems = useMemo(() => {
        const photos = messages.filter(m => m.type === 'picture' && m.media_file);
        const videos = messages.filter(m => m.type === 'video' && m.media_file);
        const voice = messages.filter(m => m.type === 'voice' && m.media_file);
        return { photos, videos, voice };
    }, [messages]);

    // Group items by month (for photos and videos)
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
        groups.forEach((items) => {
            const date = new Date(items[0].timestamp);
            result.push({
                label: `${date.getFullYear()} / ${(date.getMonth() + 1).toString().padStart(2, '0')}`,
                items,
            });
        });

        return result;
    }, [activeTab, mediaItems]);

    const tabs: { id: MediaTab; icon: React.ElementType }[] = [
        { id: 'photos', icon: Image },
        { id: 'videos', icon: Film },
        { id: 'voice', icon: Volume2 },
    ];

    const getMediaUrl = (mediaFile: string) => {
        return `/api/content/media/${mediaFile.split('/').map(encodeURIComponent).join('/')}`;
    };

    const formatDateTime = (timestamp: string) => {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hour = date.getHours().toString().padStart(2, '0');
        const min = date.getMinutes().toString().padStart(2, '0');
        return `${year}/${month}/${day} ${hour}:${min}`;
    };

    const formatDuration = (seconds?: number) => {
        if (!seconds) return '--:--';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Handle ESC key and body scroll
    React.useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        document.addEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'hidden';

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

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
                {selectedMedia.type === 'video' && mediaUrl && (
                    <video
                        src={mediaUrl}
                        controls
                        autoPlay
                        className="max-w-full max-h-[80vh]"
                    />
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

    // Render icon-only tabs (like official app)
    const renderTabs = () => (
        <div className="flex bg-white border-b border-gray-200 shrink-0">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                        "flex-1 flex items-center justify-center py-3 transition-colors relative",
                        activeTab === tab.id
                            ? "text-blue-500"
                            : "text-gray-400 hover:text-gray-600"
                    )}
                >
                    <tab.icon className="w-6 h-6" />
                    {/* Active indicator - blue line under */}
                    {activeTab === tab.id && (
                        <div className="absolute bottom-0 left-4 right-4 h-1 bg-blue-400 rounded-t" />
                    )}
                </button>
            ))}
        </div>
    );

    // Render photos/videos grid with month grouping
    const renderMediaGrid = () => {
        if (groupedItems.length === 0) {
            return (
                <div className="flex-1 flex items-center justify-center">
                    <ModalEmptyState
                        icon={getEmptyIcon()}
                        message={`No ${activeTab === 'photos' ? 'photos' : 'videos'} yet`}
                    />
                </div>
            );
        }

        return (
            <div className="flex-1 overflow-y-auto bg-white">
                {groupedItems.map((group, groupIdx) => (
                    <div key={groupIdx}>
                        {/* Month header */}
                        <div className="px-4 py-3 text-sm font-medium text-gray-700 bg-white sticky top-0">
                            {group.label}
                        </div>

                        {/* Grid */}
                        <div className="grid grid-cols-4 gap-0.5 px-1">
                            {group.items.map((item) => {
                                const mediaUrl = item.media_file ? getMediaUrl(item.media_file) : null;
                                if (!mediaUrl) return null;

                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => setSelectedMedia(item)}
                                        className="aspect-square relative bg-gray-100"
                                    >
                                        {activeTab === 'photos' ? (
                                            <SafeImage
                                                src={mediaUrl}
                                                alt=""
                                                className="w-full h-full object-cover"
                                                loading="lazy"
                                            />
                                        ) : (
                                            <>
                                                <video
                                                    src={mediaUrl}
                                                    className="w-full h-full object-cover"
                                                    preload="metadata"
                                                />
                                                {/* Duration overlay */}
                                                <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1 rounded">
                                                    {formatDuration(item.media_duration)}
                                                </div>
                                                {/* Mute icon if applicable */}
                                                {item.is_muted && (
                                                    <VolumeX className="absolute bottom-1 left-1 w-4 h-4 text-white drop-shadow" />
                                                )}
                                            </>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    // Render voice list
    const renderVoiceList = () => {
        const voiceItems = mediaItems.voice.sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        if (voiceItems.length === 0) {
            return (
                <div className="flex-1 flex items-center justify-center">
                    <ModalEmptyState
                        icon={Volume2}
                        message="No voice messages yet"
                    />
                </div>
            );
        }

        return (
            <div className="flex-1 overflow-y-auto bg-white">
                <div className="divide-y divide-gray-100">
                    {voiceItems.map((item) => {
                        const mediaUrl = item.media_file ? getMediaUrl(item.media_file) : null;
                        if (!mediaUrl) return null;

                        return (
                            <div key={item.id} className="flex items-center gap-3 px-4 py-4">
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
                                    <p className="text-sm font-medium text-gray-900">{memberName}</p>
                                </div>

                                {/* Date and duration */}
                                <div className="text-right shrink-0">
                                    <p className="text-sm text-gray-500">{formatDateTime(item.timestamp)}</p>
                                    <p className="text-sm text-gray-400">{formatDuration(item.media_duration)}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Bottom voice player bar */}
                <div className="sticky bottom-0 bg-gray-100 border-t border-gray-200 p-4">
                    <div className="max-w-md mx-auto">
                        <VoicePlayer src={voiceItems[0]?.media_file ? getMediaUrl(voiceItems[0].media_file) : ''} />
                    </div>
                </div>
            </div>
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
            <Portal>
                <div
                    className={cn("fixed inset-0 bg-black/60 flex flex-col", Z_CLASS.MODAL)}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="media-title"
                >
                    {/* Full-screen modal layout like official app */}
                    <div className="flex flex-col h-full max-w-3xl mx-auto w-full bg-white">
                        {/* Header */}
                        <div className="bg-gradient-to-r from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] px-4 py-4 flex items-center justify-between shrink-0">
                            <button
                                onClick={onClose}
                                className="text-white/90 hover:text-white transition-colors p-1"
                            >
                                <ChevronLeft className="w-6 h-6" />
                            </button>
                            <h3 id="media-title" className="text-lg font-bold text-white">
                                Media
                            </h3>
                            <button
                                onClick={onOpenCalendar}
                                className="text-white/90 hover:text-white transition-colors p-1"
                            >
                                <Calendar className="w-6 h-6" />
                            </button>
                        </div>

                        {/* Tabs */}
                        {renderTabs()}

                        {/* Content */}
                        {renderContent()}
                    </div>
                </div>
            </Portal>

            {renderDetailView()}
        </>
    );
};
