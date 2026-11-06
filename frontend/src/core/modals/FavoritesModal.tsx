import React, { useState, useMemo } from 'react';
import { Star, Play, X } from 'lucide-react';
import type { Message } from '../../types';
import { formatDateTime } from '../../utils/classnames';
import { VoicePlayer } from '../media/VoicePlayer';
import { SafeImage } from '../common';
import type { BaseModalProps } from '../../types/modal';
import { Modal, Card, Avatar, IconButton } from '../../design/primitives';
import { DialogStatus } from '../common/DialogStatus';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';

interface FavoritesModalProps extends BaseModalProps {
    messages: Message[];
    memberName: string;
    memberAvatar?: string;
    serviceId?: string;  // Service ID for building correct media URLs
}

export const FavoritesModal: React.FC<FavoritesModalProps> = ({
    isOpen,
    onClose,
    messages,
    memberName,
    memberAvatar,
    serviceId,
}) => {
    const { t } = useTranslation();
    const [selectedMedia, setSelectedMedia] = useState<Message | null>(null);

    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);

    // Filter only favorite messages, sorted by timestamp (newest first)
    const favoriteMessages = useMemo(() => {
        return messages
            .filter(m => m.is_favorite)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }, [messages]);

    const getMediaUrl = (mediaFile: string) => {
        // media_file is relative to service dir (e.g., "messages/62 石森 璃花/.../picture/123.jpg")
        // API expects full path from output dir with service prefix
        const encodedPath = mediaFile.split('/').map(encodeURIComponent).join('/');
        return serviceId
            ? `/api/content/media/${encodeURIComponent(serviceId)}/${encodedPath}`
            : `/api/content/media/${encodedPath}`;
    };

    // Detail view for media (photos/videos): the dark viewer
    const renderDetailView = () => {
        if (!selectedMedia) return null;
        const mediaUrl = selectedMedia.media_file ? getMediaUrl(selectedMedia.media_file) : null;
        return (
            <Modal
                isOpen
                onClose={() => setSelectedMedia(null)}
                tone="viewer"
                layout="bare"
                aria-label={t('common.mediaViewer')}
                logId="media_viewer"
            >
                <IconButton variant="overlay" className="absolute right-4 top-4" aria-label={t('common.close')} icon={<X />} onClick={() => setSelectedMedia(null)} />
                <div className="flex max-h-[90vh] w-full max-w-4xl flex-col items-center gap-4 p-4">
                    <div className="flex flex-1 items-center justify-center overflow-hidden rounded-card bg-viewer-stage">
                        {selectedMedia.type === 'picture' && mediaUrl && (
                            <SafeImage src={mediaUrl} alt={t('favorites.title')} className="max-h-[80vh] max-w-full object-contain" />
                        )}
                        {selectedMedia.type === 'video' && mediaUrl && (
                            <video
                                src={mediaUrl}
                                controls
                                controlsList={goldenFingerActive ? undefined : 'nodownload'}
                                disablePictureInPicture
                                autoPlay
                                className="max-h-[80vh] max-w-full"
                            />
                        )}
                    </div>
                    <p className="text-small text-viewer-muted">
                        <span lang="ja">{memberName}</span>
                        <span aria-hidden="true" className="mx-2">•</span>
                        <span>{formatDateTime(selectedMedia.timestamp)}</span>
                    </p>
                </div>
            </Modal>
        );
    };

    const renderMessageCard = (message: Message) => {
        const mediaUrl = message.media_file ? getMediaUrl(message.media_file) : null;
        return (
            <Card key={message.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-3">
                    <Avatar src={memberAvatar} name={memberName} size="md" decorative />
                    <span lang="ja" className="min-w-0 flex-1 truncate text-body font-semibold text-primary">{memberName}</span>
                    <span className="flex shrink-0 items-center gap-1 text-small text-muted">
                        <Star aria-hidden="true" className="h-4 w-4 fill-current text-semantic-star drop-shadow-sm" />
                        {formatDateTime(message.timestamp)}
                    </span>
                </div>
                <div className="pl-12">
                    {message.type === 'text' && (
                        <p lang="ja" className="whitespace-pre-wrap text-body text-primary">{message.content}</p>
                    )}
                    {message.type === 'picture' && mediaUrl && (
                        <button
                            type="button"
                            onClick={() => setSelectedMedia(message)}
                            className="block max-w-sm overflow-hidden rounded-card shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <SafeImage src={mediaUrl} alt={t('favorites.title')} className="max-h-64 max-w-full object-contain" />
                        </button>
                    )}
                    {message.type === 'video' && mediaUrl && (
                        <button
                            type="button"
                            onClick={() => setSelectedMedia(message)}
                            className="relative block max-w-sm overflow-hidden rounded-card shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <video src={mediaUrl} className="max-h-64 max-w-full object-contain" preload="metadata" />
                            <span className="absolute inset-0 flex items-center justify-center">
                                <span className="flex h-14 w-14 items-center justify-center rounded-pill bg-viewer-control text-viewer">
                                    <Play className="ml-1 h-7 w-7" />
                                </span>
                            </span>
                        </button>
                    )}
                    {message.type === 'voice' && mediaUrl && (
                        <div className="max-w-md">
                            <VoicePlayer src={mediaUrl} />
                        </div>
                    )}
                </div>
            </Card>
        );
    };

    return (
        <>
            <Modal
                isOpen={isOpen}
                onClose={onClose}
                title={t('favorites.title')}
                icon={<Star />}
                closeLabel={t('common.close')}
                logId="favorites"
                className="h-[80vh] max-w-3xl"
                bodyClassName="bg-sunken px-4 py-4"
                footer={<p className="mr-auto text-small text-muted">{t('favorites.count', { count: favoriteMessages.length })}</p>}
            >
                {favoriteMessages.length === 0 ? (
                    <DialogStatus kind="empty" icon={<Star />} title={t('favorites.noFavorites')} hint={t('favorites.addHint')} />
                ) : (
                    <div className="flex flex-col gap-3">{favoriteMessages.map(renderMessageCard)}</div>
                )}
            </Modal>
            {renderDetailView()}
        </>
    );
};
