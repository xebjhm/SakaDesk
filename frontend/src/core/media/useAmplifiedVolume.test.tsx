import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAmplifiedVolume } from './useAmplifiedVolume';

const contexts: FakeContext[] = [];

class FakeContext {
    destination = {};
    state: AudioContextState = 'suspended';
    gains: Array<{ value: number }> = [];
    createMediaElementSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
    createGain = vi.fn(() => {
        const gain = { value: 1 };
        this.gains.push(gain);
        return { gain, connect: vi.fn(), disconnect: vi.fn() };
    });
    resume = vi.fn(() => { this.state = 'running'; return Promise.resolve(); });
    close = vi.fn(() => { this.state = 'closed'; return Promise.resolve(); });
    constructor() { contexts.push(this); }
}

const realAudioContext = globalThis.AudioContext;
beforeEach(() => {
    contexts.length = 0;
    globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
});
afterEach(() => { globalThis.AudioContext = realAudioContext; });

describe('useAmplifiedVolume (lazy AudioContext)', () => {
    it('creates no AudioContext when an element is connected but never played', () => {
        const { result, unmount } = renderHook(() => useAmplifiedVolume('test_amp'));
        act(() => { result.current.connectElement(document.createElement('video')); });
        expect(contexts).toHaveLength(0);
        unmount();
        expect(contexts).toHaveLength(0);
    });

    it('builds the graph on the first play event and resumes a suspended context', () => {
        const { result } = renderHook(() => useAmplifiedVolume('test_amp'));
        const video = document.createElement('video');
        act(() => { result.current.connectElement(video); });
        act(() => { video.dispatchEvent(new Event('play')); });
        expect(contexts).toHaveLength(1);
        expect(contexts[0].createMediaElementSource).toHaveBeenCalledWith(video);
        expect(contexts[0].resume).toHaveBeenCalledTimes(1);
        expect(contexts[0].gains[0].value).toBeCloseTo(1); // default volume 0.5 → gain 1
    });

    it('prepareForPlayback builds the graph before play() and later plays reuse it', () => {
        const { result } = renderHook(() => useAmplifiedVolume('test_amp'));
        const audio = document.createElement('audio');
        act(() => { result.current.connectElement(audio); });
        act(() => { result.current.prepareForPlayback(); });
        expect(contexts).toHaveLength(1);
        act(() => { audio.dispatchEvent(new Event('play')); });
        act(() => { audio.dispatchEvent(new Event('play')); });
        expect(contexts).toHaveLength(1);
        expect(contexts[0].createMediaElementSource).toHaveBeenCalledTimes(1);
    });

    it('resumes the context again when it was suspended between plays', () => {
        const { result } = renderHook(() => useAmplifiedVolume('test_amp'));
        const audio = document.createElement('audio');
        act(() => { result.current.connectElement(audio); });
        act(() => { audio.dispatchEvent(new Event('play')); });
        contexts[0].state = 'suspended';
        act(() => { audio.dispatchEvent(new Event('play')); });
        expect(contexts[0].resume).toHaveBeenCalledTimes(2);
    });

    it('closes the context on unmount and stops listening for play', () => {
        const { result, unmount } = renderHook(() => useAmplifiedVolume('test_amp'));
        const audio = document.createElement('audio');
        act(() => { result.current.connectElement(audio); });
        act(() => { audio.dispatchEvent(new Event('play')); });
        unmount();
        expect(contexts[0].close).toHaveBeenCalledTimes(1);
        audio.dispatchEvent(new Event('play'));
        expect(contexts).toHaveLength(1);
    });

    it('does nothing when nothing is registered', () => {
        const { result } = renderHook(() => useAmplifiedVolume('test_amp'));
        act(() => { result.current.prepareForPlayback(); });
        expect(contexts).toHaveLength(0);
    });
});
