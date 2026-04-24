import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Volume2, VolumeX, Play, Pause, MoreVertical, Download, RotateCcw, RotateCw } from 'lucide-react';
import { cn, formatDownloadFilename } from '../../utils/classnames';
import { downloadMedia } from '../../utils/download';
import { useAmplifiedVolume } from './useAmplifiedVolume';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { useTranscription } from '../../hooks/useTranscription';
import { TranscriptPanel } from './TranscriptPanel';
import { TranscribeButton } from './TranscribeButton';

const VOLUME_STORAGE_KEY = 'sakadesk_voice_amp';

interface VoicePlayerProps {
    src: string;
    /**
     * Single source of truth for how this voice message is displayed.
     *  - `compact`    — chat bubble (default).
     *  - `premium`    — standalone premium card, no transcription.
     *  - `gallery`    — premium card anchored at the bottom of the media
     *                   gallery voice tab; internal transcription above
     *                   with a translucent backdrop so it stays readable
     *                   over the blurred player bar.
     *  - `fullscreen` — premium card inside MediaViewerModal; internal
     *                   transcription below.
     *
     * `gallery` and `fullscreen` own their transcription: pass
     * `messageId`, `service`, `memberPath` and the component will wire
     * `useTranscription` + playerTime/seek internally. Callers don't need
     * to render `TranscribeButton` / `TranscriptPanel` separately.
     */
    variant?: 'compact' | 'premium' | 'gallery' | 'fullscreen';
    /** Avatar URL for premium-family variants */
    avatarUrl?: string;
    /** Member name for premium-family variants */
    memberName?: string;
    /** Timestamp display string for premium-family variants */
    timestamp?: string;
    /** Duration string for premium-family variants */
    durationText?: string;
    /** Theme accent color for buttons and progress bar */
    accentColor?: string;
    /** Raw ISO timestamp of the message, used for download filename prefix */
    messageTimestamp?: string;
    /** Auto-start playing when component mounts */
    autoPlay?: boolean;
    /** Enable keyboard shortcuts at window level (skip focus check). Only for viewer/modal, not chat bubbles. */
    viewerMode?: boolean;
    /** Called on each time update with current playback time in seconds */
    onTimeUpdate?: (time: number) => void;
    /** Called externally to seek to a specific time */
    seekTo?: number;
    /**
     * When provided, the timestamp label becomes a clickable link that calls
     * this handler. Used in the media gallery to jump back to the owning
     * chat message.
     */
    onTimestampClick?: () => void;
    /** Message id — required for the gallery/fullscreen variants to fetch transcription */
    messageId?: number;
    /** Service id — required for the gallery/fullscreen variants to fetch transcription */
    service?: string;
    /** Member dir path — required for the gallery/fullscreen variants to fetch transcription */
    memberPath?: string;
}

/**
 * Skip button with circular arrow and "5" inside
 */
const SkipButton: React.FC<{
    direction: 'back' | 'forward';
    onClick: () => void;
    disabled?: boolean;
    title?: string;
}> = ({ direction, onClick, disabled, title }) => {
    const Icon = direction === 'back' ? RotateCcw : RotateCw;

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "relative w-10 h-10 flex items-center justify-center rounded-full transition-colors",
                "hover:bg-gray-100 active:bg-gray-200",
                disabled && "opacity-50 cursor-not-allowed"
            )}
            title={title}
        >
            <Icon className="w-6 h-6 text-gray-600" strokeWidth={2} />
            {/* Number "5" inside the circle */}
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-gray-600 mt-0.5">
                5
            </span>
        </button>
    );
};

// Fallback to Hinatazaka's voice player accent (#6da0d4) when no theme color provided.
// Canonical values defined in serviceThemes.ts -> messages.voicePlayerAccent
const DEFAULT_ACCENT_COLOR = '#6da0d4';

