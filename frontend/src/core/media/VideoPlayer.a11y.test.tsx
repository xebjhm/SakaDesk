import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { mockFocusVisible } from '../../__tests__/focusVisible';
import { clientLog } from '../../utils/clientLog';
import { VideoPlayer } from './VideoPlayer';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

describe('VideoPlayer accessible controls (UI health #7)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => { vi.mocked(clientLog).mockClear(); });

    it('names every control and describes the ranges', () => {
        render(<VideoPlayer src="/api/content/media/hinatazaka46/v.mp4" />);
        expect(screen.getAllByRole('button', { name: 'Play' })).toHaveLength(2); // the big centre button and the bar's
        expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument();
        const seek = screen.getByRole('slider', { name: 'Playback position' });
        expect(seek).toHaveAttribute('aria-valuetext', '0:00 of 0:00');
        expect(screen.getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuetext', expect.stringMatching(/^\d+%$/));
    });

    it('rings the bar only while the seek range has keyboard focus', () => {
        render(<VideoPlayer src="/api/content/media/hinatazaka46/v.mp4" />);
        const seek = screen.getByRole('slider', { name: 'Playback position' });
        // has-[:focus-visible]: a range keeps focus after a mouse seek, so focus-within would ring it then.
        expect(seek.parentElement).toHaveClass('has-[:focus-visible]:ring-2', 'has-[:focus-visible]:ring-accent', 'ring-offset-0');
        expect(seek.parentElement?.className).not.toMatch(/focus-within:/);
    });

    it('marks the subtitles toggle as pressed or not', () => {
        render(<VideoPlayer src="/api/content/media/hinatazaka46/v.mp4" variant="gallery" transcriptionSegments={[{ start: 0, end: 1, text: 'あ', confidence: 1 }]} />);
        expect(screen.getByRole('button', { name: 'Subtitles' })).toHaveAttribute('aria-pressed');
    });

    it('shows a keyboard focus ring on every bar control', () => {
        render(<VideoPlayer src="/api/content/media/hinatazaka46/v.mp4" variant="gallery" transcriptionSegments={[{ start: 0, end: 1, text: 'あ', confidence: 1 }]} />);
        const names = ['Play', 'Mute', 'Full screen', 'Subtitles', 'More options'];
        const buttons = names.flatMap(n => screen.getAllByRole('button', { name: n }));
        expect(buttons.length).toBeGreaterThanOrEqual(6);
        for (const b of buttons) expect(b, b.getAttribute('aria-label') ?? '').toHaveClass('focus-visible:ring-2', 'focus-visible:ring-accent');
    });

    describe('controls while playing', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            window.HTMLMediaElement.prototype.play = (() => Promise.resolve()) as never;
            window.HTMLMediaElement.prototype.pause = (() => undefined) as never;
            window.HTMLMediaElement.prototype.load = (() => undefined) as never;
        });
        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        const start = () => {
            const { container } = render(<VideoPlayer src="/api/content/media/hinatazaka46/v.mp4" />);
            fireEvent.play(container.querySelector('video')!);
            const mute = screen.getByRole('button', { name: 'Mute' });
            return { mute, bar: () => mute.closest('.transition-opacity') };
        };

        it('still hide after a mouse click on a control', () => {
            mockFocusVisible(false);
            const { mute, bar } = start();
            act(() => mute.focus());
            fireEvent.mouseMove(mute);
            act(() => { vi.advanceTimersByTime(900); });
            expect(bar()).toHaveClass('opacity-0');
        });

        it('stay while keyboard focus is on a control, and say so once', () => {
            mockFocusVisible(true);
            const { mute, bar } = start();
            act(() => mute.focus());
            act(() => { vi.advanceTimersByTime(900); });
            expect(bar()).toHaveClass('opacity-100');
            act(() => { fireEvent.mouseMove(mute); vi.advanceTimersByTime(900); });
            const held = vi.mocked(clientLog).mock.calls.filter(c => c[1]?.outcome === 'held_by_focus');
            expect(held).toHaveLength(1);
            expect(held[0]).toEqual(['media_playback', { surface: 'video', phase: 'controls', outcome: 'held_by_focus' }]);
        });

        it('reappear when keyboard focus moves onto a hidden control', () => {
            mockFocusVisible(false);
            const { mute, bar } = start();
            fireEvent.mouseMove(mute);
            act(() => { vi.advanceTimersByTime(900); });
            expect(bar()).toHaveClass('opacity-0');
            mockFocusVisible(true);
            act(() => mute.focus());
            expect(bar()).toHaveClass('opacity-100');
        });

        it('hide again once keyboard focus leaves the player', () => {
            mockFocusVisible(true);
            const { mute, bar } = start();
            act(() => mute.focus());
            act(() => { vi.advanceTimersByTime(900); });
            expect(bar()).toHaveClass('opacity-100');
            act(() => mute.blur());
            act(() => { vi.advanceTimersByTime(900); });
            expect(bar()).toHaveClass('opacity-0');
        });

        it('leaves Space to a focused button in viewer mode but toggles play elsewhere', () => {
            const play = vi.fn(() => Promise.resolve());
            window.HTMLMediaElement.prototype.play = play as never;
            const { container } = render(<VideoPlayer src="/api/content/media/hinatazaka46/v.mp4" viewerMode />);
            const mute = screen.getByRole('button', { name: 'Mute' });
            act(() => mute.focus());
            const onButton = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
            mute.dispatchEvent(onButton);
            expect(onButton.defaultPrevented).toBe(false);
            expect(play).not.toHaveBeenCalled();
            mute.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
            const skipped = vi.mocked(clientLog).mock.calls.filter(c => c[1]?.outcome === 'space_left_to_button');
            expect(skipped).toEqual([['media_playback', { surface: 'video', phase: 'shortcut', outcome: 'space_left_to_button' }]]);
            const onBody = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
            container.ownerDocument.body.dispatchEvent(onBody);
            expect(onBody.defaultPrevented).toBe(true);
            expect(play).toHaveBeenCalledTimes(1);
        });
    });
});
