import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import i18n from '../../../i18n';
import { RecapPlayer, AUTO_ADVANCE_MS, STILL_CLASS } from './RecapPlayer';
import { SLIDE_REGISTRY, type SlideRegistry } from './slideRegistry';
import { clockData, greetingsData, payload, photosData, s01, s02, s12, s13, voiceData } from './__fixtures__/payload';
import type { RecapSlide } from './api';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import { fakeAudioFactory } from './__fixtures__/fakeAudio';
import { CROSSFADE_MS } from '../shared/clipSequencer';

const audio = vi.hoisted(() => ({ factory: null as null | { create: () => HTMLAudioElement } }));
vi.mock('../shared/clipSequencer', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../shared/clipSequencer')>();
    return { ...mod, createAudioElement: () => audio.factory!.create() };
});

const playLogs = () => vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'recap_play');

function setReducedMotion(reduce: boolean) {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: vi.fn((query: string) => ({
            matches: reduce && query.includes('prefers-reduced-motion'),
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            onchange: null,
            dispatchEvent: vi.fn(),
        })),
    });
}

const current = () => screen.getByTestId('recap-stage').getAttribute('data-slide');
/** The fill of the current progress segment. */
const fill = () => {
    const seg = screen.getAllByTestId('recap-progress-segment').find((el) => el.getAttribute('data-state') === 'current');
    return (seg?.firstElementChild as HTMLElement).style;
};

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => { setReducedMotion(false); vi.mocked(clientLog).mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe('RecapPlayer', () => {
    it('renders slide 1 from the payload', () => {
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        expect(current()).toBe('s01_first');
        expect(screen.getByTestId('slide-s01_first')).toBeInTheDocument();
        expect(screen.getAllByTestId('recap-progress-segment')).toHaveLength(4);
    });

    it('steps with → and ←', () => {
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(current()).toBe('s02_name');
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(current()).toBe('s12_sentence');
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(current()).toBe('s02_name');
    });

    it('steps with clicks on the right and left of the stage', () => {
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: '次へ' }));
        expect(current()).toBe('s02_name');
        fireEvent.click(screen.getByRole('button', { name: '前へ' }));
        expect(current()).toBe('s01_first');
    });

    it('auto-advances after 7 s', () => {
        vi.useFakeTimers();
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        expect(AUTO_ADVANCE_MS).toBe(7000);
        act(() => { vi.advanceTimersByTime(6900); });
        expect(current()).toBe('s01_first');
        act(() => { vi.advanceTimersByTime(200); });
        expect(current()).toBe('s02_name');
    });

    it('Space pauses and resumes with the remaining time', () => {
        vi.useFakeTimers();
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        act(() => { vi.advanceTimersByTime(3000); });
        fireEvent.keyDown(window, { key: ' ' });
        expect(screen.getByTestId('recap-stage')).toHaveAttribute('data-paused', 'true');
        act(() => { vi.advanceTimersByTime(20000); });
        expect(current()).toBe('s01_first');
        fireEvent.keyDown(window, { key: ' ' });
        act(() => { vi.advanceTimersByTime(3900); });
        expect(current()).toBe('s01_first');
        act(() => { vi.advanceTimersByTime(200); });
        expect(current()).toBe('s02_name');
    });

    it('a step while paused shows the target slide fully revealed, not frozen at frame 0 (D3)', () => {
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        // Paused mid-animation: the slide holds where it is (no still frame).
        fireEvent.keyDown(window, { key: ' ' });
        expect(screen.getByTestId('slide-s01_first')).not.toHaveAttribute('data-still');
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        const stepped = screen.getByTestId('slide-s02_name');
        expect(stepped).toHaveAttribute('data-still', 'true');
        expect(stepped).toHaveClass(STILL_CLASS);
        expect(stepped).not.toHaveClass('animate-reveal');
        fireEvent.click(screen.getByRole('button', { name: '前へ' }));
        expect(screen.getByTestId('slide-s01_first')).toHaveAttribute('data-still', 'true');
        // Resumed, the next step animates normally again.
        fireEvent.keyDown(window, { key: ' ' });
        expect(screen.getByTestId('slide-s01_first')).toHaveAttribute('data-still', 'true');
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(screen.getByTestId('slide-s02_name')).not.toHaveAttribute('data-still');
        expect(screen.getByTestId('slide-s02_name')).toHaveClass('animate-reveal');
    });

    it('centres the stage in the pane (D2)', () => {
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        expect(screen.getByTestId('recap-root')).toHaveClass('w-full', 'flex-1', 'justify-center');
    });

    it('stops on the last slide', () => {
        vi.useFakeTimers();
        const onEnd = vi.fn();
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} onEnd={onEnd} />);
        for (let i = 0; i < 10; i += 1) act(() => { vi.advanceTimersByTime(AUTO_ADVANCE_MS); });
        expect(current()).toBe('s13_oyasumi');
        expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it('Esc closes', () => {
        const onClose = vi.fn();
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('← on slide 1 restarts the countdown while playing', () => {
        vi.useFakeTimers();
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        act(() => { vi.advanceTimersByTime(5000); });
        act(() => { fireEvent.keyDown(window, { key: 'ArrowLeft' }); });
        act(() => { vi.advanceTimersByTime(6900); });
        expect(current()).toBe('s01_first');
        act(() => { vi.advanceTimersByTime(200); });
        expect(current()).toBe('s02_name');
    });

    it('← on slide 1 restarts the progress bar while playing', () => {
        vi.useFakeTimers();
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        act(() => { vi.advanceTimersByTime(5000); });
        expect(fill().width).toBe('100%');
        act(() => { fireEvent.keyDown(window, { key: 'ArrowLeft' }); });
        expect(fill().width).toBe('0%');
        act(() => { vi.advanceTimersByTime(50); });
        expect(fill().width).toBe('100%');
        expect(fill().transitionDuration).toBe(`${AUTO_ADVANCE_MS}ms`);
    });

    it('← on slide 1 restarts the countdown and the bar while paused', () => {
        vi.useFakeTimers();
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        act(() => { vi.advanceTimersByTime(3000); });
        act(() => { fireEvent.keyDown(window, { key: ' ' }); });
        expect(fill().width).not.toBe('0%');
        act(() => { fireEvent.keyDown(window, { key: 'ArrowLeft' }); });
        expect(fill().width).toBe('0%');
        act(() => { fireEvent.keyDown(window, { key: ' ' }); });
        act(() => { vi.advanceTimersByTime(6900); });
        expect(current()).toBe('s01_first');
        act(() => { vi.advanceTimersByTime(200); });
        expect(current()).toBe('s02_name');
    });

    it('a manual step gives the new slide its full time', () => {
        vi.useFakeTimers();
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
        act(() => { vi.advanceTimersByTime(5000); });
        act(() => { fireEvent.keyDown(window, { key: 'ArrowLeft' }); });
        act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
        act(() => { vi.advanceTimersByTime(6900); });
        expect(current()).toBe('s02_name');
        act(() => { vi.advanceTimersByTime(200); });
        expect(current()).toBe('s12_sentence');
    });

    it('ignores held (repeating) keys', () => {
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
        expect(current()).toBe('s01_first');
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        fireEvent.keyDown(window, { key: 'ArrowLeft', repeat: true });
        expect(current()).toBe('s02_name');
        fireEvent.keyDown(window, { key: ' ', repeat: true });
        expect(screen.getByTestId('recap-stage')).toHaveAttribute('data-paused', 'false');
    });

    it('Space on a focused button is left to the button and does not also toggle pause', () => {
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        const next = screen.getByRole('button', { name: '次へ' });
        next.focus();
        expect(fireEvent.keyDown(next, { key: ' ' })).toBe(true);
        expect(screen.getByTestId('recap-stage')).toHaveAttribute('data-paused', 'false');
        const pause = screen.getByRole('button', { name: '一時停止' });
        pause.focus();
        expect(fireEvent.keyDown(pause, { key: ' ' })).toBe(true);
        expect(screen.getByTestId('recap-stage')).toHaveAttribute('data-paused', 'false');
    });

    it('logs pause and resume once each, even under StrictMode', () => {
        render(<StrictMode><RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} /></StrictMode>);
        // Two presses in one batch: the second update is computed while rendering, where
        // StrictMode runs updaters twice, so a log inside an updater would be doubled.
        act(() => {
            fireEvent.keyDown(window, { key: ' ' });
            fireEvent.keyDown(window, { key: ' ' });
        });
        expect(screen.getByTestId('recap-stage')).toHaveAttribute('data-paused', 'false');
        const phases = playLogs().map(([, f]) => (f as { phase: string }).phase);
        expect(phases.filter((p) => p === 'pause')).toHaveLength(1);
        expect(phases.filter((p) => p === 'resume')).toHaveLength(1);
    });

    it('Esc closes only the player: other app-level Esc handlers do not fire', () => {
        const onClose = vi.fn();
        const onDocument = vi.fn();
        const onWindow = vi.fn();
        document.addEventListener('keydown', onDocument);
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={onClose} />);
        window.addEventListener('keydown', onWindow);
        try {
            fireEvent.keyDown(document.body, { key: 'Escape' });
            expect(onClose).toHaveBeenCalledTimes(1);
            expect(onDocument).not.toHaveBeenCalled();
            expect(onWindow).not.toHaveBeenCalled();
        } finally {
            document.removeEventListener('keydown', onDocument);
            window.removeEventListener('keydown', onWindow);
        }
    });

    it('leaves Arrow, Space and Esc to a focusable widget outside the player', () => {
        const onClose = vi.fn();
        const onWidgetKey = vi.fn();
        render(
            <>
                <RecapPlayer recap={payload()} nickname="ゆき" onClose={onClose} />
                <div role="slider" aria-valuenow={1} tabIndex={0} onKeyDown={(e) => onWidgetKey(e.key)}>widget</div>
            </>,
        );
        const widget = screen.getByRole('slider');
        widget.focus();
        for (const key of ['ArrowRight', 'ArrowLeft', ' ', 'Escape']) {
            expect(fireEvent.keyDown(widget, { key })).toBe(true);
        }
        expect(onWidgetKey.mock.calls.map(([k]) => k)).toEqual(['ArrowRight', 'ArrowLeft', ' ', 'Escape']);
        expect(current()).toBe('s01_first');
        expect(screen.getByTestId('recap-stage')).toHaveAttribute('data-paused', 'false');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('still claims keys whose target is the document body or inside the player', () => {
        const onClose = vi.fn();
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={onClose} />);
        fireEvent.keyDown(document.body, { key: 'ArrowRight' });
        expect(current()).toBe('s02_name');
        fireEvent.keyDown(screen.getByTestId('recap-stage'), { key: 'ArrowRight' });
        expect(current()).toBe('s12_sentence');
    });

    it('leaves Esc to an open menu', () => {
        const onClose = vi.fn();
        render(
            <>
                <RecapPlayer recap={payload()} nickname="ゆき" onClose={onClose} />
                <div role="menu" tabIndex={-1} />
            </>,
        );
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a slide that waits for media does not auto-advance until its playback ends', () => {
        vi.useFakeTimers();
        const voice: RecapSlide = { key: 's06_voice', fallback: null, data: { clips: [], voice_count: 3 } };
        const registry: SlideRegistry = {
            ...SLIDE_REGISTRY,
            s06_voice: {
                waitsForMedia: true,
                component: ({ onMediaEnd }) => <button type="button" onClick={onMediaEnd}>ended</button>,
            },
        };
        render(<RecapPlayer recap={payload({ slides: [voice, s12] })} nickname="ゆき" onClose={() => {}} registry={registry} />);
        act(() => { vi.advanceTimersByTime(AUTO_ADVANCE_MS * 3); });
        expect(current()).toBe('s06_voice');
        fireEvent.click(screen.getByRole('button', { name: 'ended' }));
        expect(current()).toBe('s12_sentence');
    });

    it('passes its pause to the slide', () => {
        const registry: SlideRegistry = {
            ...SLIDE_REGISTRY,
            s01_first: { component: ({ paused }) => <p data-testid="probe" data-paused={String(paused)} /> },
        };
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} registry={registry} />);
        expect(screen.getByTestId('probe')).toHaveAttribute('data-paused', 'false');
        fireEvent.keyDown(window, { key: ' ' });
        expect(screen.getByTestId('probe')).toHaveAttribute('data-paused', 'true');
    });

    it('media that ends while paused does not advance; the step waits for resume', () => {
        vi.useFakeTimers();
        const voice: RecapSlide = { key: 's06_voice', fallback: null, data: { clips: [], voice_count: 3 } };
        const registry: SlideRegistry = {
            ...SLIDE_REGISTRY,
            s06_voice: {
                waitsForMedia: true,
                component: ({ onMediaEnd }) => <button type="button" onClick={onMediaEnd}>ended</button>,
            },
        };
        render(<RecapPlayer recap={payload({ slides: [voice, s12] })} nickname="ゆき" onClose={() => {}} registry={registry} />);
        fireEvent.keyDown(window, { key: ' ' });
        fireEvent.click(screen.getByRole('button', { name: 'ended' }));
        act(() => { vi.advanceTimersByTime(AUTO_ADVANCE_MS * 3); });
        expect(current()).toBe('s06_voice');
        expect(playLogs()).toContainEqual(['recap_play', expect.objectContaining({ phase: 'media_held', index: 0, key: 's06_voice' })]);
        fireEvent.keyDown(window, { key: ' ' });
        expect(current()).toBe('s12_sentence');
        expect(playLogs()).toContainEqual(['recap_play', expect.objectContaining({ phase: 'step', index: 1, reason: 'media' })]);
    });

    it('a held media end is dropped by a manual step', () => {
        const voice: RecapSlide = { key: 's06_voice', fallback: null, data: { clips: [], voice_count: 3 } };
        const registry: SlideRegistry = {
            ...SLIDE_REGISTRY,
            s06_voice: {
                waitsForMedia: true,
                component: ({ onMediaEnd }) => <button type="button" onClick={onMediaEnd}>ended</button>,
            },
        };
        render(<RecapPlayer recap={payload({ slides: [s01, voice, s12, s13(true, false)] })} nickname="ゆき" onClose={() => {}} registry={registry} />);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        fireEvent.keyDown(window, { key: ' ' });
        fireEvent.click(screen.getByRole('button', { name: 'ended' }));
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        fireEvent.keyDown(window, { key: ' ' });
        expect(current()).toBe('s06_voice');
    });

    it('skips slides that have no renderer yet and logs it', () => {
        const letter: RecapSlide = {
            key: 's07_letter', fallback: null, data: { message: null, char_count: 120, photo_url: null },
        };
        // Every slide has a renderer now; a registry without the letter stands in for an unbuilt one.
        const registry: SlideRegistry = { ...SLIDE_REGISTRY };
        delete registry.s07_letter;
        render(<RecapPlayer recap={payload({ slides: [s01, letter, s02] })} nickname="ゆき" onClose={() => {}} registry={registry} />);
        expect(screen.getAllByTestId('recap-progress-segment')).toHaveLength(2);
        expect(playLogs()).toContainEqual(['recap_play', expect.objectContaining({ phase: 'skip', key: 's07_letter', reason: 'not_built' })]);
    });

    it('logs ids and codes only', () => {
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        for (const [, fields] of playLogs()) {
            for (const v of Object.values(fields ?? {})) {
                if (typeof v === 'string') expect(v).toMatch(/^[a-z0-9_]{1,40}$/);
            }
        }
        expect(playLogs()).toContainEqual(['recap_play', expect.objectContaining({ phase: 'step', index: 1, key: 's02_name', reason: 'key' })]);
    });

    it('uses static transitions with prefers-reduced-motion', () => {
        setReducedMotion(true);
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        const stage = screen.getByTestId('recap-stage');
        expect(stage).toHaveAttribute('data-reduced-motion', 'true');
        for (let i = 0; i < 4; i += 1) {
            expect(stage.innerHTML).not.toMatch(/\banimate-/);
            fireEvent.keyDown(window, { key: 'ArrowRight' });
        }
    });

    it('animates without reduced motion', () => {
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        const stage = screen.getByTestId('recap-stage');
        expect(stage).toHaveAttribute('data-reduced-motion', 'false');
        expect(stage.innerHTML).toMatch(/\banimate-reveal/);
    });

    it('ignores keys while a dialog is open', () => {
        render(
            <>
                <RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />
                <div role="dialog" aria-modal="true" />
            </>,
        );
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(current()).toBe('s01_first');
    });

    it('replaces %%% with the nickname on every slide', () => {
        render(<RecapPlayer recap={payload({ slides: [s01, s02, s13(true, false)] })} nickname="ゆき" onClose={() => {}} />);
        for (let i = 0; i < 3; i += 1) {
            expect(document.body.textContent).not.toMatch(/%%%|％％％/);
            fireEvent.keyDown(window, { key: 'ArrowRight' });
        }
        expect(screen.getByText(/おやすみ、ゆき/)).toBeInTheDocument();
    });

    it('never prints null, undefined or 0 for missing fields', () => {
        render(<RecapPlayer recap={payload({ slides: [s02, s12] })} nickname="ゆき" onClose={() => {}} />);
        expect(document.body.textContent).not.toMatch(/null|undefined|NaN/);
    });
    it('plays the rhythm, photo and voice slides; the voice slide holds until its playback ends', () => {
        vi.useFakeTimers();
        const slides: RecapSlide[] = [
            { key: 's03_clock', fallback: null, data: clockData() },
            { key: 's04_greetings', fallback: null, data: greetingsData() },
            { key: 's05_photos', fallback: null, data: photosData() },
            { key: 's06_voice', fallback: null, data: voiceData() },
            s12,
        ];
        render(<RecapPlayer recap={payload({ slides })} nickname="ゆき" onClose={() => {}} />);
        expect(screen.getAllByTestId('recap-progress-segment')).toHaveLength(5);
        for (const key of ['s03_clock', 's04_greetings', 's05_photos']) {
            expect(current()).toBe(key);
            expect(document.body.textContent).not.toMatch(/%%%|null|undefined|NaN/);
            act(() => { vi.advanceTimersByTime(AUTO_ADVANCE_MS); });
        }
        expect(current()).toBe('s06_voice');
        act(() => { vi.advanceTimersByTime(AUTO_ADVANCE_MS * 3); });
        expect(current()).toBe('s06_voice');
        expect(screen.getByRole('button', { name: '声を聴く' })).toBeInTheDocument();
    });

    it('▶ in the real player plays without stepping, Space holds the voice, and the end advances once', () => {
        vi.useFakeTimers();
        const f = fakeAudioFactory();
        audio.factory = f;
        const slides: RecapSlide[] = [{ key: 's06_voice', fallback: null, data: voiceData() }, s12];
        render(<RecapPlayer recap={payload({ slides })} nickname="ゆき" onClose={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: '声を聴く' }));
        expect(current()).toBe('s06_voice');
        const [a, b] = f.made;
        expect(a.paused).toBe(false);
        fireEvent.keyDown(window, { key: ' ' });
        expect(a.paused).toBe(true);
        act(() => { vi.advanceTimersByTime(AUTO_ADVANCE_MS * 3); });
        expect(current()).toBe('s06_voice');
        fireEvent.keyDown(window, { key: ' ' });
        expect(a.paused).toBe(false);
        act(() => { a.tick(5.8); });
        act(() => { vi.advanceTimersByTime(CROSSFADE_MS); });
        act(() => { b.tick(5.8); });
        act(() => { vi.advanceTimersByTime(CROSSFADE_MS); });
        act(() => { a.tick(5.8); });
        act(() => { vi.advanceTimersByTime(CROSSFADE_MS); });
        expect(current()).toBe('s12_sentence');
        expect(playLogs().filter(([, x]) => x?.phase === 'step' && x?.reason === 'media')).toHaveLength(1);
    });

    it('takes focus when it opens, so its keys work after a click elsewhere in the app', () => {
        render(
            <>
                <button type="button">sidebar</button>
                <RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />
            </>,
        );
        const root = screen.getByTestId('recap-root');
        expect(document.activeElement).toBe(root);
        expect(root).toHaveAttribute('tabindex', '-1');
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
        expect(current()).toBe('s02_name');
    });

    it('the slide layer lets clicks through to the step zones', () => {
        render(<RecapPlayer recap={payload()} nickname="ゆき" onClose={() => {}} />);
        expect(screen.getByTestId('slide-s01_first').className).toMatch(/pointer-events-none/);
    });
});
