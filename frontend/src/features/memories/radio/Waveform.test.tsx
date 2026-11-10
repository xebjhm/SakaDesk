import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Waveform } from './Waveform';
import { createRadioAudioGraph, RESUME_TIMEOUT_MS } from './radioAudio';

const fakeAnalyser = () => ({
    frequencyBinCount: 32,
    getByteFrequencyData: vi.fn((arr: Uint8Array) => arr.fill(128)),
}) as unknown as AnalyserNode;

const realMatchMedia = window.matchMedia;
const realAudioContext = globalThis.AudioContext;
afterEach(() => {
    window.matchMedia = realMatchMedia;
    globalThis.AudioContext = realAudioContext;
});

const reduceMotion = () => {
    window.matchMedia = vi.fn((q: string) => ({ matches: q.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
};

describe('Waveform', () => {
    it('draws live bars from the analyser while playing, and the still contour after', () => {
        const frames: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        const analyser = fakeAnalyser();
        const { rerender } = render(<Waveform analyser={analyser} active />);
        const wave = screen.getByTestId('waveform');
        expect(wave).toHaveAttribute('data-mode', 'live');
        const still = (wave.children[0] as HTMLElement).style.height;
        frames.shift()?.(0);
        expect(analyser.getByteFrequencyData).toHaveBeenCalled();
        // 128 / 255 of full height on every bar.
        expect(Array.from(wave.children).every((b) => (b as HTMLElement).style.height === '50%')).toBe(true);
        rerender(<Waveform analyser={analyser} active={false} />);
        expect(wave).toHaveAttribute('data-mode', 'static');
        expect((wave.children[0] as HTMLElement).style.height).toBe(still);
        vi.unstubAllGlobals();
    });

    it('draws a static bar row without an analyser (no AudioContext)', () => {
        render(<Waveform analyser={null} active />);
        const wave = screen.getByTestId('waveform');
        expect(wave).toHaveAttribute('data-mode', 'static');
        expect(wave.children.length).toBeGreaterThan(8);
    });

    it('is static under reduced motion', () => {
        reduceMotion();
        render(<Waveform analyser={fakeAnalyser()} active />);
        expect(screen.getByTestId('waveform')).toHaveAttribute('data-mode', 'static');
    });
});

describe('createRadioAudioGraph', () => {
    type FakeCtx = EventTarget & {
        state: string;
        close: ReturnType<typeof vi.fn>;
        resume: ReturnType<typeof vi.fn>;
        suspend: () => void;
    };
    function mockContext(resume: () => Promise<void> = () => Promise.resolve()) {
        const sources: Array<{ el: unknown; disconnect: ReturnType<typeof vi.fn> }> = [];
        const made: FakeCtx[] = [];
        class Ctx extends EventTarget {
            state = 'running';
            destination = {};
            createAnalyser = vi.fn(() => ({ connect: vi.fn(), fftSize: 0 }));
            createMediaElementSource = vi.fn((el: unknown) => {
                if (sources.some((s) => s.el === el)) throw new DOMException('already connected', 'InvalidStateError');
                const source = { el, connect: vi.fn(), disconnect: vi.fn() };
                sources.push(source);
                return source;
            });
            close = vi.fn(() => Promise.resolve());
            resume = vi.fn(resume);
            constructor() {
                super();
                made.push(this as unknown as FakeCtx);
            }
            suspend() {
                this.state = 'suspended';
                this.dispatchEvent(new Event('statechange'));
            }
        }
        globalThis.AudioContext = Ctx as unknown as typeof AudioContext;
        return { sources, made };
    }

    it('makes no context before a gesture, attaches each element once, and closes it', () => {
        const { sources, made } = mockContext();
        const graph = createRadioAudioGraph();
        const el = document.createElement('audio');
        graph.attach(el);
        expect(graph.analyser()).toBeNull();
        graph.ensure();
        expect(graph.analyser()).not.toBeNull();
        graph.attach(el);
        graph.attach(el);
        expect(sources).toHaveLength(1);
        expect(graph.isRouted(el)).toBe(true);
        graph.close();
        expect(made[0].close).toHaveBeenCalled();
        expect(graph.analyser()).toBeNull();
    });

    it('disconnects a released element', () => {
        const { sources } = mockContext();
        const graph = createRadioAudioGraph();
        graph.ensure();
        const el = document.createElement('audio');
        graph.attach(el);
        graph.release(el);
        expect(sources[0].disconnect).toHaveBeenCalled();
        expect(graph.isRouted(el)).toBe(false);
    });

    it('resumes a context that suspends while audio is routed', async () => {
        const { made } = mockContext();
        const graph = createRadioAudioGraph();
        const lost = vi.fn();
        graph.onUnroute(lost);
        graph.ensure();
        graph.attach(document.createElement('audio'));
        made[0].resume.mockImplementation(() => { made[0].state = 'running'; return Promise.resolve(); });
        made[0].suspend();
        expect(made[0].resume).toHaveBeenCalled();
        await Promise.resolve();
        await Promise.resolve();
        expect(lost).not.toHaveBeenCalled();
        expect(graph.analyser()).not.toBeNull();
    });

    it('unroutes when the resume fails: sources disconnected, no analyser, listeners told', async () => {
        const { made, sources } = mockContext(() => Promise.reject(new Error('no')));
        const graph = createRadioAudioGraph();
        const lost = vi.fn();
        graph.onUnroute(lost);
        graph.ensure();
        const el = document.createElement('audio');
        graph.attach(el);
        made[0].suspend();
        await Promise.resolve();
        await Promise.resolve();
        expect(lost).toHaveBeenCalledTimes(1);
        expect(sources[0].disconnect).toHaveBeenCalled();
        expect(graph.analyser()).toBeNull();
        expect(graph.isRouted(el)).toBe(false);
        // Nothing is routed any more: new elements play directly.
        graph.attach(document.createElement('audio'));
        expect(sources).toHaveLength(1);
    });

    it('unroutes when a resume stalls past the timeout', () => {
        vi.useFakeTimers();
        const { made } = mockContext(() => new Promise<void>(() => {}));
        const graph = createRadioAudioGraph();
        const lost = vi.fn();
        graph.onUnroute(lost);
        graph.ensure();
        graph.attach(document.createElement('audio'));
        made[0].suspend();
        vi.advanceTimersByTime(RESUME_TIMEOUT_MS - 1);
        expect(lost).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(lost).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it('leaves a suspended context alone while nothing is routed', () => {
        const { made } = mockContext(() => Promise.reject(new Error('no')));
        const graph = createRadioAudioGraph();
        const lost = vi.fn();
        graph.onUnroute(lost);
        graph.ensure();
        made[0].suspend();
        expect(made[0].resume).not.toHaveBeenCalled();
        expect(lost).not.toHaveBeenCalled();
    });

    it('stays without a waveform when there is no AudioContext or motion is reduced', () => {
        // @ts-expect-error -- jsdom without Web Audio
        globalThis.AudioContext = undefined;
        const graph = createRadioAudioGraph();
        graph.ensure();
        expect(graph.analyser()).toBeNull();
        mockContext();
        reduceMotion();
        const reduced = createRadioAudioGraph();
        reduced.ensure();
        expect(reduced.analyser()).toBeNull();
    });
});
