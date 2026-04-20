import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Download } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { cn, formatDownloadFilename } from '../../utils/classnames';
import { downloadMedia } from '../../utils/download';
import { Z_CLASS } from '../../constants/zIndex';
import { useClipboardShortcut } from './useClipboardShortcut';
import { VoicePlayer } from './VoicePlayer';
import { VideoPlayer } from './VideoPlayer';
import { TranscribeButton } from './TranscribeButton';
import { TranscriptPanel } from './TranscriptPanel';
import { useTranscription } from '../../hooks/useTranscription';

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
}

/**
 * Unified media viewer modal for photos, videos, and voice.
 *
 * Keyboard controls:
 * - Left/Right: Navigate to previous/next media
 * - Up/Down: Zoom in/out (photos) or volume up/down (video/voice)
 * - Escape: Close
 */
export const MediaViewerModal: React.FC<MediaViewerModalProps> = ({
    mediaItems,
    currentIndex,
    onClose,
    onNavigate,
}) => {
    const { t } = useTranslation();
    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);
    const modalRef = useRef<HTMLDivElement>(null);

    const [zoom, setZoom] = useState(1);

    const item = mediaItems[currentIndex];

    // Transcription — active for voice and non-muted video items with messageId
    const isTranscribable = item?.messageId != null && (item?.type === 'voice' || (item?.type === 'video' && !item?.isMuted));
    const { transcription, state: transcriptionState, trigger: triggerTranscription } = useTranscription(
        isTranscribable ? item?.service : undefined,
        isTranscribable ? item?.messageId : undefined,
        isTranscribable ? item?.memberPath : undefined,
    );

    // Clipboard shortcut — window-level Ctrl+C listener
    const { toastMessage } = useClipboardShortcut(item?.src, item?.type);

    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < mediaItems.length - 1;

    // Reset zoom when navigating to a new item
    useEffect(() => {
        setZoom(1);
    }, [currentIndex]);

    // Focus modal for keyboard capture
    useEffect(() => {
        modalRef.current?.focus();
    }, [currentIndex]);

    const handleDownload = useCallback(() => {
        if (!item) return;
        downloadMedia(item.src, formatDownloadFilename(item.src, item.timestamp));
    }, [item]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'Escape':
                // When in fullscreen, Escape exits fullscreen (browser handles it).
                // Don't also close the modal — the user wants to stay in the viewer.
                if (document.fullscreenElement) break;
                e.preventDefault();
                onClose();
                break;
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
    }, [onClose, hasPrev, hasNext, currentIndex, onNavigate, item?.type]);

    if (!item) return null;

    return (
        <div
            ref={modalRef}
            tabIndex={-1}
            className={cn("fixed inset-0 bg-black/90 flex items-center justify-center outline-none", Z_CLASS.MODAL_DETAIL)}
            onClick={onClose}
            onKeyDown={handleKeyDown}
        >
            {/* Close button */}
            <button className="absolute top-4 right-4 text-white/70 hover:text-white z-10" onClick={onClose}>
                <X className="w-6 h-6" />
            </button>

            {/* Media content */}
            <div className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center" onClick={e => e.stopPropagation()}>
                {item.type === 'picture' && (
                    <img
                        src={item.src}
                        alt="Media"
                        className="max-w-[90vw] max-h-[90vh] object-contain transition-transform duration-150"
                        style={{ transform: `scale(${zoom})` }}
                        draggable={false}
                    />
                )}
                {item.type === 'video' && (
                    <div className="flex flex-col items-center gap-3">
                        <VideoPlayer
                            src={item.src}
                            autoPlay
                            messageTimestamp={item.timestamp}
                            noAudio={item.isMuted}
                            viewerMode
                            videoClassName="max-w-[90vw] max-h-[90vh]"
                            transcriptionSegments={transcriptionState === 'done' && transcription ? transcription.segments : undefined}
                        />
                        {isTranscribable && (
                            <div className="w-full px-2">
                                <TranscribeButton
                                    state={transcriptionState}
                                    onClick={triggerTranscription}
                                    variant="light"
                                />
                                {transcriptionState === 'done' && transcription && (
                                    <TranscriptPanel
                                        segments={transcription.segments}
                                        variant="light"
                                        defaultExpanded
                                    />
                                )}
                            </div>
                        )}
                    </div>
                )}
                {item.type === 'voice' && (
                    <div className="w-96 flex flex-col gap-3">
                        <VoicePlayer
                            src={item.src}
                            variant="premium"
                            avatarUrl={item.avatarUrl}
                            memberName={item.memberName}
                            messageTimestamp={item.timestamp}
                            autoPlay
                            viewerMode
                        />
                        {isTranscribable && (
                            <div>
                                <TranscribeButton
                                    state={transcriptionState}
                                    onClick={triggerTranscription}
                                    variant="light"
                                />
                                {transcriptionState === 'done' && transcription && (
                                    <TranscriptPanel
                                        segments={transcription.segments}
                                        variant="light"
                                        defaultExpanded
                                    />
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Download button (photos only — video and voice have their own controls) */}
            {goldenFingerActive && item.type === 'picture' && (
                <button
                    onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                    className={cn(
                        "absolute right-6 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg text-sm flex items-center gap-2 backdrop-blur-sm transition-colors",
                        item.sourceLabel && item.onSourceJump ? "bottom-14" : "bottom-6"
                    )}
                >
                    <Download className="w-4 h-4" />
                    {t('common.download')}
                </button>
            )}

            {/* Navigation counter */}
            {mediaItems.length > 1 && (
                <div className={cn(
                    "absolute left-6 text-white/60 text-sm",
                    item.sourceLabel && item.onSourceJump ? "bottom-14" : "bottom-6"
                )}>
                    {currentIndex + 1} / {mediaItems.length}
                </div>
            )}

            {/* Source label */}
            {item.sourceLabel && item.onSourceJump && (
                <button
                    onClick={(e) => { e.stopPropagation(); item.onSourceJump!(); }}
                    className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/70 hover:text-white text-sm max-w-[60vw] truncate transition-colors underline underline-offset-2 decoration-white/30 hover:decoration-white/60"
                >
                    {item.sourceLabel}
                </button>
            )}

            {/* Clipboard toast */}
            {toastMessage && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/80 text-white text-sm rounded-lg animate-fade-in z-20">
                    {toastMessage}
                </div>
            )}
        </div>
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
