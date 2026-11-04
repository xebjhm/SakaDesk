import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Download } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { cn, formatDownloadFilename } from '../../utils/classnames';
import { downloadMedia } from '../../utils/download';
import { Modal, IconButton, Button } from '../../design/primitives';
import { useClipboardShortcut } from './useClipboardShortcut';
import { VoicePlayer } from './VoicePlayer';
import { VideoPlayer } from './VideoPlayer';
import { PhotoPlayer } from './PhotoPlayer';

/** A single media item in the viewer. */
export interface MediaViewerItem {
    src: string;
    type: 'picture' | 'video' | 'voice';
    timestamp: string;
    /** Avatar URL for voice items (premium player shows avatar). */
    avatarUrl?: string;
    /** Member name for voice items. */
    memberName?: string;
    /** Whether the video has no audio track (from sync metadata). */
    isMuted?: boolean;
    /** Source context label (e.g. blog post title, message preview). */
    sourceLabel?: string;
    /** Called when sourceLabel is clicked — jumps to the source (blog post, message, etc). */
    onSourceJump?: () => void;
    /** Message ID for transcription lookup. */
    messageId?: number;
    /** Service ID for transcription API. */
    service?: string;
    /** Relative path to member directory for transcription. */
    memberPath?: string;
}

interface MediaViewerModalProps {
    mediaItems: MediaViewerItem[];
    currentIndex: number;
    onClose: () => void;
    onNavigate: (index: number) => void;
    /** Optional content shown top-centre (e.g. tabs); clicks on it don't close the viewer. */
    headerSlot?: React.ReactNode;
}

/**
 * Unified media viewer modal for photos, videos, and voice.
 *
 * Keyboard controls:
 * - Left/Right: Navigate to previous/next media
 * - Up/Down: Zoom in/out (photos) or volume up/down (video/voice)
 * - Escape: Close (handled by the dialog layer, which respects fullscreen)
 */
export const MediaViewerModal: React.FC<MediaViewerModalProps> = ({
    mediaItems,
    currentIndex,
    onClose,
    onNavigate,
    headerSlot,
}) => {
    const { t } = useTranslation();
    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);

    const [zoom, setZoom] = useState(1);
    const stageRef = useRef<HTMLDivElement>(null);

    const item = mediaItems[currentIndex];

    // Clipboard shortcut — window-level Ctrl+C listener
    const { toastMessage } = useClipboardShortcut(item?.src, item?.type);

    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < mediaItems.length - 1;

    // Reset zoom when navigating to a new item. (Video/voice transcription
    // state is owned by the player components themselves via messageId.)
    useEffect(() => {
        setZoom(1);
    }, [currentIndex]);

    // Navigating can unmount the focused control (Download, a play button), which drops focus to
    // the body and silences ← / →: put it back on the dialog frame.
    useEffect(() => {
        const frame = stageRef.current?.closest<HTMLElement>('[role="dialog"]');
        if (frame && !frame.contains(document.activeElement)) frame.focus({ preventScroll: true });
    }, [currentIndex]);

    const handleDownload = useCallback(() => {
        if (!item) return;
        downloadMedia(item.src, formatDownloadFilename(item.src, item.timestamp));
    }, [item]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                if (hasPrev) onNavigate(currentIndex - 1);
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (hasNext) onNavigate(currentIndex + 1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (item?.type === 'picture') {
                    setZoom(z => Math.min(z + 0.25, 4));
                }
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (item?.type === 'picture') {
                    setZoom(z => Math.max(z - 0.25, 1));
                }
                break;
        }
    }, [hasPrev, hasNext, currentIndex, onNavigate, item?.type]);

    if (!item) return null;
    const lifted = item.sourceLabel && item.onSourceJump ? 'bottom-14' : 'bottom-6';

    return (
        <Modal
            isOpen
            onClose={onClose}
            tone="viewer"
            layout="bare"
            aria-label={t('common.mediaViewer')}
            logId="media_viewer"
            onKeyDown={handleKeyDown}
        >
            <IconButton variant="overlay" className="absolute right-4 top-4 z-10" aria-label={t('common.close')} icon={<X />} onClick={onClose} />

            {headerSlot && <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2">{headerSlot}</div>}

            <div ref={stageRef} className="relative flex max-h-[90vh] max-w-[90vw] items-center justify-center">
                {item.type === 'picture' && <PhotoPlayer variant="fullscreen" src={item.src} alt={t('common.mediaViewer')} zoom={zoom} />}
                {item.type === 'video' && (
                    <div className="flex flex-col items-center gap-3">
                        <VideoPlayer
                            src={item.src}
                            variant="fullscreen"
                            autoPlay
                            messageTimestamp={item.timestamp}
                            noAudio={item.isMuted}
                            videoClassName="max-w-[90vw] max-h-[90vh]"
                            messageId={item.messageId}
                            service={item.service}
                            memberPath={item.memberPath}
                        />
                    </div>
                )}
                {item.type === 'voice' && (
                    <div className="flex w-96 flex-col gap-3">
                        <VoicePlayer
                            src={item.src}
                            variant="fullscreen"
                            avatarUrl={item.avatarUrl}
                            memberName={item.memberName}
                            messageTimestamp={item.timestamp}
                            autoPlay
                            viewerMode
                            messageId={item.messageId}
                            service={item.service}
                            memberPath={item.memberPath}
                        />
                    </div>
                )}
            </div>

            {goldenFingerActive && item.type === 'picture' && (
                <Button variant="overlay" size="sm" className={cn('absolute right-6', lifted)} onClick={handleDownload}>
                    <Download className="h-4 w-4" />
                    {t('common.download')}
                </Button>
            )}

            {mediaItems.length > 1 && (
                <div className={cn('absolute left-6 text-small tabular-nums text-viewer-muted', lifted)}>
                    {currentIndex + 1} / {mediaItems.length}
                </div>
            )}

            {item.sourceLabel && item.onSourceJump && (
                <button
                    type="button"
                    onClick={item.onSourceJump}
                    className="absolute bottom-6 left-1/2 max-w-[60vw] -translate-x-1/2 truncate rounded-pill px-2 text-small text-viewer-muted underline decoration-viewer underline-offset-2 transition-colors duration-fast ease-standard hover:text-viewer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group"
                >
                    {item.sourceLabel}
                </button>
            )}
            {item.sourceLabel && !item.onSourceJump && (
                <div className="absolute bottom-6 left-1/2 max-w-[60vw] -translate-x-1/2 truncate text-small text-viewer-muted">{item.sourceLabel}</div>
            )}

            {toastMessage && (
                <div role="status" className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-pill bg-toast px-4 py-2 text-small text-viewer animate-reveal motion-reduce:animate-none">
                    {toastMessage}
                </div>
            )}
        </Modal>
    );
};

/**
 * Backwards-compatible wrapper for simple single-photo usage.
 * Used by components that only need to show a single photo.
 */
interface PhotoDetailModalProps {
    src: string;
    alt?: string;
    onClose: () => void;
    timestamp?: string;
}

export const PhotoDetailModal: React.FC<PhotoDetailModalProps> = ({ src, onClose, timestamp }) => {
    const item: MediaViewerItem = { src, type: 'picture', timestamp: timestamp || '' };
    return (
        <MediaViewerModal
            mediaItems={[item]}
            currentIndex={0}
            onClose={onClose}
            onNavigate={() => {}}
        />
    );
};
