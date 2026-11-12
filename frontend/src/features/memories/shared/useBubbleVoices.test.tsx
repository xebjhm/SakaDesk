import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useRef } from 'react';
import { render } from '@testing-library/react';
import { useBubbleVoices } from './useBubbleVoices';
import { useVoicePlayback, type PlayerHandle } from './voicePlayback';

const Board: React.FC<{ surface?: string }> = ({ surface = 'day' }) => {
    const ref = useRef<HTMLDivElement>(null);
    useBubbleVoices(ref, surface);
    return (
        <div ref={ref}>
            <audio data-testid="a" />
            <audio data-testid="b" />
            <video data-testid="v" />
        </div>
    );
};

function audios(container: HTMLElement) {
    const [a, b] = Array.from(container.querySelectorAll('audio'));
    // An own mock per element (spyOn would patch the shared prototype).
    const pauses = [a, b].map((el) => {
        const pause = vi.fn();
        el.pause = pause;
        return pause;
    });
    return { a, b, pauseA: pauses[0], pauseB: pauses[1] };
}

const fire = (el: Element, type: string) => el.dispatchEvent(new Event(type));

beforeEach(() => { useVoicePlayback.setState({ playing: null, handle: null }); });

describe('useBubbleVoices', () => {
    it('joins a starting bubble voice to the coordinator and pauses the previous one', () => {
        const { container } = render(<Board />);
        const { a, b, pauseA, pauseB } = audios(container);
        fire(a, 'play');
        const first = useVoicePlayback.getState().playing;
        expect(first).toMatch(/^day\|bubble\|\d+$/);
        fire(b, 'play');
        expect(pauseA).toHaveBeenCalledTimes(1);
        expect(pauseB).not.toHaveBeenCalled();
        expect(useVoicePlayback.getState().playing).not.toBe(first);
    });

    it('is paused by any other Memories voice, and silences one that was playing', () => {
        const other: PlayerHandle = { stop: vi.fn(), fadeOut: vi.fn() };
        const { container } = render(<Board />);
        const { a, pauseA } = audios(container);
        useVoicePlayback.getState().play('radio', other);
        fire(a, 'play');
        expect(other.stop).toHaveBeenCalledTimes(1);
        useVoicePlayback.getState().play('radio', other);
        expect(pauseA).toHaveBeenCalledTimes(1);
    });

    it('leaves the coordinator on pause or end, and ignores video', () => {
        const { container } = render(<Board />);
        const { a, b } = audios(container);
        fire(a, 'play');
        fire(a, 'pause');
        expect(useVoicePlayback.getState().playing).toBeNull();
        fire(b, 'play');
        fire(b, 'ended');
        expect(useVoicePlayback.getState().playing).toBeNull();
        fire(container.querySelector('video')!, 'play');
        expect(useVoicePlayback.getState().playing).toBeNull();
    });

    it('stops its voice on unmount, but never another surface\'s', () => {
        const { container, unmount } = render(<Board />);
        const { a, pauseA } = audios(container);
        fire(a, 'play');
        unmount();
        expect(pauseA).toHaveBeenCalled();
        expect(useVoicePlayback.getState().playing).toBeNull();

        const view = render(<Board />);
        useVoicePlayback.getState().play('radio', { stop: vi.fn(), fadeOut: vi.fn() });
        view.unmount();
        expect(useVoicePlayback.getState().playing).toBe('radio');
    });

    it('fades a bubble out by pausing it at once', async () => {
        const { container } = render(<Board />);
        const { a, pauseA } = audios(container);
        fire(a, 'play');
        await useVoicePlayback.getState().handle!.fadeOut(500);
        expect(pauseA).toHaveBeenCalled();
    });
});
