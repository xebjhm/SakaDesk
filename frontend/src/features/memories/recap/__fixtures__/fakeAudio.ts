/**
 * A fake `<audio>` for the voice slide tests: no media decoding, the test
 * moves `currentTime` and fires the events itself.
 */
export class FakeAudio extends EventTarget {
    src = '';
    currentTime = 0;
    volume = 1;
    paused = true;
    preload = '';
    /** Set to make the next `play()` reject. */
    rejectPlay: Error | null = null;
    playCalls = 0;

    play(): Promise<void> {
        this.playCalls += 1;
        if (this.rejectPlay) return Promise.reject(this.rejectPlay);
        this.paused = false;
        return Promise.resolve();
    }

    pause(): void {
        this.paused = true;
    }

    removeAttribute(name: string): void {
        if (name === 'src') this.src = '';
    }

    load(): void {}

    /** Moves the playhead and fires `timeupdate`. */
    tick(seconds: number): void {
        this.currentTime = seconds;
        this.dispatchEvent(new Event('timeupdate'));
    }

    fire(type: 'ended' | 'error'): void {
        this.dispatchEvent(new Event(type));
    }
}

/** A factory that records every fake it hands out. */
export function fakeAudioFactory(): { create: () => HTMLAudioElement; made: FakeAudio[] } {
    const made: FakeAudio[] = [];
    return {
        made,
        create: () => {
            const a = new FakeAudio();
            made.push(a);
            return a as unknown as HTMLAudioElement;
        },
    };
}
