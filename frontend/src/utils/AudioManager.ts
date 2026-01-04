// Global Audio Manager for persistent voice playback
// Keeps audio playing even when the VoicePlayer component is scrolled out of view

type AudioEventCallback = {
    onTimeUpdate?: (currentTime: number) => void;
    onEnded?: () => void;
    onLoadedMetadata?: (duration: number) => void;
};

class AudioManagerClass {
    private audio: HTMLAudioElement | null = null;
    private currentSrc: string = '';
    private callbacks: Map<string, AudioEventCallback> = new Map();

    constructor() {
        if (typeof window !== 'undefined') {
            this.audio = new Audio();
            this.audio.addEventListener('timeupdate', this.handleTimeUpdate);
            this.audio.addEventListener('ended', this.handleEnded);
            this.audio.addEventListener('loadedmetadata', this.handleLoadedMetadata);
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

    // Unregister callbacks when component unmounts
    unregister(src: string): void {
        this.callbacks.delete(src);
    }
}

// Singleton instance
export const AudioManager = new AudioManagerClass();
