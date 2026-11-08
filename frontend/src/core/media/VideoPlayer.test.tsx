import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import i18n from '../../i18n';
import { VideoPlayer } from './VideoPlayer';
import { clientLog } from '../../utils/clientLog';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

beforeAll(async () => { await i18n.changeLanguage('en'); });

function escape(): KeyboardEvent {
    return new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
}

function openMenu(container: HTMLElement) {
    const menuButton = container.querySelector('button.text-white\\/60')!;
    fireEvent.click(menuButton);
}

describe('VideoPlayer menu Escape', () => {
    beforeEach(() => {
        window.HTMLMediaElement.prototype.play = (() => Promise.resolve()) as never;
        window.HTMLMediaElement.prototype.pause = (() => undefined) as never;
        window.HTMLMediaElement.prototype.load = (() => undefined) as never;
    });

    it('claims Escape (defaultPrevented) when it closes the open menu', () => {
        const { container } = render(<VideoPlayer src="/api/media/v.mp4" />);
        openMenu(container);
        expect(screen.getByText('Loop')).toBeInTheDocument();

        const ev = escape();
        act(() => { document.dispatchEvent(ev); });

        expect(ev.defaultPrevented).toBe(true);
        expect(screen.queryByText('Loop')).toBeNull();
    });

    it('leaves Escape unclaimed when no menu is open', () => {
        render(<VideoPlayer src="/api/media/v.mp4" />);
        const ev = escape();
        act(() => { document.dispatchEvent(ev); });
        expect(ev.defaultPrevented).toBe(false);
    });

    it('ignores other keys while the menu is open', () => {
        const { container } = render(<VideoPlayer src="/api/media/v.mp4" />);
        openMenu(container);
        const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
        act(() => { document.dispatchEvent(ev); });
        expect(ev.defaultPrevented).toBe(false);
        expect(screen.getByText('Loop')).toBeInTheDocument();
    });
});

describe('VideoPlayer shortcuts', () => {
    beforeEach(() => {
        window.HTMLMediaElement.prototype.play = (() => Promise.resolve()) as never;
        window.HTMLMediaElement.prototype.pause = (() => undefined) as never;
        window.HTMLMediaElement.prototype.load = (() => undefined) as never;
    });

    it('does not run player shortcuts for keys pressed inside its menu', () => {
        const { container } = render(<VideoPlayer src="/api/media/v.mp4" viewerMode />);
        openMenu(container);
        const item = screen.getByRole('menuitemradio', { name: '1x' });
        for (const key of ['m', 'f']) {
            const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
            act(() => { item.dispatchEvent(ev); });
            expect(ev.defaultPrevented).toBe(false);
        }
    });

    it('still runs the shortcut outside the menu', () => {
        render(<VideoPlayer src="/api/media/v.mp4" viewerMode />);
        const ev = new KeyboardEvent('keydown', { key: 'm', bubbles: true, cancelable: true });
        act(() => { document.body.dispatchEvent(ev); });
        expect(ev.defaultPrevented).toBe(true);
    });
});

