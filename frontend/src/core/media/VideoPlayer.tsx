import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Download, Repeat, MoreVertical } from 'lucide-react';
import { cn, formatDownloadFilename } from '../../utils/classnames';
import { downloadMedia } from '../../utils/download';
import { copyVideoToClipboard } from '../../utils/clipboard';
import { useAmplifiedVolume } from './useAmplifiedVolume';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import type { TranscriptionSegment } from '../../hooks/useTranscription';
import { SubtitleOverlay } from './SubtitleOverlay';

const VOLUME_STORAGE_KEY = 'sakadesk_video_amp';

interface VideoPlayerProps {
    src: string;
    /** Auto-start playing when component mounts */
    autoPlay?: boolean;
    /** Raw ISO timestamp of the message, used for download filename prefix */
    messageTimestamp?: string;
    /** Whether the video has no audio track (detected during sync) */
    noAudio?: boolean;
    /** Enable keyboard shortcuts (Space, M, Up/Down, F, D). Only for viewer/modal, not chat bubbles. */
    viewerMode?: boolean;
    /** CSS class for the outer container */
    className?: string;
    /** Max height/width constraints for the video element */
    videoClassName?: string;
    /** Transcription segments for subtitle display */
    transcriptionSegments?: TranscriptionSegment[];
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
    autoPlay,
    messageTimestamp,
    noAudio,
    viewerMode,
    className,
    videoClassName,
    transcriptionSegments,
    onTimeUpdate,
    seekTo,
}) => {
    const { t } = useTranslation();
    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [showSubtitles, setShowSubtitles] = useState(true);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [loop, setLoop] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const menuPortalRef = useRef<HTMLDivElement>(null);

    const { volume, setVolume, isMuted, toggleMute, connectElement } = useAmplifiedVolume(VOLUME_STORAGE_KEY);

    // Connect video to amplification pipeline
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => {
            setCurrentTime(video.currentTime);
            onTimeUpdate?.(video.currentTime);
        };
        const handleLoadedMetadata = () => setDuration(video.duration);
        const handleEnded = () => setIsPlaying(false);
        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('ended', handleEnded);
        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);

        connectElement(video);
        video.playbackRate = playbackRate;

        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('ended', handleEnded);
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
        };
    }, [connectElement]);

    // Auto-play on mount or when src changes (e.g., navigating between videos in viewer)
    useEffect(() => {
        if (autoPlay && videoRef.current) {
            videoRef.current.play().catch(() => {});
        }
    }, [autoPlay, src]);

    // Sync playback rate
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.playbackRate = playbackRate;
        }
    }, [playbackRate]);

    // External seek request
    useEffect(() => {
        if (seekTo != null && videoRef.current) {
            videoRef.current.currentTime = seekTo;
            setCurrentTime(seekTo);
        }
    }, [seekTo]);

    // Track fullscreen changes and restore focus after exit
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
            // After exiting fullscreen, focus drifts to body (VideoPlayer container
            // has no tabIndex). Re-focus the closest parent modal so keyboard events
            // bubble through it for navigation (ArrowLeft/Right) and zoom (ArrowUp/Down).
            if (!document.fullscreenElement && viewerMode) {
                const modal = containerRef.current?.closest<HTMLElement>('[tabindex]');
                if (modal) modal.focus();
            }
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, [viewerMode]);

    // Auto-hide controls shortly after mouse stops moving
    const resetControlsTimeout = useCallback(() => {
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => {
            if (isPlaying) setShowControls(false);
        }, 800);
    }, [isPlaying]);

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
            video.play();
        } else {
            video.pause();
        }
    }, []);

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

    // Close menu on click outside or Escape
    useEffect(() => {
        if (!showMenu) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                menuButtonRef.current && !menuButtonRef.current.contains(target) &&
                menuPortalRef.current && !menuPortalRef.current.contains(target)
            ) {
                setShowMenu(false);
            }
        };
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setShowMenu(false);
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEsc);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [showMenu]);

    // Viewer-mode keyboard shortcuts (window-level, no focus required)
    useEffect(() => {
        if (!viewerMode) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case ' ':
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
    }, [viewerMode, togglePlay, toggleMute, volume, setVolume, toggleFullscreen, goldenFingerActive, handleDownload]);

    // Ctrl+C clipboard copy for inline (non-viewer) video players.
    // In viewerMode, the parent modal's useClipboardShortcut handles this.
    // For inline players, we listen on the container when it has focus.
    const [clipboardToast, setClipboardToast] = useState<string | null>(null);
    const clipboardToastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => { if (clipboardToastTimeout.current) clearTimeout(clipboardToastTimeout.current); };
    }, []);

    const handleClipboardCopy = useCallback(() => {
        if (!goldenFingerActive || viewerMode) return;
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
    }, [goldenFingerActive, viewerMode, src, t]);

    useEffect(() => {
        if (viewerMode || !goldenFingerActive) return;

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
    }, [viewerMode, goldenFingerActive, handleClipboardCopy]);

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div
            ref={containerRef}
            className={cn("relative group bg-black flex items-center justify-center", className)}
            onMouseMove={resetControlsTimeout}
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
                src={src}
                className={cn("max-w-full max-h-full", isFullscreen ? "w-full h-full object-contain" : videoClassName)}
                playsInline
                disablePictureInPicture
                loop={loop}
            />

            {/* Subtitle overlay — shown in fullscreen and in the media gallery
                detail view (viewerMode). Hidden in inline chat bubble to keep
                the thumbnail uncluttered; fullscreening the bubble still works. */}
            {transcriptionSegments && (isFullscreen || viewerMode) && (
                <SubtitleOverlay
                    segments={transcriptionSegments}
                    currentTime={currentTime}
                    visible={showSubtitles}
                    fullscreen={isFullscreen}
                />
            )}

            {/* Big center play button when paused */}
            {!isPlaying && (
                <button
                    onClick={togglePlay}
                    className="absolute inset-0 flex items-center justify-center bg-black/20"
                >
                    <div className="w-16 h-16 rounded-full bg-white/30 backdrop-blur-sm flex items-center justify-center hover:bg-white/40 transition-colors">
                        <Play className="w-8 h-8 text-white fill-current ml-1" />
                    </div>
                </button>
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
                <div className="relative h-1 mb-2 group/seek">
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
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                </div>

                {/* Controls row */}
                <div className="flex items-center gap-2">
                    {/* Play/Pause */}
                    <button onClick={togglePlay} className="text-white hover:text-white/80 p-1" type="button">
                        {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
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
                            <VolumeX className="w-4 h-4" />
                        </div>
                    ) : (
                        <div className="flex items-center gap-1 group/vol">
                            <button onClick={toggleMute} className="text-white hover:text-white/80 p-1" type="button">
                                {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                            </button>
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={volume}
                                onChange={handleVolumeChange}
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
                        className="text-white/60 hover:text-white p-1 transition-colors"
                        type="button"
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>

                    {/* CC toggle — only surface where subtitles can actually render */}
                    {transcriptionSegments && (isFullscreen || viewerMode) && (
                        <button
                            onClick={() => setShowSubtitles(s => !s)}
                            className={cn("text-xs px-1.5 py-0.5 rounded transition-colors", showSubtitles ? "bg-white/20 text-white" : "text-white/40")}
                            title={t('transcription.cc')}
                            type="button"
                        >
                            CC
                        </button>
                    )}

                    {/* Fullscreen */}
                    <button onClick={toggleFullscreen} className="text-white/80 hover:text-white p-1" type="button">
                        {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            {/* Menu portal */}
            {/* Clipboard toast (inline fullscreen only) */}
            {clipboardToast && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/80 text-white text-sm rounded-lg z-50">
                    {clipboardToast}
                </div>
            )}

            {showMenu && createPortal(
                <div
                    ref={menuPortalRef}
                    style={menuStyle}
                    className="flex flex-col bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px] w-max whitespace-nowrap z-[9999]"
                >
                    {/* Loop toggle */}
                    <button
                        onClick={() => { setLoop(l => !l); setShowMenu(false); }}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        type="button"
                    >
                        <Repeat className={cn("w-4 h-4", loop && "text-blue-500")} />
                        {t('videoPlayer.loop')}
                        {loop && <span className="ml-auto text-xs text-blue-500">{t('common.on')}</span>}
                    </button>

                    <div className="border-t border-gray-200 my-1" />

                    {/* Playback speed */}
                    <div className="px-4 py-1 text-xs text-gray-400">{t('voicePlayer.speed')}</div>
                    {[0.5, 1, 1.5, 2].map(rate => (
                        <button
                            key={rate}
                            onClick={() => handleMenuPlaybackRate(rate)}
                            className="w-full px-4 py-1.5 text-left text-sm hover:bg-gray-100"
                            style={{ color: playbackRate === rate ? '#3b82f6' : '#374151', fontWeight: playbackRate === rate ? 500 : 400 }}
                            type="button"
                        >
                            {rate}x
                        </button>
                    ))}

                    {/* Download (golden finger only) */}
                    {goldenFingerActive && (
                        <>
                            <div className="border-t border-gray-200 my-1" />
                            <button
                                onClick={handleMenuDownload}
                                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                type="button"
                            >
                                <Download className="w-4 h-4" />
                                {t('common.download')}
                            </button>
                        </>
                    )}
                </div>,
                isFullscreen && containerRef.current ? containerRef.current : document.body
            )}
        </div>
    );
};
