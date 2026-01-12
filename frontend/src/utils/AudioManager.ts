// Global Audio Manager for persistent voice playback
// Keeps audio playing even when the VoicePlayer component is scrolled out of view

type AudioEventCallback = {
    onTimeUpdate?: (currentTime: number) => void;
    onEnded?: () => void;
    onLoadedMetadata?: (duration: number) => void;
};

const VOLUME_STORAGE_KEY = 'hakodesk_voice_volume';

class AudioManagerClass {
    private audio: HTMLAudioElement | null = null;
    private currentSrc: string = '';
    private callbacks: Map<string, AudioEventCallback> = new Map();
    private savedVolume: number = 1; // Volume before mute

    constructor() {
        if (typeof window !== 'undefined') {
            this.audio = new Audio();
            this.audio.addEventListener('timeupdate', this.handleTimeUpdate);
            this.audio.addEventListener('ended', this.handleEnded);
            this.audio.addEventListener('loadedmetadata', this.handleLoadedMetadata);

            // Restore saved volume from localStorage
            const savedVolume = localStorage.getItem(VOLUME_STORAGE_KEY);
            if (savedVolume !== null) {
                const vol = parseFloat(savedVolume);
                if (!isNaN(vol) && vol >= 0 && vol <= 1) {
                    this.audio.volume = vol;
                    this.savedVolume = vol > 0 ? vol : 1;
                }
            }
        }
    }

    private handleTimeUpdate = () => {
        if (this.audio && this.currentSrc) {
            const callback = this.callbacks.get(this.currentSrc);
            callback?.onTimeUpdate?.(this.audio.currentTime);
        }
    };

    private handleEnded = () => {
        if (this.currentSrc) {
            const callback = this.callbacks.get(this.currentSrc);
            callback?.onEnded?.();
        }
    };

    private handleLoadedMetadata = () => {
        if (this.audio && this.currentSrc) {
            const callback = this.callbacks.get(this.currentSrc);
            callback?.onLoadedMetadata?.(this.audio.duration);
        }
    };

    play(src: string, callbacks?: AudioEventCallback): void {
        if (!this.audio) return;

        if (this.currentSrc !== src) {
            this.audio.src = src;
            this.currentSrc = src;
        }

        if (callbacks) {
            this.callbacks.set(src, callbacks);
        }

        this.audio.play();
    }

    pause(): void {
        this.audio?.pause();
    }

    isPlaying(): boolean {
        return this.audio ? !this.audio.paused : false;
    }

    getCurrentSrc(): string {
        return this.currentSrc;
    }

    getCurrentTime(): number {
        return this.audio?.currentTime || 0;
    }

    getDuration(): number {
        return this.audio?.duration || 0;
    }

    setCurrentTime(time: number): void {
        if (this.audio) {
            this.audio.currentTime = time;
        }
    }

    setVolume(volume: number): void {
        if (this.audio) {
            this.audio.volume = volume;
            // Persist to localStorage
            localStorage.setItem(VOLUME_STORAGE_KEY, volume.toString());
            // Save non-zero volume for unmute
            if (volume > 0) {
                this.savedVolume = volume;
            }
        }
    }

    setPlaybackRate(rate: number): void {
        if (this.audio) {
            this.audio.playbackRate = rate;
        }
    }

    getVolume(): number {
        return this.audio?.volume || 1;
    }

    getPlaybackRate(): number {
        return this.audio?.playbackRate || 1;
    }

    isMuted(): boolean {
        return this.audio?.volume === 0;
    }

    toggleMute(): number {
        if (!this.audio) return 1;

        if (this.audio.volume > 0) {
            // Mute: save current volume and set to 0
            this.savedVolume = this.audio.volume;
            this.setVolume(0);
            return 0;
        } else {
            // Unmute: restore saved volume
            const restored = this.savedVolume || 1;
            this.setVolume(restored);
            return restored;
        }
    }

    // Seek relative to current position
    seekRelative(seconds: number): void {
        if (this.audio && this.currentSrc) {
            const newTime = Math.max(0, Math.min(this.audio.duration || 0, this.audio.currentTime + seconds));
            this.audio.currentTime = newTime;
        }
    }

    // Toggle play/pause for the current source
    togglePlayPause(): boolean {
        if (!this.audio || !this.currentSrc) return false;

        if (this.audio.paused) {
            this.audio.play();
            return true;
        } else {
            this.audio.pause();
            return false;
        }
    }

    // Unregister callbacks when component unmounts
    unregister(src: string): void {
        this.callbacks.delete(src);
    }
}

// Singleton instance
export const AudioManager = new AudioManagerClass();
