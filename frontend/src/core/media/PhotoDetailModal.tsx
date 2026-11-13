import React, { useEffect, useCallback, useRef } from 'react';
import { X, Download, ZoomIn, ZoomOut, Shrink } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { cn, formatDownloadFilename } from '../../utils/classnames';
import { downloadMedia } from '../../utils/download';
import { timeNeighbours, type ListOrder } from '../../utils/timeOrder';
import { Modal, IconButton, Button, LiveRegion } from '../../design/primitives';
import { useClipboardShortcut } from './useClipboardShortcut';
import { VoicePlayer } from './VoicePlayer';
import { VideoPlayer } from './VideoPlayer';
import { PhotoPlayer } from './PhotoPlayer';
import { useZoomPan, MIN_ZOOM, MAX_ZOOM } from './useZoomPan';

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
    /** How `mediaItems` is sorted (default `oldest_first`); ← / → always step older / newer and the counter counts the oldest as 1. */
    order?: ListOrder;
}

/**
 * Unified media viewer modal for photos, videos, and voice.
 *
 * Keyboard controls:
 * - Left/Right: Older/newer media, whichever way `order` sorts the list (never pan, even zoomed)
 * - Up/Down: Zoom in/out (photos) or volume up/down (video/voice)
 * - Escape: Close (handled by the dialog layer, which respects fullscreen)
 *
 * Photo zoom (1–4×, see `useZoomPan`): the mouse wheel zooms around the cursor anywhere in the
 * viewer (and never scrolls the page behind); the top-left − / fit / + buttons step out, back to
 * fit and in; when zoomed, dragging pans (clamped so the photo stays on screen); a double-click
 * toggles fit ↔ 2× at the click point. Zoom and pan reset when the item changes.
 */
export const MediaViewerModal: React.FC<MediaViewerModalProps> = ({
    mediaItems,
    currentIndex,
    onClose,
    onNavigate,
    headerSlot,
    order = 'oldest_first',
}) => {
    const { t } = useTranslation();
    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);

    const stageRef = useRef<HTMLDivElement>(null);

    const item = mediaItems[currentIndex];
    const isPicture = item?.type === 'picture';
    // Zoom and pan reset when navigating to a new item. (Video/voice transcription
    // state is owned by the player components themselves via messageId.)
    const { view, dragging, step, reset, stageHandlers } = useZoomPan(stageRef, isPicture, `${currentIndex}:${item?.src}`);

    // Clipboard shortcut — window-level Ctrl+C listener
    const { toastMessage } = useClipboardShortcut(item?.src, item?.type);

    const { older, newer, ordinal } = timeNeighbours(currentIndex, mediaItems.length, order);

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
                if (older !== null) onNavigate(older);
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (newer !== null) onNavigate(newer);
                break;
            // ↑ / ↓ zoom a photo; for video and voice they stay unclaimed: the player owns volume.
            case 'ArrowUp':
                if (isPicture) {
                    e.preventDefault();
                    step(1);
                }
                break;
            case 'ArrowDown':
                if (isPicture) {
                    e.preventDefault();
                    step(-1);
                }
                break;
        }
    }, [older, newer, onNavigate, isPicture, step]);

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

            {isPicture && (
                // aria-disabled (not disabled) at the limits, so a focused button keeps focus and ← / → keep working.
                <div className="absolute left-4 top-4 z-10 flex gap-2">
                    <IconButton variant="overlay" aria-label={t('common.zoomOut')} icon={<ZoomOut />} aria-disabled={view.scale <= MIN_ZOOM || undefined} onClick={() => step(-1)} />
                    <IconButton variant="overlay" aria-label={t('common.zoomFit')} icon={<Shrink />} aria-disabled={view.scale <= MIN_ZOOM || undefined} onClick={reset} />
                    <IconButton variant="overlay" aria-label={t('common.zoomIn')} icon={<ZoomIn />} aria-disabled={view.scale >= MAX_ZOOM || undefined} onClick={() => step(1)} />
                </div>
            )}

            {headerSlot && <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2">{headerSlot}</div>}

            <div
                ref={stageRef}
                data-testid="viewer-stage"
                className={cn(
                    'relative flex max-h-[90vh] max-w-[90vw] items-center justify-center',
                    isPicture && 'touch-none select-none',
                    isPicture && view.scale > MIN_ZOOM && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
                )}
                {...(isPicture ? stageHandlers : {})}
            >
                {isPicture && (
                    <PhotoPlayer
                        variant="fullscreen"
                        src={item.src}
                        alt={t('common.mediaViewer')}
                        zoom={view.scale}
                        pan={view}
                        className={dragging ? 'transition-none' : undefined}
                    />
                )}
                {item.type === 'video' && (
                    <div className="flex flex-col items-center gap-3">
                        {/* Keyed by source: each item gets a fresh player (no carried-over state) */}
                        <VideoPlayer
                            key={item.src}
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
                            key={item.src}
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
                    {ordinal} / {mediaItems.length}
                </div>
            )}

            {item.sourceLabel && item.onSourceJump && (
                <button
                    type="button"
                    onClick={item.onSourceJump}
                    className="absolute bottom-6 left-1/2 max-w-[60vw] -translate-x-1/2 truncate rounded-pill px-2 text-small text-viewer-muted underline decoration-viewer underline-offset-2 transition-colors duration-fast ease-standard hover:text-viewer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {item.sourceLabel}
                </button>
            )}
            {item.sourceLabel && !item.onSourceJump && (
                <div className="absolute bottom-6 left-1/2 max-w-[60vw] -translate-x-1/2 truncate text-small text-viewer-muted">{item.sourceLabel}</div>
            )}

            <LiveRegion message={toastMessage ?? ''} />
            {toastMessage && (
                <div aria-hidden="true" className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-pill bg-toast px-4 py-2 text-small text-viewer animate-reveal motion-reduce:animate-none">
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
