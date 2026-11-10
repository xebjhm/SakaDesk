import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Waveform } from './Waveform';
import { createRadioAudioGraph } from './radioAudio';

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
    it('draws live bars from the analyser while playing', () => {
        render(<Waveform analyser={fakeAnalyser()} active />);
        expect(screen.getByTestId('waveform')).toHaveAttribute('data-mode', 'live');
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
    function mockContext() {
        const sources: unknown[] = [];
        class Ctx {
            state = 'running';
            destination = {};
            createAnalyser = vi.fn(() => ({ connect: vi.fn(), fftSize: 0 }));
            createMediaElementSource = vi.fn((el: unknown) => {
                if (sources.includes(el)) throw new DOMException('already connected', 'InvalidStateError');
                sources.push(el);
                return { connect: vi.fn() };
            });
            close = vi.fn(() => Promise.resolve());
            resume = vi.fn(() => Promise.resolve());
        }
        globalThis.AudioContext = Ctx as unknown as typeof AudioContext;
        return sources;
    }

    it('makes no context before a gesture, then attaches each element once', () => {
        const sources = mockContext();
        const graph = createRadioAudioGraph();
        const el = document.createElement('audio');
        graph.attach(el);
        expect(graph.analyser()).toBeNull();
        graph.ensure();
        expect(graph.analyser()).not.toBeNull();
        graph.attach(el);
        graph.attach(el);
        expect(sources).toHaveLength(1);
        graph.close();
        expect(graph.analyser()).toBeNull();
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
