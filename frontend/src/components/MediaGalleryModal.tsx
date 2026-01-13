import React, { useState, useMemo } from 'react';
import { X, Image, Video, Volume2, Play } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Message } from '../types';
import { VoicePlayer } from './VoicePlayer';

interface MediaGalleryModalProps {
    isOpen: boolean;
    onClose: () => void;
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
        { id: 'photos', icon: Image, label: '写真', count: mediaItems.photos.length },
        { id: 'videos', icon: Video, label: '動画', count: mediaItems.videos.length },
        { id: 'voice', icon: Volume2, label: '音声', count: mediaItems.voice.length },
    ];

    const getMediaUrl = (mediaFile: string) => {
        return `/api/content/media/${mediaFile.split('/').map(encodeURIComponent).join('/')}`;
    };

    const formatDate = (timestamp: string) => {
        const date = new Date(timestamp);
        return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
    };

    if (!isOpen) return null;

    // Full media view popup
    if (selectedMedia) {
        const mediaUrl = selectedMedia.media_file ? getMediaUrl(selectedMedia.media_file) : null;

        return (
            <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4">
                <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col">
                    {/* Close button */}
                    <button
                        onClick={() => setSelectedMedia(null)}
                        className="absolute -top-12 right-0 text-white/80 hover:text-white transition-colors z-10"
                    >
                        <X className="w-8 h-8" />
                    </button>

                    {/* Media content */}
                    <div className="bg-black rounded-xl overflow-hidden flex items-center justify-center flex-1">
                        {selectedMedia.type === 'picture' && mediaUrl && (
                            <img
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
                    </div>

                    {/* Meta info */}
                    <div className="text-white/80 text-sm text-center mt-4">
                        <span>{memberName}</span>
                        <span className="mx-2">•</span>
                        <span>{formatDate(selectedMedia.timestamp)}</span>
                    </div>
                </div>
            </div>
        );
    }

    // Gallery grid view
    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] px-6 py-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <Image className="w-5 h-5 text-white" />
                        <h3 className="text-lg font-bold text-white">媒体</h3>
                    </div>
                    <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Tabs */}
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

                {/* Content */}
                <div className="p-4 overflow-y-auto flex-1">
                    {currentItems.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
                                {activeTab === 'photos' && <Image className="w-8 h-8 text-gray-300" />}
                                {activeTab === 'videos' && <Video className="w-8 h-8 text-gray-300" />}
                                {activeTab === 'voice' && <Volume2 className="w-8 h-8 text-gray-300" />}
                            </div>
                            <p>まだ{tabs.find(t => t.id === activeTab)?.label}がありません</p>
                        </div>
                    ) : (
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
                                            <img
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
                    )}
                </div>
            </div>
        </div>
    );
};
