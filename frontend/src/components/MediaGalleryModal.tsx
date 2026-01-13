import React, { useState, useMemo } from 'react';
import { Image, Video, Volume2, Play } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Message } from '../types';
import { VoicePlayer } from './VoicePlayer';
import { BaseModal, DetailModal, SafeImage, ModalEmptyState } from './common';
import type { BaseModalProps } from '../types/modal';

interface MediaGalleryModalProps extends BaseModalProps {
    messages: Message[];
    memberName: string;
}

type MediaTab = 'photos' | 'videos' | 'voice';

export const MediaGalleryModal: React.FC<MediaGalleryModalProps> = ({
    isOpen,
    onClose,
    messages,
    memberName,
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

    const currentItems = useMemo(() => {
        switch (activeTab) {
            case 'photos': return mediaItems.photos;
            case 'videos': return mediaItems.videos;
            case 'voice': return mediaItems.voice;
        }
    }, [activeTab, mediaItems]);

    const tabs: { id: MediaTab; icon: React.ElementType; label: string; count: number }[] = [
        { id: 'photos', icon: Image, label: 'Photos', count: mediaItems.photos.length },
        { id: 'videos', icon: Video, label: 'Videos', count: mediaItems.videos.length },
        { id: 'voice', icon: Volume2, label: 'Voice', count: mediaItems.voice.length },
    ];

    const getMediaUrl = (mediaFile: string) => {
        return `/api/content/media/${mediaFile.split('/').map(encodeURIComponent).join('/')}`;
    };

    const formatDate = (timestamp: string) => {
        const date = new Date(timestamp);
        return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
    };

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
                        <span>{formatDate(selectedMedia.timestamp)}</span>
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
                {selectedMedia.type === 'voice' && mediaUrl && (
                    <div className="p-8 bg-white rounded-xl">
                        <VoicePlayer src={mediaUrl} />
                    </div>
                )}
            </DetailModal>
        );
    };

    // Get empty state icon based on active tab
    const getEmptyIcon = () => {
        switch (activeTab) {
            case 'photos': return Image;
            case 'videos': return Video;
            case 'voice': return Volume2;
        }
    };

    // Render tabs
    const renderTabs = () => (
        <div className="flex border-b border-gray-200 px-4 shrink-0">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                        "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative",
                        activeTab === tab.id
                            ? "text-blue-600"
                            : "text-gray-500 hover:text-gray-700"
                    )}
                >
                    <tab.icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                    <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                        {tab.count}
                    </span>
                    {/* Active indicator */}
                    {activeTab === tab.id && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
                    )}
                </button>
            ))}
        </div>
    );

    // Render content based on state
    const renderContent = () => {
        if (currentItems.length === 0) {
            return (
                <ModalEmptyState
                    icon={getEmptyIcon()}
                    message={`No ${tabs.find(t => t.id === activeTab)?.label.toLowerCase()} yet`}
                />
            );
        }

        return (
            <div className={cn(
                "grid gap-2",
                activeTab === 'voice' ? "grid-cols-1" : "grid-cols-4"
            )}>
                {currentItems.map((item) => {
                    const mediaUrl = item.media_file ? getMediaUrl(item.media_file) : null;
                    if (!mediaUrl) return null;

                    if (activeTab === 'voice') {
                        // Voice items as list with player
                        return (
                            <div
                                key={item.id}
                                className="bg-gray-50 rounded-lg p-3 flex items-center gap-3"
                            >
                                <div className="flex-1">
                                    <VoicePlayer src={mediaUrl} />
                                </div>
                                <span className="text-xs text-gray-400 shrink-0">
                                    {formatDate(item.timestamp)}
                                </span>
                            </div>
                        );
                    }

                    // Photos and videos as grid
                    return (
                        <button
                            key={item.id}
                            onClick={() => setSelectedMedia(item)}
                            className="aspect-square rounded-lg overflow-hidden bg-gray-100 relative group hover:ring-2 hover:ring-blue-400 transition-all"
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
                                    {/* Play overlay */}
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
                                        <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                                            <Play className="w-5 h-5 text-gray-800 ml-0.5" />
                                        </div>
                                    </div>
                                </>
                            )}
                        </button>
                    );
                })}
            </div>
        );
    };

    return (
        <>
            <BaseModal
                isOpen={isOpen}
                onClose={onClose}
                title="Media"
                icon={Image}
                maxWidth="max-w-3xl"
            >
                {/* Tabs - rendered before scrollable content */}
                {renderTabs()}

                {/* Content */}
                <div className="p-4">
                    {renderContent()}
                </div>
            </BaseModal>

            {renderDetailView()}
        </>
    );
};
