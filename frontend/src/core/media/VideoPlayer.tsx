import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Download, Repeat, MoreVertical, RotateCcw } from 'lucide-react';
import { cn, formatDownloadFilename } from '../../utils/classnames';
import { downloadMedia } from '../../utils/download';
import { copyVideoToClipboard } from '../../utils/clipboard';
import { useAmplifiedVolume } from './useAmplifiedVolume';
import { useMediaDuration, useMediaSource } from './mediaElement';
import { useMediaPlayback } from './useMediaPlayback';
import { clientLog } from '../../utils/clientLog';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { useTranscription, type TranscriptionSegment } from '../../hooks/useTranscription';
import { useJustBecame } from '../../hooks/useJustBecame';
import { SubtitleOverlay } from './SubtitleOverlay';
import { TranscriptPanel } from './TranscriptPanel';
import { TranscribeButton } from './TranscribeButton';
import { Button, Spinner, Menu, MenuItem, MenuLabel, MenuSeparator } from '../../design/primitives';

const VOLUME_STORAGE_KEY = 'sakadesk_video_amp';

/** Keyboard focus ring for the bar's controls (DESIGN_SYSTEM §9); no offset on the dark bar. */
const BAR_FOCUS_RING = 'rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ring-offset-0';

interface VideoPlayerProps {
    src: string;
    /**
     * Single source of truth for how this video is displayed.
     *  - `bubble`     — inline chat bubble (default). No CC button; subtitles
     *                   appear only when the user fullscreens the video.
     *  - `gallery`    — media-gallery detail view. Subtitles + CC visible.
     *  - `fullscreen` — MediaViewerModal. Subtitles + CC visible and a
     *                   TranscriptPanel renders below the video.
     *
     * `gallery` and `fullscreen` own transcription internally when the
     * caller passes `messageId` + `service` + `memberPath`; otherwise they
     * fall back to the external `transcriptionSegments` prop.
     */
    variant?: 'bubble' | 'gallery' | 'fullscreen';
    /** Auto-start playing when component mounts */
    autoPlay?: boolean;
    /** Raw ISO timestamp of the message, used for download filename prefix */
    messageTimestamp?: string;
    /** Whether the video has no audio track (detected during sync) */
    noAudio?: boolean;
    /**
     * Force viewer-mode keyboard shortcuts (Space, M, Up/Down, F, D) and
     * always-on subtitles/CC button. Gallery/fullscreen variants enable
     * this automatically; use this prop only for unusual cases.
     */
    viewerMode?: boolean;
    /** CSS class for the outer container */
    className?: string;
    /** Max height/width constraints for the video element */
    videoClassName?: string;
    /**
     * External subtitle segments. Used by the `bubble` variant (MessageBubble
     * fetches transcription once and shares with its footer). For
     * `gallery` / `fullscreen`, prefer `messageId` + `service` + `memberPath`.
     */
    transcriptionSegments?: TranscriptionSegment[];
    /** Message id — enables internal transcription in gallery/fullscreen */
    messageId?: number;
    /** Service id — enables internal transcription in gallery/fullscreen */
    service?: string;
    /** Member dir path — enables internal transcription in gallery/fullscreen */
    memberPath?: string;
    /** Called on each time update with current playback time in seconds */
    onTimeUpdate?: (time: number) => void;
    /** Called externally to seek to a specific time */
    seekTo?: number;
}

