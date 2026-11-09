import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Star, Play, X, Film } from 'lucide-react';
import type { Message } from '../../types';
import { cn, formatDateTime } from '../../utils/classnames';
import { VoicePlayer } from '../media/VoicePlayer';
import { useMediaSource } from '../media/mediaElement';
import { SafeImage } from '../common';
import type { BaseModalProps } from '../../types/modal';
import { Modal, Card, Avatar, IconButton } from '../../design/primitives';
import { DialogStatus } from '../common/DialogStatus';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { clientLog } from '../../utils/clientLog';

interface FavoritesModalProps extends BaseModalProps {
    messages: Message[];
    memberName: string;
    memberAvatar?: string;
    serviceId?: string;  // Service ID for building correct media URLs
}

/**
 * True once the element behind the returned ref nears the viewport (an
 * IntersectionObserver rooted at the dialog body, the scroll container, so the
 * `rootMargin` pre-load applies inside it). It never goes back to false.
 * Without IntersectionObserver it is true immediately (the parent logs
 * `favorite_video_lazy_unsupported` once per open).
 */
function useInViewOnce(root: HTMLElement | null) {
    const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');
    const holderRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = holderRef.current;
        if (inView || !el || !root) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setInView(true);
                    observer.disconnect();
                }
            },
            // Start loading slightly before the card enters view.
            { root, rootMargin: '200px', threshold: 0 },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [inView, root]);

    return { holderRef, inView };
}

/**
 * Inline video thumbnail. The `<video>` is mounted only once the card nears the
 * viewport ({@link useInViewOnce}), so opening Favourites does not load
 * every video at once. Until the first frame is available a neutral placeholder
 * shows a shimmer sweep (hidden under reduced motion) and a centred Film icon.
 * The loading video stays laid out but invisible (never `display:none`),
 * mirroring SafeImage's skeleton mode. The placeholder goes away on whichever
 * of `loadeddata` / `loadedmetadata` fires first (some engines stop at
 * metadata). A failed video drops the placeholder, logs `favorite_video_error`
 * and leaves the native element. Without IntersectionObserver the video mounts
 * immediately (the parent logs `favorite_video_lazy_unsupported` once per open).
 * The video is released (pause, drop src, load) on unmount so closing
 * Favourites never leaves media connections open.
 */
const FavoriteVideoThumb: React.FC<{ src: string; root: HTMLElement | null }> = ({ src, root }) => {
    const [ready, setReady] = useState(false);
    const { holderRef, inView } = useInViewOnce(root);
    const videoRef = useRef<HTMLVideoElement>(null);
    useMediaSource(videoRef, inView ? src : undefined);

    return (
        <div ref={holderRef} className="relative">
            {!ready && (
                <span
                    data-testid="video-skeleton"
                    aria-hidden="true"
                    className="relative flex h-40 w-64 max-w-full items-center justify-center overflow-hidden bg-skeleton"
                >
                    <span
                        data-testid="video-shimmer"
                        className="absolute inset-y-0 left-0 w-1/2 animate-shimmer-sweep bg-gradient-to-r from-transparent via-pill to-transparent motion-reduce:hidden"
                    />
                    <Film className="relative h-8 w-8 text-secondary" />
                </span>
            )}
            {inView && (
                <video
                    ref={videoRef}
                    className={cn('max-h-64 max-w-full object-contain', !ready && 'pointer-events-none absolute left-0 top-0 opacity-0')}
                    preload="metadata"
                    onLoadedData={() => setReady(true)}
                    onLoadedMetadata={() => setReady(true)}
                    onError={() => {
                        clientLog('favorite_video_error', { phase: 'load' });
                        setReady(true);
                    }}
                />
            )}
        </div>
    );
};

/**
 * Voice card. The player (and so its `<audio>` and metadata request) mounts
 * only once the card nears the viewport ({@link useInViewOnce}); until then a
 * same-height placeholder holds the layout and no request is made.
 */
const FavoriteVoice: React.FC<{ src: string; root: HTMLElement | null }> = ({ src, root }) => {
    const { holderRef, inView } = useInViewOnce(root);
    return (
        <div ref={holderRef} className="max-w-md">
            {inView ? <VoicePlayer src={src} /> : <div data-testid="voice-placeholder" aria-hidden="true" className="h-14" />}
        </div>
    );
};

/** The viewer's native-controls video, released (pause, drop src, load) on unmount. */
const FavoriteVideoDetail: React.FC<{ src: string; allowDownload: boolean }> = ({ src, allowDownload }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    useMediaSource(videoRef, src);
    return (
        <video
            ref={videoRef}
            controls
            controlsList={allowDownload ? undefined : 'nodownload'}
            disablePictureInPicture
            autoPlay
            className="max-h-[80vh] max-w-full"
        />
    );
};

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
    // The dialog body is the scroll container: it is the IntersectionObserver root for video cards.
    const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);

    // Without IntersectionObserver every video mounts eagerly; leave one breadcrumb per modal open.
    useEffect(() => {
        if (isOpen && typeof IntersectionObserver === 'undefined') {
            clientLog('favorite_video_lazy_unsupported');
        }
    }, [isOpen]);

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
                            <FavoriteVideoDetail key={mediaUrl} src={mediaUrl} allowDownload={goldenFingerActive} />
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
                            className="relative block max-w-sm overflow-hidden rounded-card shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <SafeImage src={mediaUrl} alt={t('favorites.title')} className="max-h-64 max-w-full object-contain" skeletonClassName="h-48 w-64 max-w-full" />
                        </button>
                    )}
                    {message.type === 'video' && mediaUrl && (
                        <button
                            type="button"
                            onClick={() => setSelectedMedia(message)}
                            className="relative block max-w-sm overflow-hidden rounded-card shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <FavoriteVideoThumb key={mediaUrl} src={mediaUrl} root={bodyEl} />
                            <span className="absolute inset-0 flex items-center justify-center">
                                <span className="flex h-14 w-14 items-center justify-center rounded-pill bg-viewer-control text-viewer">
                                    <Play className="ml-1 h-7 w-7" />
                                </span>
                            </span>
                        </button>
                    )}
                    {message.type === 'voice' && mediaUrl && (
                        <FavoriteVoice key={mediaUrl} src={mediaUrl} root={bodyEl} />
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
                bodyRef={setBodyEl}
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
