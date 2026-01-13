import React, { useState, useMemo } from 'react';
import { Star, Play, MoreHorizontal } from 'lucide-react';
import type { Message } from '../types';
import { VoicePlayer } from './VoicePlayer';
import { BaseModal, DetailModal, SafeImage, ModalEmptyState } from './common';
import type { BaseModalProps } from '../types/modal';

interface FavoritesModalProps extends BaseModalProps {
    messages: Message[];
    memberName: string;
    memberAvatar?: string;
}

export const FavoritesModal: React.FC<FavoritesModalProps> = ({
    isOpen,
    onClose,
    messages,
    memberName,
    memberAvatar,
}) => {
    const [selectedMedia, setSelectedMedia] = useState<Message | null>(null);

    // Filter only favorite messages, sorted by timestamp (newest first)
    const favoriteMessages = useMemo(() => {
        return messages
            .filter(m => m.is_favorite)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }, [messages]);

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

    // Detail view for media (photos/videos)
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
                        alt="Favorite"
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

    // Render a single favorite message card
    const renderMessageCard = (message: Message) => {
        const mediaUrl = message.media_file ? getMediaUrl(message.media_file) : null;

        return (
            <div key={message.id} className="bg-white">
                {/* Header row: avatar, name, solid star + timestamp, menu */}
                <div className="flex items-center gap-3 px-4 py-3">
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 shrink-0">
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
                        <span className="text-sm font-medium text-gray-900">{memberName}</span>
                    </div>

                    {/* Solid star followed by timestamp */}
                    <div className="flex items-center gap-1.5 shrink-0">
                        <Star className="w-4 h-4 text-blue-400 fill-blue-400" />
                        <span className="text-sm text-gray-500">{formatDateTime(message.timestamp)}</span>
                    </div>

                    {/* Menu icon */}
                    <button className="p-1 text-gray-400 hover:text-gray-600">
                        <MoreHorizontal className="w-5 h-5" />
                    </button>
                </div>

                {/* Content area */}
                <div className="px-4 pb-4 pl-16">
                    {/* Text message */}
                    {message.type === 'text' && (
                        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                            <p className="text-gray-800 whitespace-pre-wrap">{message.content}</p>
                        </div>
                    )}

                    {/* Picture */}
                    {message.type === 'picture' && mediaUrl && (
                        <button
                            onClick={() => setSelectedMedia(message)}
                            className="rounded-xl overflow-hidden border border-gray-200 shadow-sm max-w-sm block"
                        >
                            <SafeImage
                                src={mediaUrl}
                                alt="Favorite"
                                className="max-w-full max-h-64 object-contain"
                            />
                        </button>
                    )}

                    {/* Video */}
                    {message.type === 'video' && mediaUrl && (
                        <button
                            onClick={() => setSelectedMedia(message)}
                            className="relative rounded-xl overflow-hidden border border-gray-200 shadow-sm max-w-sm block"
                        >
                            <video
                                src={mediaUrl}
                                className="max-w-full max-h-64 object-contain"
                                preload="metadata"
                            />
                            {/* Play button overlay */}
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                                    <Play className="w-7 h-7 text-gray-700 ml-1" />
                                </div>
                            </div>
                        </button>
                    )}

                    {/* Voice */}
                    {message.type === 'voice' && mediaUrl && (
                        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm max-w-md">
                            <VoicePlayer src={mediaUrl} />
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // Render content
    const renderContent = () => {
        if (favoriteMessages.length === 0) {
            return (
                <div className="flex-1 flex items-center justify-center py-12">
                    <ModalEmptyState
                        icon={Star}
                        message="No favorites yet"
                        hint="Long press or right-click on a message to add to favorites"
                    />
                </div>
            );
        }

        return (
            <div className="flex-1 overflow-y-auto bg-gray-50">
                <div className="divide-y divide-gray-100">
                    {favoriteMessages.map(renderMessageCard)}
                </div>
            </div>
        );
    };

    return (
        <>
            <BaseModal
                isOpen={isOpen}
                onClose={onClose}
                title="Favorites"
                icon={Star}
                maxWidth="max-w-3xl"
                className="h-[80vh]"
                footer={
                    <div className="bg-gray-50 px-4 py-3 border-t border-gray-100">
                        <span className="text-sm text-gray-500">
                            {favoriteMessages.length} favorite{favoriteMessages.length !== 1 ? 's' : ''}
                        </span>
                    </div>
                }
            >
                {renderContent()}
            </BaseModal>

            {renderDetailView()}
        </>
    );
};
