import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Volume2, VolumeX, Play, Pause, MoreVertical, Download } from 'lucide-react';
import { AudioManager } from '../utils/AudioManager';

interface VoicePlayerProps {
    src: string;
}

export const VoicePlayer: React.FC<VoicePlayerProps> = ({ src }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(AudioManager.getVolume());
    const [showVolume, setShowVolume] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [playbackRate, setPlaybackRateState] = useState(AudioManager.getPlaybackRate());
    const containerRef = useRef<HTMLDivElement>(null);
    const volumeHideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Sync state with AudioManager on mount and when src plays
    useEffect(() => {
        // Check if this src is currently playing - sync UI state
        if (AudioManager.getCurrentSrc() === src) {
            setIsPlaying(AudioManager.isPlaying());
            setCurrentTime(AudioManager.getCurrentTime());
            const dur = AudioManager.getDuration();
            if (dur > 0) setDuration(dur);
        }

        return () => {
            // Don't stop playback on unmount - this is the key feature!
            // Just unregister callbacks to prevent stale updates
            AudioManager.unregister(src);
        };
    }, [src]);

    // Poll for playback state when this is the active src
    useEffect(() => {
        if (AudioManager.getCurrentSrc() !== src) return;

        const interval = setInterval(() => {
            if (AudioManager.getCurrentSrc() === src) {
                setIsPlaying(AudioManager.isPlaying());
                setCurrentTime(AudioManager.getCurrentTime());
                const dur = AudioManager.getDuration();
                if (dur > 0) setDuration(dur);
            }
        }, 100);

        return () => clearInterval(interval);
    }, [src]);

    // Keyboard shortcuts - only when this player is focused or is the active one
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle if this player is playing or focused
            const isThisActive = AudioManager.getCurrentSrc() === src;
            const isFocused = containerRef.current?.contains(document.activeElement);

            if (!isThisActive && !isFocused) return;

            switch (e.key) {
                case ' ': // Space to toggle play/pause
                    e.preventDefault();
                    if (isThisActive) {
                        const playing = AudioManager.togglePlayPause();
                        setIsPlaying(playing);
                    } else {
                        togglePlay();
                    }
                    break;
                case 'ArrowLeft': // Seek backward 5 seconds
                    e.preventDefault();
                    if (isThisActive) {
                        AudioManager.seekRelative(-5);
                        setCurrentTime(AudioManager.getCurrentTime());
                    }
                    break;
                case 'ArrowRight': // Seek forward 5 seconds
                    e.preventDefault();
                    if (isThisActive) {
                        AudioManager.seekRelative(5);
                        setCurrentTime(AudioManager.getCurrentTime());
                    }
                    break;
                case 'm': // Toggle mute
                case 'M':
                    e.preventDefault();
                    if (isThisActive) {
                        const newVol = AudioManager.toggleMute();
                        setVolume(newVol);
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [src]);

    const togglePlay = useCallback(() => {
        if (AudioManager.getCurrentSrc() === src && AudioManager.isPlaying()) {
            AudioManager.pause();
            setIsPlaying(false);
        } else {
            // If different src is playing, this will switch to new src
            AudioManager.play(src, {
                onTimeUpdate: (time) => setCurrentTime(time),
                onEnded: () => setIsPlaying(false),
                onLoadedMetadata: (dur) => setDuration(dur)
            });
            setIsPlaying(true);
        }
    }, [src]);

    const handleMuteToggle = useCallback(() => {
        const newVol = AudioManager.toggleMute();
        setVolume(newVol);
    }, []);

    // Volume hover handlers
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
        }, 300); // Small delay before hiding
    }, []);

    const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newTime = parseFloat(e.target.value);
        AudioManager.setCurrentTime(newTime);
        setCurrentTime(newTime);
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = parseFloat(e.target.value);
        AudioManager.setVolume(newVolume);
        setVolume(newVolume);
    };

    const handleDownload = () => {
        const urlParts = src.split('/');
        const filename = urlParts[urlParts.length - 1] || 'voice_message.m4a';

        const link = document.createElement('a');
        link.href = src;
        link.download = filename;
        link.click();
        setShowMenu(false);
    };

    const handlePlaybackRate = (rate: number) => {
        AudioManager.setPlaybackRate(rate);
        setPlaybackRateState(rate);
        setShowMenu(false);
    };

    const formatTime = (time: number) => {
        if (!isFinite(time) || isNaN(time)) return '--:--';
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
    const isThisPlaying = isPlaying && AudioManager.getCurrentSrc() === src;

    const isMuted = volume === 0;

    return (
        <div
            ref={containerRef}
            tabIndex={0}
            className="bg-[#F3F4F6] rounded-2xl p-3 min-w-[300px] outline-none focus:ring-2 focus:ring-[#6da0d4]/50"
        >
            {/* Row 1: Progress Slider */}
            <div className="mb-3">
                <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    value={currentTime}
                    onChange={handleProgressChange}
                    className="w-full h-1 bg-gray-300 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-3
            [&::-webkit-slider-thumb]:h-3
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-gray-500
            [&::-webkit-slider-thumb]:cursor-pointer"
                    style={{
                        background: `linear-gradient(to right, #6da0d4 ${progress}%, #d1d5db ${progress}%)`
                    }}
                />
            </div>

            {/* Row 2: Controls */}
            <div className="flex items-center justify-between">
                {/* Left: Time + Volume */}
                <div className="flex items-center gap-1">
                    <div className="text-xs text-gray-500 min-w-[40px]">
                        {formatTime(currentTime)}
                    </div>

                    <div
                        className="relative"
                        onMouseEnter={handleVolumeMouseEnter}
                        onMouseLeave={handleVolumeMouseLeave}
                    >
                        <button
                            onClick={handleMuteToggle}
                            className="p-1.5 hover:bg-gray-200 rounded-full transition-colors"
                            title={isMuted ? "Unmute (M)" : "Mute (M)"}
                        >
                            {isMuted ? (
                                <VolumeX className="w-4 h-4 text-gray-500" />
                            ) : (
                                <Volume2 className="w-4 h-4 text-gray-500" />
                            )}
                        </button>

                        {showVolume && (
                            <div
                                className="absolute top-full left-1/2 -translate-x-1/2 mt-2 p-2 bg-white rounded-lg shadow-lg border z-50"
                                onMouseEnter={handleVolumeMouseEnter}
                                onMouseLeave={handleVolumeMouseLeave}
                            >
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.1}
                                    value={volume}
                                    onChange={handleVolumeChange}
                                    className="w-1.5 h-20 bg-gray-300 rounded-full appearance-none cursor-pointer
                    [writing-mode:vertical-lr]
                    [direction:rtl]
                    [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:w-3
                    [&::-webkit-slider-thumb]:h-3
                    [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-[#6da0d4]
                    [&::-webkit-slider-thumb]:cursor-pointer"
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Center: Play Button */}
                <button
                    onClick={togglePlay}
                    className="w-10 h-10 rounded-full bg-[#6da0d4] shadow-md flex items-center justify-center hover:bg-[#5a8fc3] transition-colors"
                >
                    {isThisPlaying ? (
                        <Pause className="w-5 h-5 text-white fill-current" />
                    ) : (
                        <Play className="w-5 h-5 text-white fill-current ml-0.5" />
                    )}
                </button>

                {/* Right: Duration + Options */}
                <div className="flex items-center gap-1">
                    <div className="text-xs text-gray-500 min-w-[40px] text-right">
                        {formatTime(duration)}
                    </div>

                    <div className="relative">
                        <button
                            onClick={() => { setShowMenu(!showMenu); setShowVolume(false); }}
                            className="p-1.5 hover:bg-gray-200 rounded-full transition-colors"
                        >
                            <MoreVertical className="w-4 h-4 text-gray-500" />
                        </button>

                        {showMenu && (
                            <div className="absolute top-full right-0 mt-2 bg-white rounded-lg shadow-lg border py-1 min-w-[140px] z-50">
                                <button
                                    onClick={handleDownload}
                                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                >
                                    <Download className="w-4 h-4" />
                                    Download
                                </button>
                                <div className="border-t my-1" />
                                <div className="px-4 py-1 text-xs text-gray-400">Speed</div>
                                {[0.5, 1, 1.5, 2].map(rate => (
                                    <button
                                        key={rate}
                                        onClick={() => handlePlaybackRate(rate)}
                                        className={`w-full px-4 py-1.5 text-left text-sm hover:bg-gray-100 ${playbackRate === rate ? 'text-[#6da0d4] font-medium' : 'text-gray-700'
                                            }`}
                                    >
                                        {rate}x
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