export const VoicePlayer: React.FC<VoicePlayerProps> = ({
    src,
    variant = 'compact',
    avatarUrl,
    memberName,
    timestamp,
    durationText,
    accentColor = DEFAULT_ACCENT_COLOR,
    messageTimestamp,
    autoPlay,
    viewerMode,
    onTimeUpdate,
    seekTo,
    onTimestampClick,
    messageId,
    service,
    memberPath,
}) => {
    const { t } = useTranslation();
    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);
    const audioRef = useRef<HTMLAudioElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const menuPortalRef = useRef<HTMLDivElement>(null);
    const volumeHideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Internal transcription wiring for gallery/fullscreen variants.
    // `useTranscription` tolerates undefined ids; it just returns idle state.
    const ownsTranscription = (variant === 'gallery' || variant === 'fullscreen')
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
    // Detect fresh loading→done to auto-expand the transcript once per run.
    const prevTranscriptionState = useRef(transcriptionState);
    const transcriptionJustCompleted =
        prevTranscriptionState.current === 'loading' && transcriptionState === 'done';
    useEffect(() => { prevTranscriptionState.current = transcriptionState; }, [transcriptionState]);
    // External seek bridge for the internal TranscriptPanel (click-to-seek).
    const [internalSeek, setInternalSeek] = useState<number | undefined>(undefined);
    const effectiveSeekTo = seekTo ?? internalSeek;

    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const { volume, setVolume, isMuted: isVolumeMuted, toggleMute: handleMuteToggle, connectElement } = useAmplifiedVolume(VOLUME_STORAGE_KEY);
    const [showVolume, setShowVolume] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
    const [playbackRate, setPlaybackRate] = useState(1);

    // For smooth progress animation
    const [animatedProgress, setAnimatedProgress] = useState(0);
    const lastUpdateRef = useRef<number>(Date.now());

    // Setup audio event listeners and connect to amplification pipeline
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const handleTimeUpdate = () => {
            setCurrentTime(audio.currentTime);
            onTimeUpdate?.(audio.currentTime);
        };
        const handleLoadedMetadata = () => setDuration(audio.duration);
        const handleEnded = () => setIsPlaying(false);
        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);

        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('loadedmetadata', handleLoadedMetadata);
        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('play', handlePlay);
        audio.addEventListener('pause', handlePause);

        // Connect to Web Audio API for amplification (volume controlled via GainNode)
        connectElement(audio);
        audio.playbackRate = playbackRate;

        return () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('play', handlePlay);
            audio.removeEventListener('pause', handlePause);
            if (volumeHideTimeout.current) {
                clearTimeout(volumeHideTimeout.current);
            }
        };
    }, [connectElement]);

    // Auto-play on mount if requested
    useEffect(() => {
        if (autoPlay && audioRef.current) {
            audioRef.current.play().catch(() => {});
        }
    }, [autoPlay]);

    // Sync playback rate to audio element
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.playbackRate = playbackRate;
        }
    }, [playbackRate]);

    // External / internal seek request
    useEffect(() => {
        if (effectiveSeekTo != null && audioRef.current) {
            audioRef.current.currentTime = effectiveSeekTo;
            setCurrentTime(effectiveSeekTo);
        }
    }, [effectiveSeekTo]);

    // Smooth progress animation
    useEffect(() => {
        if (!isPlaying || duration <= 0) {
            setAnimatedProgress((currentTime / duration) * 100 || 0);
            return;
        }

        const targetProgress = (currentTime / duration) * 100;
        setAnimatedProgress(targetProgress);
        lastUpdateRef.current = Date.now();

        let animationId: number;
        const animate = () => {
            if (!isPlaying) return;

            const elapsed = (Date.now() - lastUpdateRef.current) / 1000;
            const estimatedProgress = targetProgress + (elapsed / duration) * 100 * playbackRate;

            if (estimatedProgress <= 100) {
                setAnimatedProgress(Math.min(estimatedProgress, 100));
            }

            animationId = requestAnimationFrame(animate);
        };

        animationId = requestAnimationFrame(animate);

        return () => {
            if (animationId) cancelAnimationFrame(animationId);
        };
    }, [currentTime, duration, isPlaying, playbackRate]);

    const togglePlay = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;

        if (audio.paused) {
            audio.play();
        } else {
            audio.pause();
        }
    }, []);

    const handleSkipBack = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.currentTime = Math.max(0, audio.currentTime - 5);
    }, []);

    const handleSkipForward = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
    }, []);

    // handleMuteToggle provided by useAmplifiedVolume hook

    // Keyboard shortcuts - must be after handler definitions
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // In viewer mode: listen globally (no focus check), skip Left/Right (reserved for modal nav)
            // In normal mode: only when container is focused
            if (!viewerMode) {
                const isFocused = containerRef.current?.contains(document.activeElement);
                if (!isFocused) return;

                const target = e.target as HTMLElement;
                if (target.tagName === 'BUTTON' || target.tagName === 'INPUT') return;
            }

            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'ArrowLeft':
                    if (!viewerMode) {
                        e.preventDefault();
                        handleSkipBack();
                    }
                    break;
                case 'ArrowRight':
                    if (!viewerMode) {
                        e.preventDefault();
                        handleSkipForward();
                    }
                    break;
                case 'ArrowUp':
                    if (viewerMode) {
                        e.preventDefault();
                        setVolume(Math.min(volume + 0.05, 1));
                    }
                    break;
                case 'ArrowDown':
                    if (viewerMode) {
                        e.preventDefault();
                        setVolume(Math.max(volume - 0.05, 0));
                    }
                    break;
                case 'm':
                case 'M':
                    e.preventDefault();
                    handleMuteToggle();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [viewerMode, togglePlay, handleSkipBack, handleSkipForward, handleMuteToggle, volume, setVolume]);

    // Close menu on click outside or Escape key
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

    const handleVolumeMouseEnter = useCallback(() => {
        if (volumeHideTimeout.current) {
            clearTimeout(volumeHideTimeout.current);
            volumeHideTimeout.current = null;
        }
        setShowVolume(true);
        setShowMenu(false);
    }, []);

    const handleVolumeMouseLeave = useCallback(() => {
        volumeHideTimeout.current = setTimeout(() => {
            setShowVolume(false);
        }, 300);
    }, []);

    const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newTime = parseFloat(e.target.value);
        if (audioRef.current) {
            audioRef.current.currentTime = newTime;
        }
        setCurrentTime(newTime);
        setAnimatedProgress((newTime / duration) * 100);
        lastUpdateRef.current = Date.now();
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setVolume(parseFloat(e.target.value));
    };

    const handleDownload = () => {
        downloadMedia(src, formatDownloadFilename(src, messageTimestamp));
        setShowMenu(false);
    };

    const handlePlaybackRateChange = (rate: number) => {
        setPlaybackRate(rate);
        setShowMenu(false);
    };

    const formatTime = (time: number) => {
        if (!isFinite(time) || isNaN(time)) return '--:--';
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const isMuted = isVolumeMuted || volume === 0;

    const handleMenuToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setShowMenu(prev => {
            if (!prev && menuButtonRef.current) {
                // Calculate position synchronously before render to avoid layout flash
                const rect = menuButtonRef.current.getBoundingClientRect();
                setMenuStyle({
                    position: 'fixed' as const,
                    bottom: `${window.innerHeight - rect.top + 8}px`,
                    right: `${window.innerWidth - rect.right}px`,
                });
            }
            return !prev;
        });
        setShowVolume(false);
    }, []);

    // Premium-family variants share the same glassmorphism card. `gallery`
    // and `fullscreen` wrap it with internal transcription UI (above/below).
    if (variant === 'premium' || variant === 'gallery' || variant === 'fullscreen') {
        const premiumCard = (
            <div
                ref={containerRef}
                tabIndex={0}
                className="backdrop-blur-xl bg-white/90 rounded-2xl p-3 outline-none focus:ring-2 shadow-lg"
                style={{
                    '--tw-ring-color': `${accentColor}80`,
                    borderWidth: '1px',
                    borderColor: `${accentColor}33`,
                } as React.CSSProperties}
            >
                {/* Hidden audio element */}
                <audio ref={audioRef} src={src} preload="metadata" />

                {/* Row 1: Avatar + Info + Menu */}
                <div className="flex items-center gap-3 mb-2">
                    {/* Avatar with accent ring */}
                    <div
                        className="w-10 h-10 rounded-full p-0.5 shrink-0"
                        style={{ background: `linear-gradient(to bottom right, ${accentColor}, ${accentColor}cc)` }}
                    >
                        <div className="w-full h-full rounded-full overflow-hidden bg-white">
                            {avatarUrl ? (
                                <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm font-medium bg-gray-100">
                                    {memberName?.charAt(0) || '?'}
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Name and timestamp */}
                    <div className="flex-1 min-w-0">
                        {memberName && (
                            <p className="text-sm font-semibold text-gray-800 truncate">{memberName}</p>
                        )}
                        {(timestamp || durationText) && (
                            <p className="text-xs text-gray-500">
                                {timestamp && (
                                    onTimestampClick ? (
                                        <button
                                            type="button"
                                            onClick={onTimestampClick}
                                            className="hover:text-gray-700 underline underline-offset-2 decoration-gray-300 hover:decoration-gray-500 transition-colors"
                                        >
                                            {timestamp}
                                        </button>
                                    ) : (
                                        <span>{timestamp}</span>
                                    )
                                )}
                                {timestamp && durationText && <span className="mx-1 text-gray-300">•</span>}
                                {durationText}
                            </p>
                        )}
                    </div>
                    {/* Options menu trigger */}
                    <button
                        ref={menuButtonRef}
                        onClick={handleMenuToggle}
                        className="p-1.5 hover:bg-white/50 rounded-full transition-colors"
                        type="button"
                    >
                        <MoreVertical className="w-4 h-4 text-gray-500" />
                    </button>
                </div>

                {/* Row 2: Progress Bar */}
                <div className="mb-2">
                    <div className="relative h-1 bg-gray-200/60 rounded-full overflow-hidden">
                        <div
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{ width: `${animatedProgress}%`, backgroundColor: accentColor }}
                        />
                        <input
                            type="range"
                            min={0}
                            max={duration || 100}
                            value={currentTime}
                            onChange={handleProgressChange}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                    </div>
                    <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-gray-500">{formatTime(currentTime)}</span>
                        <span className="text-[10px] text-gray-500">{formatTime(duration)}</span>
                    </div>
                </div>

                {/* Row 3: Controls - Volume (left) | Skip | Play | Skip | (right space) */}
                <div className="flex items-center">
                    {/* Left: Volume */}
                    <div className="flex-1 flex items-center">
                        <div
                            className="relative flex items-center"
                            onMouseEnter={handleVolumeMouseEnter}
                            onMouseLeave={handleVolumeMouseLeave}
                        >
                            <button
                                onClick={handleMuteToggle}
                                className="p-1 hover:bg-white/50 rounded-full transition-colors"
                                title={isMuted ? t('voicePlayer.unmute') : t('voicePlayer.mute')}
                                type="button"
                            >
                                {isMuted ? (
                                    <VolumeX className="w-4 h-4 text-gray-500" />
                                ) : (
                                    <Volume2 className="w-4 h-4 text-gray-500" />
                                )}
                            </button>
                            <div
                                className={cn(
                                    "flex items-center overflow-hidden transition-all duration-200 ease-out",
                                    showVolume ? "w-16 ml-1 opacity-100" : "w-0 ml-0 opacity-0"
                                )}
                                onMouseEnter={handleVolumeMouseEnter}
                                onMouseLeave={handleVolumeMouseLeave}
                            >
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={volume}
                                    onChange={handleVolumeChange}
                                    className="w-full h-1 rounded-full appearance-none cursor-pointer"
                                    style={{
                                        accentColor: accentColor,
                                        background: `linear-gradient(to right, ${accentColor} ${volume * 100}%, #d1d5db ${volume * 100}%)`
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Center: Skip + Play + Skip */}
                    <div className="flex items-center gap-2">
                        <SkipButton
                            direction="back"
                            onClick={handleSkipBack}
                            disabled={currentTime === 0}
                            title={t('voicePlayer.skipBack')}
                        />

                        <button
                            onClick={togglePlay}
                            className="w-12 h-12 rounded-full shadow-lg flex items-center justify-center hover:shadow-xl hover:scale-105 transition-all hover:brightness-90"
                            style={{ backgroundColor: accentColor }}
                            type="button"
                        >
                            {isPlaying ? (
                                <Pause className="w-6 h-6 text-white fill-current" />
                            ) : (
                                <Play className="w-6 h-6 text-white fill-current ml-0.5" />
                            )}
                        </button>

                        <SkipButton
                            direction="forward"
                            onClick={handleSkipForward}
                            disabled={duration === 0}
                            title={t('voicePlayer.skipForward')}
                        />
                    </div>

                    {/* Right: Balance space */}
                    <div className="flex-1" />
                </div>

                {/* Menu portal */}
                {showMenu && createPortal(
                    <div
                        ref={menuPortalRef}
                        style={menuStyle}
                        className="flex flex-col bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px] w-max whitespace-nowrap z-[9999]"
                    >
                        {goldenFingerActive && (
                            <>
                                <button
                                    onClick={handleDownload}
                                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100/80 flex items-center gap-2"
                                    type="button"
                                >
                                    <Download className="w-4 h-4" />
                                    {t('common.download')}
                                </button>
                                <div className="border-t border-gray-200 my-1" />
                            </>
                        )}
                        <div className="px-4 py-1 text-xs text-gray-400">{t('voicePlayer.speed')}</div>
                        {[0.5, 1, 1.5, 2].map(rate => (
                            <button
                                key={rate}
                                onClick={() => handlePlaybackRateChange(rate)}
                                className="w-full px-4 py-1.5 text-left text-sm hover:bg-gray-100/80"
                                style={{
                                    color: playbackRate === rate ? accentColor : '#374151',
                                    fontWeight: playbackRate === rate ? 500 : 400,
                                }}
                                type="button"
                            >
                                {rate}x
                            </button>
                        ))}
                    </div>,
                    document.body
                )}
            </div>
        );

        if (variant === 'premium') return premiumCard;

        // gallery / fullscreen: render internal transcription UI when caller
        // supplied messageId+service+memberPath. Otherwise fall back to the
        // bare card so the component still works for simple viewer usage.
        const panelTheme = variant === 'gallery' ? 'dark' : 'light';
        const transcriptBlock = ownsTranscription ? (
            transcriptionState === 'done' && transcription ? (
                <TranscriptPanel
                    key={messageId}
                    segments={transcription.segments}
                    currentTime={currentTime}
                    onSeek={setInternalSeek}
                    onRerun={retriggerTranscription}
                    accentColor={accentColor}
                    variant={panelTheme}
                    defaultExpanded={variant === 'fullscreen' || transcriptionJustCompleted || !!transcription}
                    withBackdrop={variant === 'gallery'}
                />
            ) : (
                <TranscribeButton
                    state={transcriptionState}
                    onClick={triggerTranscription}
                    error={transcriptionError}
                    accentColor={accentColor}
                    variant={panelTheme}
                />
            )
        ) : null;

        if (variant === 'gallery') {
            return (
                <>
                    {transcriptBlock && <div className="mb-2">{transcriptBlock}</div>}
                    {premiumCard}
                </>
            );
        }
        // fullscreen
        return (
            <>
                {premiumCard}
                {transcriptBlock && <div className="mt-3">{transcriptBlock}</div>}
            </>
        );
    }

    // Compact variant - Original bubble style (default)
    return (
        <div
            ref={containerRef}
            tabIndex={0}
            className="bg-[#F3F4F6] rounded-2xl p-3 min-w-[300px] outline-none focus:ring-2"
            style={{ '--ring-color': `${accentColor}80` } as React.CSSProperties}
        >
            {/* Hidden audio element */}
            <audio ref={audioRef} src={src} preload="metadata" />

            {/* Row 1: Progress Slider with smooth animation */}
            <div className="mb-3">
                <div className="relative h-1 bg-gray-300 rounded-full overflow-hidden">
                    <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${animatedProgress}%`, backgroundColor: accentColor }}
                    />
                    <input
                        type="range"
                        min={0}
                        max={duration || 100}
                        value={currentTime}
                        onChange={handleProgressChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                </div>
            </div>

            {/* Row 2: Controls - Volume (left) | Play (center) | Time (right) */}
            <div className="flex items-center">
                {/* Left: Volume control with inline slider */}
                <div className="flex-1 flex items-center">
                    <div
                        className="relative flex items-center"
                        onMouseEnter={handleVolumeMouseEnter}
                        onMouseLeave={handleVolumeMouseLeave}
                    >
                        <button
                            onClick={handleMuteToggle}
                            className="p-1.5 hover:bg-gray-200 rounded-full transition-colors"
                            title={isMuted ? t('voicePlayer.unmute') : t('voicePlayer.mute')}
                            type="button"
                        >
                            {isMuted ? (
                                <VolumeX className="w-4 h-4 text-gray-500" />
                            ) : (
                                <Volume2 className="w-4 h-4 text-gray-500" />
                            )}
                        </button>
                        <div
                            className={cn(
                                "flex items-center overflow-hidden transition-all duration-200 ease-out",
                                showVolume ? "w-20 ml-1 opacity-100" : "w-0 ml-0 opacity-0"
                            )}
                            onMouseEnter={handleVolumeMouseEnter}
                            onMouseLeave={handleVolumeMouseLeave}
                        >
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={volume}
                                onChange={handleVolumeChange}
                                className="w-full h-1 rounded-full appearance-none cursor-pointer"
                                style={{
                                    accentColor: accentColor,
                                    background: `linear-gradient(to right, ${accentColor} ${volume * 100}%, #d1d5db ${volume * 100}%)`
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* Center: Play Button */}
                <button
                    onClick={togglePlay}
                    className="w-10 h-10 rounded-full shadow-md flex items-center justify-center transition-colors shrink-0 hover:brightness-90"
                    style={{ backgroundColor: accentColor }}
                    type="button"
                >
                    {isPlaying ? (
                        <Pause className="w-5 h-5 text-white fill-current" />
                    ) : (
                        <Play className="w-5 h-5 text-white fill-current ml-0.5" />
                    )}
                </button>

                {/* Right: Time display + Options */}
                <div className="flex-1 flex items-center justify-end gap-1">
                    <div className="text-xs text-gray-500 whitespace-nowrap">
                        {formatTime(currentTime)} / {formatTime(duration)}
                    </div>
                    <button
                        ref={menuButtonRef}
                        onClick={handleMenuToggle}
                        className="p-1.5 hover:bg-gray-200 rounded-full transition-colors"
                        type="button"
                    >
                        <MoreVertical className="w-4 h-4 text-gray-500" />
                    </button>
                </div>
            </div>

            {/* Menu portal */}
            {showMenu && createPortal(
                <div
                    ref={menuPortalRef}
                    style={menuStyle}
                    className="flex flex-col bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px] w-max whitespace-nowrap z-[9999]"
                >
                    {goldenFingerActive && (
                        <>
                            <button
                                onClick={handleDownload}
                                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                type="button"
                            >
                                <Download className="w-4 h-4" />
                                {t('common.download')}
                            </button>
                            <div className="border-t border-gray-200 my-1" />
                        </>
                    )}
                    <div className="px-4 py-1 text-xs text-gray-400">{t('voicePlayer.speed')}</div>
                    {[0.5, 1, 1.5, 2].map(rate => (
                        <button
                            key={rate}
                            onClick={() => handlePlaybackRateChange(rate)}
                            className="w-full px-4 py-1.5 text-left text-sm hover:bg-gray-100"
                            style={{ color: playbackRate === rate ? accentColor : '#374151', fontWeight: playbackRate === rate ? 500 : 400 }}
                            type="button"
                        >
                            {rate}x
                        </button>
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
};