const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
};

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
    src,
    variant = 'bubble',
    autoPlay,
    messageTimestamp,
    noAudio,
    viewerMode,
    className,
    videoClassName,
    transcriptionSegments,
    messageId,
    service,
    memberPath,
    onTimeUpdate,
    seekTo,
}) => {
    // Gallery + fullscreen behave as viewer mode by default (keyboard +
    // always-visible subtitles). Explicit `viewerMode` prop wins so unusual
    // call sites can still override.
    const isViewerVariant = variant === 'gallery' || variant === 'fullscreen';
    const effectiveViewerMode = viewerMode ?? isViewerVariant;
    // Gallery/fullscreen can own transcription when caller provides id+service+path.
    const ownsTranscription = isViewerVariant
        && messageId !== undefined && service !== undefined && memberPath !== undefined;
    const {
        transcription,
        state: transcriptionState,
        trigger: triggerTranscription,
        retrigger: retriggerTranscription,
        error: transcriptionError,
    } = useTranscription(
        ownsTranscription ? service : undefined,
        ownsTranscription ? messageId : undefined,
        ownsTranscription ? memberPath : undefined,
    );
    // Effective subtitle segments: internal (gallery/fullscreen) or external.
    const effectiveSegments = ownsTranscription
        ? transcription?.segments
        : transcriptionSegments;
    const transcriptionJustCompleted = useJustBecame(transcriptionState, 'done', 'loading');
    // Bridge click-to-seek from the below-player TranscriptPanel into the video element.
    // Internal seek carries a bumping `seq` so clicking the SAME transcript line
    // twice still re-fires the seek effect (a bare time value would be deduped by
    // React's state bail-out and the second click would be a silent no-op).
    const [internalSeek, setInternalSeek] = useState<{ time: number; seq: number } | undefined>(undefined);
    const seekSeqRef = useRef(0);
    const handleTranscriptSeek = useCallback((time: number) => {
        seekSeqRef.current += 1;
        setInternalSeek({ time, seq: seekSeqRef.current });
    }, []);
    const { t } = useTranslation();
    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Breadcrumbs for the keyboard decisions below are logged once per player, not per tick or key.
    const loggedHeldRef = useRef(false);
    const loggedSpaceRef = useRef(false);

    const [isPlaying, setIsPlaying] = useState(false);
    const [showSubtitles, setShowSubtitles] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [loop, setLoop] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
    const menuButtonRef = useRef<HTMLButtonElement>(null);

    const { volume, setVolume, isMuted, toggleMute, connectElement, prepareForPlayback } = useAmplifiedVolume(VOLUME_STORAGE_KEY);
    const { status: playbackStatus, play, retry } = useMediaPlayback(videoRef, 'video', src);

    // Connect video to amplification pipeline
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => {
            setCurrentTime(video.currentTime);
            onTimeUpdate?.(video.currentTime);
        };
        const handleEnded = () => setIsPlaying(false);
        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('ended', handleEnded);
        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);

        connectElement(video);
        video.playbackRate = playbackRate;

        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('ended', handleEnded);
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
        };
    }, [connectElement]);

    // The source is bound imperatively so the element is released (pause, drop
    // src, load) before the source changes and on unmount: an abandoned video
    // must not keep one of the browser's few media connections open.
    useMediaSource(videoRef, src);
    const duration = useMediaDuration(videoRef, src);

    // Build the amplification graph (first play) before starting playback.
    const startPlayback = useCallback(() => {
        prepareForPlayback();
        play();
    }, [prepareForPlayback, play]);

    const handleRetry = useCallback(() => {
        prepareForPlayback();
        retry();
    }, [prepareForPlayback, retry]);

    // Auto-play on mount or when src changes (e.g., navigating between videos in viewer)
    useEffect(() => {
        if (autoPlay && videoRef.current) {
            startPlayback();
        }
    }, [autoPlay, src, startPlayback]);

    // Sync playback rate
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.playbackRate = playbackRate;
        }
    }, [playbackRate]);

    // External seek request (parent-controlled position, e.g. subtitle sync)
    useEffect(() => {
        if (seekTo != null && videoRef.current) {
            videoRef.current.currentTime = seekTo;
            setCurrentTime(seekTo);
        }
    }, [seekTo]);

    // Internal seek request from transcript clicks (seq-keyed so repeat clicks re-fire)
    useEffect(() => {
        if (internalSeek && videoRef.current) {
            videoRef.current.currentTime = internalSeek.time;
            setCurrentTime(internalSeek.time);
        }
    }, [internalSeek]);

    // Track fullscreen changes and restore focus after exit
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
            // After exiting fullscreen, focus drifts to body (VideoPlayer container
            // has no tabIndex). Re-focus the closest parent modal so keyboard events
            // bubble through it for navigation (ArrowLeft/Right) and zoom (ArrowUp/Down).
            if (!document.fullscreenElement && effectiveViewerMode) {
                const modal = containerRef.current?.closest<HTMLElement>('[tabindex]');
                if (modal) modal.focus();
            }
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, [effectiveViewerMode]);

    // Auto-hide controls shortly after the mouse stops moving, but never while keyboard focus is in
    // the player (a focused control must stay visible; UI health #7). Mouse focus does not hold them:
    // Chromium focuses a clicked button, and `:focus-visible` tells the two apart.
    const resetControlsTimeout = useCallback(() => {
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => {
            const el = document.activeElement;
            const keyboardFocusInside = !!el && !!containerRef.current?.contains(el) && el.matches(':focus-visible');
            if (isPlaying && keyboardFocusInside && !loggedHeldRef.current) {
                loggedHeldRef.current = true;
                clientLog('media_playback', { surface: 'video', phase: 'controls', outcome: 'held_by_focus' });
            }
            if (isPlaying && !keyboardFocusInside) setShowControls(false);
        }, 800);
    }, [isPlaying]);

    // Keyboard focus moving onto a control shows the controls and restarts the timer; a click does not.
    const handleFocusCapture = useCallback((e: React.FocusEvent) => {
        if (e.target instanceof Element && e.target.matches(':focus-visible')) resetControlsTimeout();
    }, [resetControlsTimeout]);

    // Focus leaving the player while the timer was held: arm the hide timer again.
    const handleBlurCapture = useCallback((e: React.FocusEvent) => {
        const next = e.relatedTarget;
        if (isPlaying && !(next instanceof Node && containerRef.current?.contains(next))) resetControlsTimeout();
    }, [isPlaying, resetControlsTimeout]);

    useEffect(() => {
        if (!isPlaying) {
            setShowControls(true);
            if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        } else {
            resetControlsTimeout();
        }
    }, [isPlaying, resetControlsTimeout]);

    const togglePlay = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            startPlayback();
        } else {
            video.pause();
        }
    }, [startPlayback]);

    const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const video = videoRef.current;
        if (!video) return;
        const time = parseFloat(e.target.value);
        video.currentTime = time;
        setCurrentTime(time);
    }, []);

    const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setVolume(parseFloat(e.target.value));
    }, [setVolume]);

    const handleDownload = useCallback(() => {
        downloadMedia(src, formatDownloadFilename(src, messageTimestamp));
    }, [src, messageTimestamp]);

    const toggleFullscreen = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            container.requestFullscreen();
        }
    }, []);

    const handleMenuToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setShowMenu(prev => {
            if (!prev && menuButtonRef.current) {
                const rect = menuButtonRef.current.getBoundingClientRect();
                if (isFullscreen && containerRef.current) {
                    // In fullscreen, position relative to the container
                    const containerRect = containerRef.current.getBoundingClientRect();
                    setMenuStyle({
                        position: 'absolute' as const,
                        bottom: `${containerRect.bottom - rect.top + 8}px`,
                        right: `${containerRect.right - rect.right}px`,
                    });
                } else {
                    setMenuStyle({
                        position: 'fixed' as const,
                        bottom: `${window.innerHeight - rect.top + 8}px`,
                        right: `${window.innerWidth - rect.right}px`,
                    });
                }
            }
            return !prev;
        });
    }, [isFullscreen]);

    const handleMenuDownload = useCallback(() => {
        handleDownload();
        setShowMenu(false);
    }, [handleDownload]);

    const handleMenuPlaybackRate = useCallback((rate: number) => {
        setPlaybackRate(rate);
        if (videoRef.current) videoRef.current.playbackRate = rate;
        setShowMenu(false);
    }, []);

    // Viewer-mode keyboard shortcuts (window-level, no focus required)
    useEffect(() => {
        if (!effectiveViewerMode) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // A menu, field or already-handled key is not a player shortcut.
            if (e.defaultPrevented) return;
            const el = e.target instanceof HTMLElement ? e.target : null;
            if (el?.closest('[role="menu"], input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
            switch (e.key) {
                case ' ':
                    if (el?.closest('button')) { // the focused button's own action
                        if (!loggedSpaceRef.current) {
                            loggedSpaceRef.current = true;
                            clientLog('media_playback', { surface: 'video', phase: 'shortcut', outcome: 'space_left_to_button' });
                        }
                        return;
                    }
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'm':
                case 'M':
                    e.preventDefault();
                    toggleMute();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setVolume(Math.min(volume + 0.05, 1));
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    setVolume(Math.max(volume - 0.05, 0));
                    break;
                case 'f':
                case 'F':
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case 'd':
                case 'D':
                    if (goldenFingerActive) {
                        e.preventDefault();
                        handleDownload();
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [effectiveViewerMode, togglePlay, toggleMute, volume, setVolume, toggleFullscreen, goldenFingerActive, handleDownload]);

    // Ctrl+C clipboard copy for inline (non-viewer) video players.
    // In viewerMode, the parent modal's useClipboardShortcut handles this.
    // For inline players, we listen on the container when it has focus.
    const [clipboardToast, setClipboardToast] = useState<string | null>(null);
    const clipboardToastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => { if (clipboardToastTimeout.current) clearTimeout(clipboardToastTimeout.current); };
    }, []);

    const handleClipboardCopy = useCallback(() => {
        if (!goldenFingerActive || effectiveViewerMode) return;
        copyVideoToClipboard(src)
            .then(() => {
                if (clipboardToastTimeout.current) clearTimeout(clipboardToastTimeout.current);
                setClipboardToast(t('about.goldenFingerCopied'));
                clipboardToastTimeout.current = setTimeout(() => setClipboardToast(null), 2000);
            })
            .catch(() => {
                if (clipboardToastTimeout.current) clearTimeout(clipboardToastTimeout.current);
                setClipboardToast(t('about.goldenFingerCopyFailed'));
                clipboardToastTimeout.current = setTimeout(() => setClipboardToast(null), 2000);
            });
    }, [goldenFingerActive, effectiveViewerMode, src, t]);

    useEffect(() => {
        if (effectiveViewerMode || !goldenFingerActive) return;

        const handleCtrlC = (e: KeyboardEvent) => {
            // Only handle Ctrl+C when this video's container is in fullscreen
            // (inline chat bubble → user pressed F to go fullscreen).
            // When not fullscreen, don't intercept Ctrl+C (user might be copying text).
            if (!e.ctrlKey || e.key !== 'c') return;
            if (document.fullscreenElement !== containerRef.current) return;
            e.preventDefault();
            handleClipboardCopy();
        };

        window.addEventListener('keydown', handleCtrlC);
        return () => window.removeEventListener('keydown', handleCtrlC);
    }, [effectiveViewerMode, goldenFingerActive, handleClipboardCopy]);

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    const playerNode = (
        <div
            ref={containerRef}
            className={cn("relative group bg-black flex items-center justify-center", className)}
            onMouseMove={resetControlsTimeout}
            onFocusCapture={handleFocusCapture}
            onBlurCapture={handleBlurCapture}
            onClick={(e) => {
                // Click on the video area (not controls) toggles play
                if ((e.target as HTMLElement).tagName === 'VIDEO') {
                    togglePlay();
                }
            }}
        >
            {/* Video element — no native controls */}
            <video
                ref={videoRef}
                className={cn("max-w-full max-h-full", isFullscreen ? "w-full h-full object-contain" : videoClassName)}
                playsInline
                disablePictureInPicture
                loop={loop}
            />

            {/* Subtitle overlay — shown in fullscreen and in the media gallery
                detail view (viewer variants). Hidden in inline chat bubble to
                keep the thumbnail uncluttered; fullscreening the bubble still
                works because `isFullscreen` flips on. */}
            {effectiveSegments && (isFullscreen || effectiveViewerMode) && (
                <SubtitleOverlay
                    segments={effectiveSegments}
                    currentTime={currentTime}
                    visible={showSubtitles}
                    fullscreen={isFullscreen}
                />
            )}

            {/* Big center play button when paused */}
            {!isPlaying && playbackStatus !== 'error' && (
                <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={t('media.play')}
                    className="absolute inset-0 flex items-center justify-center bg-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                    <div className="w-16 h-16 rounded-full bg-white/30 backdrop-blur-sm flex items-center justify-center hover:bg-white/40 transition-colors">
                        <Play aria-hidden="true" className="w-8 h-8 text-white fill-current ml-1" />
                    </div>
                </button>
            )}

            {/* Buffering: waiting for data while playing */}
            {playbackStatus === 'buffering' && (
                <div
                    data-testid="video-buffering"
                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                    <Spinner size="lg" tone="viewer" label={t('common.loading')} />
                </div>
            )}

            {/* Playback error: neutral message with a Retry that reloads the element */}
            {playbackStatus === 'error' && (
                <div
                    role="alert"
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-viewer-scrim p-4 text-center text-viewer"
                    onClick={e => e.stopPropagation()}
                >
                    <p className="text-small">{t('videoPlayer.playbackError')}</p>
                    <Button variant="overlay" size="sm" onClick={handleRetry}>
                        <RotateCcw aria-hidden="true" className="h-4 w-4" />
                        {t('common.retry')}
                    </Button>
                </div>
            )}

            {/* Bottom controls bar */}
            <div
                className={cn(
                    "absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-8 pb-2 px-3 transition-opacity duration-200",
                    showControls ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={e => e.stopPropagation()}
            >
                {/* Progress bar */}
                <div className="relative h-1 mb-2 group/seek rounded-full ring-offset-0 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent">
                    <div className="absolute inset-0 bg-white/30 rounded-full" />
                    <div
                        className="absolute inset-y-0 left-0 bg-white rounded-full"
                        style={{ width: `${progress}%` }}
                    />
                    <input
                        type="range"
                        min={0}
                        max={duration || 100}
                        step={0.1}
                        value={currentTime}
                        onChange={handleSeek}
                        aria-label={t('media.seek')}
                        aria-valuetext={t('media.timeOf', { current: formatTime(currentTime), total: formatTime(duration) })}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                </div>

                {/* Controls row */}
                <div className="flex items-center gap-2">
                    {/* Play/Pause */}
                    <button onClick={togglePlay} className={cn("text-white hover:text-white/80 p-1", BAR_FOCUS_RING)} type="button" aria-label={isPlaying ? t('media.pause') : t('media.play')}>
                        {isPlaying ? <Pause aria-hidden="true" className="w-5 h-5 fill-current" /> : <Play aria-hidden="true" className="w-5 h-5 fill-current ml-0.5" />}
                    </button>

                    {/* Time display */}
                    <span className="text-white/80 text-xs whitespace-nowrap">
                        {formatTime(currentTime)} / {formatTime(duration)}
                    </span>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Volume / No Audio indicator */}
                    {noAudio ? (
                        <div className="p-1 text-white/30" title={t('videoPlayer.noAudio')}>
                            <VolumeX aria-hidden="true" className="w-4 h-4" />
                        </div>
                    ) : (
                        <div className="flex items-center gap-1 group/vol">
                            <button onClick={toggleMute} className={cn("text-white hover:text-white/80 p-1", BAR_FOCUS_RING)} type="button" aria-label={isMuted || volume === 0 ? t('media.unmute') : t('media.mute')}>
                                {isMuted || volume === 0 ? <VolumeX aria-hidden="true" className="w-4 h-4" /> : <Volume2 aria-hidden="true" className="w-4 h-4" />}
                            </button>
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={volume}
                                onChange={handleVolumeChange}
                                aria-label={t('media.volume')}
                                aria-valuetext={t('media.volumeValue', { percent: Math.round(volume * 100) })}
                                className="w-16 h-1 rounded-full appearance-none cursor-pointer"
                                style={{
                                    background: `linear-gradient(to right, white ${volume * 100}%, rgba(255,255,255,0.3) ${volume * 100}%)`,
                                }}
                            />
                        </div>
                    )}

                    {/* Three-dot menu (Loop, Speed, Download) */}
                    <button
                        ref={menuButtonRef}
                        onClick={handleMenuToggle}
                        className={cn("text-white/60 hover:text-white p-1 transition-colors", BAR_FOCUS_RING)}
                        type="button"
                        aria-label={t('common.moreOptions')}
                        aria-haspopup="menu"
                        aria-expanded={showMenu}
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>

                    {/* CC toggle — only surface where subtitles can actually render */}
                    {effectiveSegments && (isFullscreen || effectiveViewerMode) && (
                        <button
                            onClick={() => setShowSubtitles(s => !s)}
                            className={cn("text-xs px-1.5 py-0.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ring-offset-0", showSubtitles ? "bg-white/20 text-white" : "text-white/40")}
                            title={t('transcription.cc')}
                            aria-label={t('transcription.cc')}
                            aria-pressed={showSubtitles}
                            type="button"
                        >
                            CC
                        </button>
                    )}

                    {/* Fullscreen */}
                    <button onClick={toggleFullscreen} className={cn("text-white/80 hover:text-white p-1", BAR_FOCUS_RING)} type="button" aria-label={isFullscreen ? t('media.exitFullscreen') : t('media.fullscreen')}>
                        {isFullscreen ? <Minimize aria-hidden="true" className="w-4 h-4" /> : <Maximize aria-hidden="true" className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            {/* Menu portal */}
            {/* Clipboard toast (inline fullscreen only) */}
            {clipboardToast && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/80 text-white text-sm rounded-sm z-50">
                    {clipboardToast}
                </div>
            )}

            {showMenu && createPortal(
                <Menu
                    aria-label={t('common.moreOptions')}
                    onClose={() => setShowMenu(false)}
                    layer="popover"
                    style={menuStyle}
                    ignoreRefs={[menuButtonRef]}
                    returnFocusRef={menuButtonRef}
                    className="w-max whitespace-nowrap"
                >
                    <MenuItem icon={<Repeat className="h-4 w-4" />} selected={loop} onClick={() => { setLoop((l) => !l); setShowMenu(false); }}>
                        {t('videoPlayer.loop')}
                        {loop && <span className="ml-auto text-caption">{t('common.on')}</span>}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuLabel>{t('voicePlayer.speed')}</MenuLabel>
                    {[0.5, 1, 1.5, 2].map((rate) => (
                        <MenuItem key={rate} radio selected={playbackRate === rate} onClick={() => handleMenuPlaybackRate(rate)}>
                            {rate}x
                        </MenuItem>
                    ))}
                    {goldenFingerActive && (
                        <>
                            <MenuSeparator />
                            <MenuItem icon={<Download className="h-4 w-4" />} onClick={handleMenuDownload}>{t('common.download')}</MenuItem>
                        </>
                    )}
                </Menu>,
                isFullscreen && containerRef.current ? containerRef.current : document.body,
            )}
        </div>
    );

    // Fullscreen variant appends an internal TranscriptPanel (or the
    // TranscribeButton when transcription hasn't started yet) below the
    // player. Other variants just return the player.
    if (variant !== 'fullscreen' || !ownsTranscription) {
        return playerNode;
    }
    return (
        <>
            {playerNode}
            <div className="w-full px-2">
                {transcriptionState === 'done' && transcription ? (
                    <TranscriptPanel
                        key={messageId}
                        segments={transcription.segments}
                        noSpeech={transcription.no_speech}
                        currentTime={currentTime}
                        onSeek={handleTranscriptSeek}
                        onRerun={retriggerTranscription}
                        variant="light"
                        defaultExpanded={transcriptionJustCompleted}
                    />
                ) : (
                    <TranscribeButton
                        state={transcriptionState}
                        onClick={triggerTranscription}
                        error={transcriptionError}
                        variant="light"
                    />
                )}
            </div>
        </>
    );
};
