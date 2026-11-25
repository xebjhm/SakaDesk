import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button, Spinner, Menu, MenuItem, MenuLabel, MenuSeparator } from '../../design/primitives';
import { Volume2, VolumeX, Play, Pause, MoreVertical, Download, RotateCcw, RotateCw } from 'lucide-react';
import { cn, formatDownloadFilename } from '../../utils/classnames';
import { downloadMedia } from '../../utils/download';
import { useAmplifiedVolume } from './useAmplifiedVolume';
import { useMediaDuration, useMediaSource } from './mediaElement';
import { useMediaPlayback } from './useMediaPlayback';
import { clientLog } from '../../utils/clientLog';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { useTranscription } from '../../hooks/useTranscription';
import { useJustBecame } from '../../hooks/useJustBecame';
import { TranscriptPanel } from './TranscriptPanel';
import { TranscribeButton } from './TranscribeButton';
import { ACCENT, withAlpha } from '../../design/colorMix';

export const VOLUME_STORAGE_KEY = 'sakadesk_voice_amp';

interface VoicePlayerProps {
    src: string;
    /**
     * Single source of truth for how this voice message is displayed.
     *  - `compact`    — chat bubble (default).
     *  - `premium`    — standalone premium card, no transcription.
     *  - `gallery`    — premium card anchored at the bottom of the media
     *                   gallery voice tab; internal transcription above
     *                   on an opaque sheet surface so it stays readable
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
    /**
     * `compact` only: the bubble this player sits in has a footer attached below it, so the
     * player squares its bottom corners (top corners keep the radius) and bubble, player and
     * footer read as one shape.
     */
    joinedBelow?: boolean;
    /**
     * The bubble starts a run and keeps its small top-left tail corner; the player
     * takes the same corner so no sliver of the bubble fill shows behind it.
     */
    tailCorner?: boolean;
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
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "relative w-10 h-10 flex items-center justify-center rounded-full transition-colors",
                "hover:bg-sunken active:brightness-94",
                disabled && "opacity-50 cursor-not-allowed"
            )}
            title={title}
            aria-label={title}
        >
            <Icon aria-hidden="true" className="w-6 h-6 text-secondary" strokeWidth={2} />
            {/* Number "5" inside the circle */}
            <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-secondary mt-0.5">
                5
            </span>
        </button>
    );
};