describe('VideoPlayer media lifecycle', () => {
    let play: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.mocked(clientLog).mockClear();
        play = vi.fn(() => Promise.resolve());
        window.HTMLMediaElement.prototype.play = play as never;
        window.HTMLMediaElement.prototype.pause = vi.fn() as never;
        window.HTMLMediaElement.prototype.load = vi.fn() as never;
    });

    const video = (container: HTMLElement) => container.querySelector('video') as HTMLVideoElement;

    it('binds the source and releases the element on unmount', () => {
        const { container, unmount } = render(<VideoPlayer src="/api/media/v.mp4" />);
        const el = video(container);
        expect(el.getAttribute('src')).toBe('/api/media/v.mp4');
        unmount();
        expect(el.getAttribute('src')).toBeNull();
        expect(el.pause).toHaveBeenCalled();
        expect(el.load).toHaveBeenCalledTimes(1);
    });

    it('releases the old source before switching to a new one', () => {
        const { container, rerender } = render(<VideoPlayer src="/api/media/a.mp4" />);
        const el = video(container);
        const srcAtLoad: Array<string | null> = [];
        vi.mocked(el.load).mockImplementation(() => { srcAtLoad.push(el.getAttribute('src')); });
        rerender(<VideoPlayer src="/api/media/b.mp4" />);
        expect(srcAtLoad).toEqual([null]);
        expect(el.getAttribute('src')).toBe('/api/media/b.mp4');
    });

    it('shows a spinner while waiting for data and logs the episode once', () => {
        const { container } = render(<VideoPlayer src="/api/media/v.mp4" />);
        const el = video(container);
        act(() => { el.dispatchEvent(new Event('waiting')); });
        act(() => { el.dispatchEvent(new Event('waiting')); });
        expect(screen.getByRole('status', { name: 'Loading...' })).toBeInTheDocument();
        const spinner = screen.getByTestId('video-buffering').querySelector('svg')!;
        expect(spinner).toHaveClass('animate-spin', 'motion-reduce:animate-none', 'text-viewer');
        expect(vi.mocked(clientLog).mock.calls.filter(([, f]) => f?.phase === 'waiting')).toHaveLength(1);
        expect(clientLog).toHaveBeenCalledWith('media_playback', expect.objectContaining({
            phase: 'waiting', surface: 'video', ready_state: expect.any(Number), network_state: expect.any(Number), error_code: 0,
        }));

        act(() => { el.dispatchEvent(new Event('canplay')); });
        expect(screen.queryByTestId('video-buffering')).toBeNull();
        expect(clientLog).toHaveBeenCalledWith('media_playback', expect.objectContaining({ phase: 'recovered', reason: 'waiting' }));
    });

    it('pausing while buffering hides the spinner', () => {
        const { container } = render(<VideoPlayer src="/api/media/v.mp4" />);
        const el = video(container);
        act(() => { el.dispatchEvent(new Event('waiting')); });
        expect(screen.getByTestId('video-buffering')).toBeInTheDocument();
        act(() => { el.dispatchEvent(new Event('pause')); });
        expect(screen.queryByTestId('video-buffering')).toBeNull();
    });

    it('never puts the URL in a breadcrumb', () => {
        const { container } = render(<VideoPlayer src="/api/media/秘密の動画.mp4" />);
        act(() => { video(container).dispatchEvent(new Event('error')); });
        const logged = JSON.stringify(vi.mocked(clientLog).mock.calls);
        expect(logged).not.toContain('mp4');
        expect(logged).not.toContain('秘密');
    });

    it('a stalled fetch while paused logs but does not spin', () => {
        const { container } = render(<VideoPlayer src="/api/media/v.mp4" />);
        act(() => { video(container).dispatchEvent(new Event('stalled')); });
        expect(screen.queryByTestId('video-buffering')).toBeNull();
        expect(clientLog).toHaveBeenCalledWith('media_playback', expect.objectContaining({ phase: 'stalled', outcome: 'paused' }));
    });

    it('shows a neutral error with a Retry that reloads and plays at the same position', () => {
        const { container } = render(<VideoPlayer src="/api/media/v.mp4" />);
        const el = video(container);
        act(() => { el.dispatchEvent(new Event('error')); });
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent("This video couldn't be played.");
        expect(alert).toHaveClass('bg-viewer-scrim', 'text-viewer');
        expect(alert.className).not.toMatch(/danger/);
        expect(clientLog).toHaveBeenCalledWith('media_playback', expect.objectContaining({ phase: 'error', surface: 'video' }));
        // The big play button gives way to the error.
        expect(container.querySelector('button.absolute.inset-0')).toBeNull();

        el.currentTime = 12;
        vi.mocked(el.load).mockClear();
        play.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(el.load).toHaveBeenCalledTimes(1);
        expect(el.currentTime).toBe(12);
        expect(play).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(clientLog).toHaveBeenCalledWith('media_playback', expect.objectContaining({ phase: 'retry' }));

        // A repeat failure logs again.
        act(() => { el.dispatchEvent(new Event('error')); });
        expect(vi.mocked(clientLog).mock.calls.filter(([, f]) => f?.phase === 'error')).toHaveLength(2);
    });

    it('logs a rejected play() instead of swallowing it', async () => {
        play.mockImplementation(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')));
        render(<VideoPlayer src="/api/media/v.mp4" autoPlay />);
        await act(async () => { await Promise.resolve(); });
        expect(clientLog).toHaveBeenCalledWith('media_playback', expect.objectContaining({
            phase: 'play_rejected', surface: 'video', error_type: 'notallowederror',
        }));
    });

    it('logs a rejected play() from the play button too', async () => {
        play.mockImplementation(() => Promise.reject(new DOMException('unsupported', 'NotSupportedError')));
        const { container } = render(<VideoPlayer src="/api/media/v.mp4" />);
        await act(async () => { fireEvent.click(container.querySelector('button.absolute.inset-0')!); });
        expect(clientLog).toHaveBeenCalledWith('media_playback', expect.objectContaining({ phase: 'play_rejected', error_type: 'notsupportederror' }));
    });

    it('does not log a play() superseded by a release as a failure', async () => {
        play.mockImplementation(() => Promise.reject(new DOMException('aborted', 'AbortError')));
        const { container } = render(<VideoPlayer src="/api/media/v.mp4" />);
        await act(async () => { fireEvent.click(container.querySelector('button.absolute.inset-0')!); });
        expect(vi.mocked(clientLog).mock.calls.filter(([, f]) => f?.phase === 'play_rejected')).toHaveLength(0);
    });

    describe('buffering accuracy', () => {
        const state = (el: HTMLVideoElement, readyState: number, paused: boolean) => {
            Object.defineProperty(el, 'readyState', { configurable: true, value: readyState });
            Object.defineProperty(el, 'paused', { configurable: true, value: paused });
        };

        it('a stall while playing with buffered data does not spin', () => {
            const { container } = render(<VideoPlayer src="/api/media/v.mp4" />);
            const el = video(container);
            state(el, 4, false);
            act(() => { el.dispatchEvent(new Event('stalled')); });
            expect(screen.queryByTestId('video-buffering')).toBeNull();
        });

        it('a starved stall spins until progress reports buffered data', () => {
            const { container } = render(<VideoPlayer src="/api/media/v.mp4" />);
            const el = video(container);
            state(el, 2, false);
            act(() => { el.dispatchEvent(new Event('stalled')); });
            expect(screen.getByTestId('video-buffering')).toBeInTheDocument();
            state(el, 4, false);
            act(() => { el.dispatchEvent(new Event('progress')); });
            expect(screen.queryByTestId('video-buffering')).toBeNull();
            expect(clientLog).toHaveBeenCalledWith('media_playback', expect.objectContaining({ phase: 'recovered', reason: 'stalled' }));
        });

        it('emptied does not clear a visible error', () => {
            const { container } = render(<VideoPlayer src="/api/media/v.mp4" />);
            const el = video(container);
            act(() => { el.dispatchEvent(new Event('error')); });
            act(() => { el.dispatchEvent(new Event('emptied')); });
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });

        it('logs the first 3 waiting episodes, then one summary with the count', () => {
            const { container, unmount } = render(<VideoPlayer src="/api/media/v.mp4" />);
            const el = video(container);
            for (let i = 0; i < 5; i++) {
                act(() => { el.dispatchEvent(new Event('waiting')); });
                act(() => { el.dispatchEvent(new Event('canplay')); });
            }
            const phases = () => vi.mocked(clientLog).mock.calls.map(([, f]) => f?.phase);
            expect(phases().filter((p) => p === 'waiting')).toHaveLength(3);
            expect(phases().filter((p) => p === 'recovered')).toHaveLength(3);
            expect(phases()).not.toContain('summary');
            unmount();
            expect(clientLog).toHaveBeenCalledWith('media_playback', expect.objectContaining({ phase: 'summary', count: 5 }));
        });
    });

    it('creates no AudioContext until the video plays', () => {
        const created = vi.fn();
        const Real = globalThis.AudioContext;
        globalThis.AudioContext = class extends (Real as unknown as { new(): object }) {
            constructor() { super(); created(); }
        } as unknown as typeof AudioContext;
        try {
            const { container } = render(<VideoPlayer src="/api/media/v.mp4" />);
            expect(created).not.toHaveBeenCalled();
            fireEvent.click(container.querySelector('button.absolute.inset-0')!);
            expect(created).toHaveBeenCalledTimes(1);
        } finally {
            globalThis.AudioContext = Real;
        }
    });
});
