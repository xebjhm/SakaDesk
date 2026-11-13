import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import i18n from '../../i18n';
import { mockFocusVisible } from '../../__tests__/focusVisible';
import { clientLog } from '../../utils/clientLog';
import { VoicePlayer } from './VoicePlayer';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

const SRC = '/api/content/media/hinatazaka46/v.m4a';

describe('VoicePlayer accessible controls (UI health #7)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => { vi.mocked(clientLog).mockClear(); });
    afterEach(() => vi.restoreAllMocks());

    it('names the inline controls and describes the ranges', () => {
        render(<VoicePlayer src={SRC} />);
        expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Mute/ })).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('aria-valuetext', '0:00 of 0:00');
        expect(screen.getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuetext', expect.stringMatching(/%$/));
    });

    it('shows the volume slider while it has keyboard focus', () => {
        mockFocusVisible(true);
        render(<VoicePlayer src={SRC} />);
        const volume = screen.getByRole('slider', { name: 'Volume' });
        act(() => volume.focus());
        expect(volume.parentElement).toHaveClass('opacity-100');
    });

    it('keeps the hover behaviour after a mouse focus (no slider held open)', () => {
        mockFocusVisible(false);
        render(<VoicePlayer src={SRC} />);
        const volume = screen.getByRole('slider', { name: 'Volume' });
        act(() => volume.focus());
        expect(volume.parentElement).not.toHaveClass('opacity-100');
    });

    it('rings a seek bar only for keyboard focus', () => {
        render(<VoicePlayer src={SRC} />);
        const bar = screen.getByRole('slider', { name: 'Playback position' }).closest('.h-1');
        expect(bar).toHaveClass('has-[:focus-visible]:ring-2', 'has-[:focus-visible]:ring-accent', 'ring-offset-0');
        expect(bar?.className).not.toMatch(/focus-within:/);
    });

    it('adds no window key listener for an inline bubble', () => {
        const spy = vi.spyOn(window, 'addEventListener');
        render(<VoicePlayer src={SRC} />);
        expect(spy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
    });

    it('names the skip buttons in the viewer card', () => {
        render(<VoicePlayer src={SRC} variant="premium" viewerMode />);
        expect(screen.getByRole('button', { name: /Back 5 seconds/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Forward 5 seconds/ })).toBeInTheDocument();
    });

    it('handles M on the inline box itself but not on a button inside it', () => {
        const { container } = render(<VoicePlayer src={SRC} />);
        const box = container.firstElementChild as HTMLElement;
        const mute = screen.getByRole('button', { name: /Mute/ });
        fireEvent.keyDown(mute, { key: 'm' });
        expect(screen.getByRole('button', { name: /Mute/ })).toBeInTheDocument();
        fireEvent.keyDown(box, { key: 'm' });
        expect(screen.getByRole('button', { name: /Unmute/ })).toBeInTheDocument();
    });

    it('captures no keys on the window while the inline bubble is not viewer mode', () => {
        render(<VoicePlayer src={SRC} />);
        fireEvent.keyDown(window, { key: 'm' });
        expect(screen.getByRole('button', { name: /^Mute/ })).toBeInTheDocument();
    });

    it('releases the slider 300 ms after keyboard focus leaves', () => {
        vi.useFakeTimers();
        try {
            const kb = mockFocusVisible(true);
            render(<VoicePlayer src={SRC} />);
            const volume = screen.getByRole('slider', { name: 'Volume' });
            act(() => volume.focus());
            expect(volume.parentElement).toHaveClass('opacity-100');
            act(() => volume.blur());
            act(() => { vi.advanceTimersByTime(400); });
            expect(volume.parentElement).not.toHaveClass('opacity-100');
            kb.mockRestore();
        } finally {
            vi.useRealTimers();
        }
    });

    it('logs the keyboard decisions once per player, with codes only', () => {
        mockFocusVisible(true);
        render(<VoicePlayer src={SRC} />);
        const volume = screen.getByRole('slider', { name: 'Volume' });
        act(() => volume.focus());
        act(() => volume.blur());
        act(() => volume.focus());
        const opened = vi.mocked(clientLog).mock.calls.filter(c => c[1]?.outcome === 'opened_by_focus');
        expect(opened).toHaveLength(1);
        expect(opened[0]).toEqual(['media_playback', { surface: 'voice', phase: 'volume', outcome: 'opened_by_focus' }]);

        const viewer = render(<VoicePlayer src={SRC} variant="premium" viewerMode />);
        const mute = within(viewer.container).getByRole('button', { name: /Mute/ });
        fireEvent.keyDown(mute, { key: ' ' });
        fireEvent.keyDown(mute, { key: ' ' });
        const skipped = vi.mocked(clientLog).mock.calls.filter(c => c[1]?.outcome === 'space_left_to_button');
        expect(skipped).toHaveLength(1);
    });
});