const DEFAULT_ACCENT_COLOR = ACCENT; // the context's accent (group in a chat, ink in a brand scope)

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
    joinedBelow,
    tailCorner,
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
    const volumeHideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Keyboard focus is inside the volume control (set only for :focus-visible focus).
    const keyboardVolumeFocusRef = useRef(false);
    // Breadcrumbs for the keyboard decisions are logged once per player instance.
    const loggedVolumeRef = useRef(false);
    const loggedSpaceRef = useRef(false);

    // Only gallery/fullscreen own transcription; callers must supply all
    // three ids or none.
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
    const transcriptionJustCompleted = useJustBecame(transcriptionState, 'done', 'loading');
    // Bridge click-to-seek from the internal TranscriptPanel into the audio element.
    // Internal seek carries a bumping `seq` so clicking the SAME transcript line
    // twice still re-fires the seek effect (a bare time value would be deduped by
    // React's state bail-out and the second click would be a silent no-op).
    const [internalSeek, setInternalSeek] = useState<{ time: number; seq: number } | undefined>(undefined);
    const seekSeqRef = useRef(0);
    const handleTranscriptSeek = useCallback((time: number) => {
        seekSeqRef.current += 1;
        setInternalSeek({ time, seq: seekSeqRef.current });
    }, []);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const { volume, setVolume, isMuted: isVolumeMuted, toggleMute: handleMuteToggle, connectElement, prepareForPlayback } = useAmplifiedVolume(VOLUME_STORAGE_KEY);
    const { status: playbackStatus, play, retry } = useMediaPlayback(audioRef, 'voice', src, variant);
    const isBuffering = playbackStatus === 'buffering';
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
        const handleEnded = () => setIsPlaying(false);
        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);

        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('play', handlePlay);
        audio.addEventListener('pause', handlePause);

        // Connect to Web Audio API for amplification (volume controlled via GainNode)
        connectElement(audio);
        audio.playbackRate = playbackRate;

        return () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('play', handlePlay);
            audio.removeEventListener('pause', handlePause);
            if (volumeHideTimeout.current) {
                clearTimeout(volumeHideTimeout.current);
            }
        };
    }, [connectElement, variant]);

    // The source is bound imperatively so the element is released (pause, drop
    // src, load) before the source changes and on unmount (matches VideoPlayer).
    // `variant` renders a different <audio> element, so it rebinds the source too.
    useMediaSource(audioRef, src, variant);
    const duration = useMediaDuration(audioRef, src, variant);

    // Build the amplification graph (first play) before starting playback.
    const startPlayback = useCallback(() => {
        prepareForPlayback();
        play();
    }, [prepareForPlayback, play]);

    const handleRetry = useCallback(() => {
        prepareForPlayback();
        retry();
    }, [prepareForPlayback, retry]);

    // Auto-play on mount / when the source changes (matches VideoPlayer) so navigating
    // voice→voice in the gallery auto-plays the next clip.
    useEffect(() => {
        if (autoPlay && audioRef.current) {
            startPlayback();
        }
    }, [autoPlay, src, startPlayback]);

    // Sync playback rate to audio element
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.playbackRate = playbackRate;
        }
    }, [playbackRate]);

    // External seek request (parent-controlled position, e.g. subtitle sync)
    useEffect(() => {
        if (seekTo != null && audioRef.current) {
            audioRef.current.currentTime = seekTo;
            setCurrentTime(seekTo);
        }
    }, [seekTo]);

    // Internal seek request from transcript clicks (seq-keyed so repeat clicks re-fire)
    useEffect(() => {
        if (internalSeek && audioRef.current) {
            audioRef.current.currentTime = internalSeek.time;
            setCurrentTime(internalSeek.time);
        }
    }, [internalSeek]);

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
            startPlayback();
        } else {
            audio.pause();
        }
    }, [startPlayback]);

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

    // Player shortcuts. Viewer mode: window-wide (the viewer has no focusable player box), except in a
    // field or menu, and Space on a focused button keeps that button's action. Inline bubbles: on their
    // own box only (one window listener per voice bubble before).
    const handleShortcut = useCallback((e: KeyboardEvent | React.KeyboardEvent): void => {
        if (e.defaultPrevented) return;
        const el = e.target instanceof HTMLElement ? e.target : null;
        if (el?.closest('[role="menu"], input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
        // Space on a focused button keeps that button's action; logged once per player.
        const leaveSpaceToButton = (): void => {
            if (loggedSpaceRef.current) return;
            loggedSpaceRef.current = true;
            clientLog('media_playback', { surface: 'voice', phase: 'shortcut', outcome: 'space_left_to_button' });
        };
        if (!viewerMode && el?.tagName === 'BUTTON') {
            if (e.key === ' ') leaveSpaceToButton();
            return;
        }
        switch (e.key) {
            case ' ':
                if (el?.closest('button')) {
                    leaveSpaceToButton();
                    return;
                }
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
    }, [viewerMode, togglePlay, handleSkipBack, handleSkipForward, handleMuteToggle, volume, setVolume]);

    useEffect(() => {
        if (!viewerMode) return;
        const onKey = (e: KeyboardEvent) => handleShortcut(e);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [viewerMode, handleShortcut]);

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

    // Keyboard focus in the volume control holds the slider open (it is hover-only otherwise).
    // Mouse focus changes nothing: only focus that matched :focus-visible is tracked and released.
    const handleVolumeFocus = useCallback((e: React.FocusEvent) => {
        if (!(e.target instanceof Element) || !e.target.matches(':focus-visible')) return;
        keyboardVolumeFocusRef.current = true;
        if (!loggedVolumeRef.current) {
            loggedVolumeRef.current = true;
            clientLog('media_playback', { surface: 'voice', phase: 'volume', outcome: 'opened_by_focus' });
        }
        handleVolumeMouseEnter();
    }, [handleVolumeMouseEnter]);

    const handleVolumeBlur = useCallback(() => {
        if (!keyboardVolumeFocusRef.current) return;
        keyboardVolumeFocusRef.current = false;
        handleVolumeMouseLeave();
    }, [handleVolumeMouseLeave]);

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

    // Playback error: neutral message with a Retry that reloads the element.
    const errorRow = playbackStatus === 'error' ? (
        <div role="alert" className="mt-2 flex items-center justify-between gap-2">
            <span className="text-caption text-secondary">{t('voicePlayer.playbackError')}</span>
            <Button variant="ghost" size="sm" onClick={handleRetry}>
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                {t('common.retry')}
            </Button>
        </div>
    ) : null;

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

    // Premium-family variants share the same opaque sheet card. `gallery`
    // and `fullscreen` wrap it with internal transcription UI (above/below).
    if (variant === 'premium' || variant === 'gallery' || variant === 'fullscreen') {
        const premiumCard = (
            <div
                ref={containerRef}
                tabIndex={0}
                onKeyDown={viewerMode ? undefined : handleShortcut}
                className="bg-sheet rounded-lg p-3 outline-none focus:ring-2 shadow-card"
                style={{
                    '--tw-ring-color': withAlpha(accentColor, 50),
                    borderWidth: '1px',
                    borderColor: withAlpha(accentColor, 20),
                } as React.CSSProperties}
            >
                {/* Hidden audio element */}
                <audio ref={audioRef} preload="metadata" />

                {/* Row 1: Avatar + Info + Menu */}
                <div className="flex items-center gap-3 mb-2">
                    {/* Avatar with accent ring */}
                    <div
                        className="w-10 h-10 rounded-full p-0.5 shrink-0"
                        style={{ background: `linear-gradient(to bottom right, ${accentColor}, ${withAlpha(accentColor, 80)})` }}
                    >
                        <div className="w-full h-full rounded-full overflow-hidden bg-sheet">
                            {avatarUrl ? (
                                <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted text-sm font-medium bg-sunken">
                                    {memberName?.charAt(0) || '?'}
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Name and timestamp */}
                    <div className="flex-1 min-w-0">
                        {memberName && (
                            <p lang="ja" className="text-sm font-semibold text-primary truncate">{memberName}</p>
                        )}
                        {(timestamp || durationText) && (
                            <p className="text-xs text-secondary">
                                {timestamp && (
                                    onTimestampClick ? (
                                        <button
                                            type="button"
                                            onClick={onTimestampClick}
                                            className="underline decoration-current underline-offset-2 transition-colors hover:text-primary"
                                        >
                                            {timestamp}
                                        </button>
                                    ) : (
                                        <span>{timestamp}</span>
                                    )
                                )}
                                {timestamp && durationText && <span className="mx-1 text-muted">•</span>}
                                {durationText}
                            </p>
                        )}
                    </div>
                    {/* Options menu trigger */}
                    <button
                        ref={menuButtonRef}
                        onClick={handleMenuToggle}
                        aria-label={t('common.moreOptions')}
                        aria-haspopup="menu"
                        aria-expanded={showMenu}
                        className="p-1.5 hover:bg-sunken rounded-full transition-colors"
                        type="button"
                    >
                        <MoreVertical className="w-4 h-4 text-secondary" />
                    </button>
                </div>

                {/* Row 2: Progress Bar */}
                <div className="mb-2">
                    <div className="relative h-1 bg-sunken rounded-full overflow-hidden ring-offset-0 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent">
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
                            aria-label={t('media.seek')}
                            aria-valuetext={t('media.timeOf', { current: formatTime(currentTime), total: formatTime(duration) })}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                    </div>
                    <div className="flex justify-between mt-1">
                        <span className="text-caption text-secondary">{formatTime(currentTime)}</span>
                        <span className="text-caption text-secondary">{formatTime(duration)}</span>
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
                            onFocusCapture={handleVolumeFocus}
                            onBlurCapture={handleVolumeBlur}
                        >
                            <button
                                onClick={handleMuteToggle}
                                className="p-1 hover:bg-sunken rounded-full transition-colors"
                                title={isMuted ? t('voicePlayer.unmute') : t('voicePlayer.mute')}
                                aria-label={isMuted ? t('voicePlayer.unmute') : t('voicePlayer.mute')}
                                type="button"
                            >
                                {isMuted ? (
                                    <VolumeX aria-hidden="true" className="w-4 h-4 text-secondary" />
                                ) : (
                                    <Volume2 aria-hidden="true" className="w-4 h-4 text-secondary" />
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
                                    aria-label={t('media.volume')}
                                    aria-valuetext={t('media.volumeValue', { percent: Math.round(volume * 100) })}
                                    className="w-full h-1 rounded-full appearance-none cursor-pointer"
                                    style={{
                                        accentColor: accentColor,
                                        background: `linear-gradient(to right, ${accentColor} ${volume * 100}%, var(--ds-border-strong) ${volume * 100}%)`
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
                            className="w-12 h-12 rounded-full shadow-card flex items-center justify-center hover:shadow-sheet hover:scale-105 transition-all hover:brightness-90"
                            style={{ backgroundColor: accentColor }}
                            type="button"
                            aria-label={isPlaying ? t('media.pause') : t('media.play')}
                            aria-busy={isBuffering || undefined}
                        >
                            {isBuffering ? (
                                <span data-testid="voice-buffering" className="flex"><Spinner size="md" tone="current" className="text-inverse" labelVisibility="compact" /></span>
                            ) : isPlaying ? (
                                <Pause aria-hidden="true" className="w-6 h-6 text-inverse fill-current" />
                            ) : (
                                <Play aria-hidden="true" className="w-6 h-6 text-inverse fill-current ml-0.5" />
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
                {errorRow}

                {/* Menu portal */}
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
                        {goldenFingerActive && (
                            <>
                                <MenuItem icon={<Download className="h-4 w-4" />} onClick={handleDownload}>{t('common.download')}</MenuItem>
                                <MenuSeparator />
                            </>
                        )}
                        <MenuLabel>{t('voicePlayer.speed')}</MenuLabel>
                        {[0.5, 1, 1.5, 2].map((rate) => (
                            <MenuItem key={rate} radio selected={playbackRate === rate} onClick={() => handlePlaybackRateChange(rate)}>
                                {rate}x
                            </MenuItem>
                        ))}
                    </Menu>,
                    document.body,
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
                    noSpeech={transcription.no_speech}
                    currentTime={currentTime}
                    onSeek={handleTranscriptSeek}
                    onRerun={retriggerTranscription}
                    accentColor={accentColor}
                    variant={panelTheme}
                    defaultExpanded={variant === 'fullscreen' || transcriptionJustCompleted}
                    withBackdrop={variant === 'gallery'}
                />
            ) : (
                <TranscribeButton
                    state={transcriptionState}
                    onClick={triggerTranscription}
                    error={transcriptionError}
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
            onKeyDown={viewerMode ? undefined : handleShortcut}
            className={cn('bg-sunken rounded-lg p-3 min-w-[300px] outline-none focus:ring-2', joinedBelow && 'rounded-b-none', tailCorner && 'rounded-tl-tail')}
            style={{ '--ring-color': withAlpha(accentColor, 50) } as React.CSSProperties}
        >
            {/* Hidden audio element */}
            <audio ref={audioRef} preload="metadata" />

            {/* Row 1: Progress Slider with smooth animation */}
            <div className="mb-3">
                <div className="relative h-1 bg-control-off rounded-full overflow-hidden ring-offset-0 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent">
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
                        aria-label={t('media.seek')}
                        aria-valuetext={t('media.timeOf', { current: formatTime(currentTime), total: formatTime(duration) })}
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
                        onFocusCapture={handleVolumeFocus}
                        onBlurCapture={handleVolumeBlur}
                    >
                        <button
                            onClick={handleMuteToggle}
                            className="p-1.5 hover:bg-sunken hover:brightness-94 rounded-full transition-colors"
                            title={isMuted ? t('voicePlayer.unmute') : t('voicePlayer.mute')}
                            aria-label={isMuted ? t('voicePlayer.unmute') : t('voicePlayer.mute')}
                            type="button"
                        >
                            {isMuted ? (
                                <VolumeX aria-hidden="true" className="w-4 h-4 text-secondary" />
                            ) : (
                                <Volume2 aria-hidden="true" className="w-4 h-4 text-secondary" />
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
                                aria-label={t('media.volume')}
                                aria-valuetext={t('media.volumeValue', { percent: Math.round(volume * 100) })}
                                className="w-full h-1 rounded-full appearance-none cursor-pointer"
                                style={{
                                    accentColor: accentColor,
                                    background: `linear-gradient(to right, ${accentColor} ${volume * 100}%, var(--ds-border-strong) ${volume * 100}%)`
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* Center: Play Button */}
                <button
                    onClick={togglePlay}
                    className="w-10 h-10 rounded-full shadow-pill flex items-center justify-center transition-colors shrink-0 hover:brightness-90"
                    style={{ backgroundColor: accentColor }}
                    type="button"
                    aria-label={isPlaying ? t('media.pause') : t('media.play')}
                    aria-busy={isBuffering || undefined}
                >
                    {isBuffering ? (
                        <span data-testid="voice-buffering" className="flex"><Spinner size="sm" tone="current" className="text-inverse" labelVisibility="compact" /></span>
                    ) : isPlaying ? (
                        <Pause aria-hidden="true" className="w-5 h-5 text-inverse fill-current" />
                    ) : (
                        <Play aria-hidden="true" className="w-5 h-5 text-inverse fill-current ml-0.5" />
                    )}
                </button>

                {/* Right: Time display + Options */}
                <div className="flex-1 flex items-center justify-end gap-1">
                    <div className="text-xs text-secondary whitespace-nowrap">
                        {formatTime(currentTime)} / {formatTime(duration)}
                    </div>
                    <button
                        ref={menuButtonRef}
                        onClick={handleMenuToggle}
                        aria-label={t('common.moreOptions')}
                        aria-haspopup="menu"
                        aria-expanded={showMenu}
                        className="p-1.5 hover:bg-sunken hover:brightness-94 rounded-full transition-colors"
                        type="button"
                    >
                        <MoreVertical className="w-4 h-4 text-secondary" />
                    </button>
                </div>
            </div>
            {errorRow}

            {/* Menu portal */}
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
                    {goldenFingerActive && (
                        <>
                            <MenuItem icon={<Download className="h-4 w-4" />} onClick={handleDownload}>{t('common.download')}</MenuItem>
                            <MenuSeparator />
                        </>
                    )}
                    <MenuLabel>{t('voicePlayer.speed')}</MenuLabel>
                    {[0.5, 1, 1.5, 2].map((rate) => (
                        <MenuItem key={rate} radio selected={playbackRate === rate} onClick={() => handlePlaybackRateChange(rate)}>
                            {rate}x
                        </MenuItem>
                    ))}
                </Menu>,
                document.body,
            )}
        </div>
    );
};
