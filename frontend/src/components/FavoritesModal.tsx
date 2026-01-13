import React, { useState, useMemo } from 'react';
import { Star, Play, Volume2 } from 'lucide-react';
import type { Message } from '../types';
import { VoicePlayer } from './VoicePlayer';
import { BaseModal, DetailModal, SafeImage, ModalEmptyState } from './common';
import type { BaseModalProps } from '../types/modal';

interface FavoritesModalProps extends BaseModalProps {
    messages: Message[];
    memberName: string;
}

export const FavoritesModal: React.FC<FavoritesModalProps> = ({
    isOpen,
    onClose,
    messages,
    memberName,
}) => {
    const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);

    // Filter only favorite messages, sorted by timestamp (newest first)
    const favoriteMessages = useMemo(() => {
        return messages
            .filter(m => m.is_favorite)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }, [messages]);

    const getMediaUrl = (mediaFile: string) => {
        return `/api/content/media/${mediaFile.split('/').map(encodeURIComponent).join('/')}`;
    };

    const formatDate = (timestamp: string) => {
        const date = new Date(timestamp);
        return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
    };

    // Detail view for selected message
    const renderDetailView = () => {
        if (!selectedMessage) return null;

        const mediaUrl = selectedMessage.media_file ? getMediaUrl(selectedMessage.media_file) : null;

        return (
            <DetailModal
                isOpen={!!selectedMessage}
                onClose={() => setSelectedMessage(null)}
                footer={
                    <>
                        <span>{memberName}</span>
                        <span className="mx-2">•</span>
                        <span>{formatDate(selectedMessage.timestamp)}</span>
                    </>
                }
            >
                {selectedMessage.type === 'text' && (
                    <div className="p-8 bg-white rounded-xl max-w-lg">
                        <p className="text-gray-800 whitespace-pre-wrap leading-relaxed">
                            {selectedMessage.content}
                        </p>
                    </div>
                )}
                {selectedMessage.type === 'picture' && mediaUrl && (
                    <SafeImage
                        src={mediaUrl}
                        alt="Favorite"
                        className="max-w-full max-h-[80vh] object-contain"
                    />
                )}
                {selectedMessage.type === 'video' && mediaUrl && (
                    <video
                        src={mediaUrl}
                        controls
                        autoPlay
                        className="max-w-full max-h-[80vh]"
                    />
                )}
                {selectedMessage.type === 'voice' && mediaUrl && (
                    <div className="p-8 bg-white rounded-xl">
                        <VoicePlayer src={mediaUrl} />
                    </div>
                )}
            </DetailModal>
        );
    };

    // Render content
    const renderContent = () => {
        if (favoriteMessages.length === 0) {
            return (
                <ModalEmptyState
                    icon={Star}
                    message="No favorites yet"
                    hint="Long press or right-click on a message to add to favorites"
                />
            );
        }

        return (
            <div className="grid grid-cols-3 gap-2">
                {favoriteMessages.map((message) => {
                    const mediaUrl = message.media_file ? getMediaUrl(message.media_file) : null;

                    return (
                        <button
                            key={message.id}
                            onClick={() => setSelectedMessage(message)}
                            className="aspect-square rounded-lg overflow-hidden bg-gray-100 relative group hover:ring-2 hover:ring-blue-400 transition-all"
                        >
                            {message.type === 'text' && (
                                <div className="w-full h-full p-3 flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
                                    <p className="text-xs text-gray-600 line-clamp-4 text-center">
                                        {message.content}
                                    </p>
                                </div>
                            )}
                            {message.type === 'picture' && mediaUrl && (
                                <SafeImage
                                    src={mediaUrl}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />
                            )}
                            {message.type === 'video' && mediaUrl && (
                                <>
                                    <video
                                        src={mediaUrl}
                                        className="w-full h-full object-cover"
                                        preload="metadata"
                                    />
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
                                        <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                                            <Play className="w-5 h-5 text-gray-800 ml-0.5" />
                                        </div>
                                    </div>
                                </>
                            )}
                            {message.type === 'voice' && (
                                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50">
                                    <Volume2 className="w-8 h-8 text-amber-500" />
                                </div>
                            )}

                            {/* Favorite star indicator */}
                            <div className="absolute top-1 right-1">
                                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400 drop-shadow" />
                            </div>
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
                title="Favorites"
                icon={Star}
                maxWidth="max-w-3xl"
            >
                <div className="p-4">
                    {renderContent()}
                </div>
            </BaseModal>

            {renderDetailView()}
        </>
    );
};
