import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Download } from 'lucide-react';
import { cn, formatDownloadFilename } from '../../utils/classnames';
import { downloadMedia } from '../../utils/download';
import { useAmplifiedVolume } from './useAmplifiedVolume';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';

const VOLUME_STORAGE_KEY = 'zakadesk_video_amp';

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
}) => {
    const { t } = useTranslation();
    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [playbackRate, setPlaybackRate] = useState(1);

    const { volume, setVolume, isMuted, toggleMute, connectElement } = useAmplifiedVolume(VOLUME_STORAGE_KEY);

    // Connect video to amplification pipeline
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => setCurrentTime(video.currentTime);
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

    const cyclePlaybackRate = useCallback(() => {
        const rates = [1, 1.5, 2, 0.5];
        const idx = rates.indexOf(playbackRate);
        setPlaybackRate(rates[(idx + 1) % rates.length]);
    }, [playbackRate]);

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
                loop
            />

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

                    {/* Speed */}
                    <button
                        onClick={cyclePlaybackRate}
                        className="text-white/80 hover:text-white text-xs px-1.5 py-0.5 rounded border border-white/30 hover:border-white/50 transition-colors"
                        type="button"
                        title={t('voicePlayer.speed')}
                    >
                        {playbackRate}x
                    </button>

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

                    {/* Download */}
                    {goldenFingerActive && (
                        <button onClick={handleDownload} className="text-white/80 hover:text-white p-1" type="button">
                            <Download className="w-4 h-4" />
                        </button>
                    )}

                    {/* Fullscreen */}
                    <button onClick={toggleFullscreen} className="text-white/80 hover:text-white p-1" type="button">
                        {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                    </button>
                </div>
            </div>
        </div>
    );
};
