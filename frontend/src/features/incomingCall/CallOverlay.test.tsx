import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { IncomingCall } from './useIncomingCall';
import { CallOverlay } from './CallOverlay';
import { persisted } from '../../core/persistence/persisted';
import { VOLUME_STORAGE_KEY } from '../../core/media/VoicePlayer';

const call = (over: Partial<IncomingCall> = {}): IncomingCall => ({
    phase: 'ringing',
    message: { id: 10, timestamp: '2026-11-01T10:00:00Z', type: 'voice', is_favorite: false, content: null },
    name: '金村 美玖', photoUrl: '/img/phone.jpg', audioUrl: '/api/content/media/x/a.m4a', talkStartedAt: null,
    answer: vi.fn(), decline: vi.fn(), hangUp: vi.fn(), onPlaybackEnded: vi.fn(), onPlaybackError: vi.fn(),
    ...over,
});

describe('CallOverlay', () => {
    it('renders nothing when idle', () => {
        const { container } = render(<CallOverlay call={call({ phase: 'idle', message: null })} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('Enter answers and Escape declines while ringing', () => {
        const c = call();
        render(<CallOverlay call={c} />);
        fireEvent.keyDown(window, { key: 'Enter' });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(c.answer).toHaveBeenCalledTimes(1);
        expect(c.decline).toHaveBeenCalledTimes(1);
    });

    it('Escape hangs up while connected; Enter does nothing', () => {
        const c = call({ phase: 'connected', talkStartedAt: Date.now() });
        render(<CallOverlay call={c} />);
        fireEvent.keyDown(window, { key: 'Enter' });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(c.answer).not.toHaveBeenCalled();
        expect(c.hangUp).toHaveBeenCalledTimes(1);
    });

    it('plays when connected and reports ended / error from the audio element', () => {
        const c = call({ phase: 'connected', talkStartedAt: Date.now() });
        render(<CallOverlay call={c} />);
        const audio = screen.getByTestId('call-audio') as HTMLAudioElement;
        expect(audio.getAttribute('src')).toBe('/api/content/media/x/a.m4a');
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
        fireEvent(audio, new Event('ended'));
        fireEvent(audio, new Event('error'));
        expect(c.onPlaybackEnded).toHaveBeenCalledTimes(1);
        expect(c.onPlaybackError).toHaveBeenCalledTimes(1);
    });

    it('reports a playback error when play() rejects', async () => {
        const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValueOnce(new Error('NotAllowedError'));
        const c = call({ phase: 'connected', talkStartedAt: Date.now() });
        render(<CallOverlay call={c} />);
        await vi.waitFor(() => expect(c.onPlaybackError).toHaveBeenCalledTimes(1));
        play.mockRestore();
    });

    it('labels the overlay as a dialog named after the caller, with a polite live status', () => {
        render(<CallOverlay call={call()} />);
        const dialog = screen.getByRole('dialog', { name: '金村 美玖' });
        expect(dialog).toBe(screen.getByTestId('call-overlay'));
        expect(dialog.querySelector('[aria-live="polite"]')).not.toBeNull();
    });

    describe('keyboard handling', () => {
        it('Enter on the focused Decline button declines instead of answering', () => {
            const c = call();
            render(<CallOverlay call={c} />);
            const decline = screen.getByRole('button', { name: /decline/i });
            decline.focus();
            fireEvent.keyDown(decline, { key: 'Enter' });
            expect(c.answer).not.toHaveBeenCalled();
            // Native activation is left to the browser: the key event was not cancelled.
            expect(fireEvent.keyDown(decline, { key: 'Enter' })).toBe(true);
        });

        it('ignores Enter / Escape from an input outside the overlay', () => {
            const c = call();
            render(<div><input data-testid="search" /><CallOverlay call={c} /></div>);
            const input = screen.getByTestId('search');
            input.focus();
            fireEvent.keyDown(input, { key: 'Enter' });
            fireEvent.keyDown(input, { key: 'Escape' });
            expect(c.answer).not.toHaveBeenCalled();
            expect(c.decline).not.toHaveBeenCalled();
        });

        it('does not decline on Escape while a modal outside the overlay has focus', () => {
            const c = call();
            render(
                <div>
                    <div role="dialog" aria-label="modal" tabIndex={-1} data-testid="modal" />
                    <CallOverlay call={c} />
                </div>,
            );
            const modal = screen.getByTestId('modal');
            modal.focus();
            fireEvent.keyDown(modal, { key: 'Escape' });
            expect(c.decline).not.toHaveBeenCalled();
            expect(c.hangUp).not.toHaveBeenCalled();
        });

        it('ignores keys another handler already handled', () => {
            const c = call();
            render(<CallOverlay call={c} />);
            const stop = (e: Event) => e.preventDefault();
            document.body.addEventListener('keydown', stop);
            fireEvent.keyDown(document.body, { key: 'Escape' });
            document.body.removeEventListener('keydown', stop);
            expect(c.decline).not.toHaveBeenCalled();
        });

        it.each(['ctrlKey', 'altKey', 'metaKey', 'shiftKey'] as const)('ignores Enter with %s held', mod => {
            const c = call();
            render(<CallOverlay call={c} />);
            fireEvent.keyDown(document.body, { key: 'Enter', [mod]: true });
            expect(c.answer).not.toHaveBeenCalled();
        });

        it('ignores Enter while an IME composition is in progress', () => {
            const c = call();
            render(<CallOverlay call={c} />);
            fireEvent.keyDown(document.body, { key: 'Enter', isComposing: true });
            fireEvent.keyDown(document.body, { key: 'Enter', keyCode: 229 });
            expect(c.answer).not.toHaveBeenCalled();
        });

        it('still answers / declines when the key comes from the body', () => {
            const c = call();
            render(<CallOverlay call={c} />);
            fireEvent.keyDown(document.body, { key: 'Enter' });
            fireEvent.keyDown(document.body, { key: 'Escape' });
            expect(c.answer).toHaveBeenCalledTimes(1);
            expect(c.decline).toHaveBeenCalledTimes(1);
        });
    });

    describe('call audio volume', () => {
        const gains: Array<{ value: number }> = [];
        const realAudioContext = globalThis.AudioContext;
        beforeEach(() => {
            gains.length = 0;
            class CapturingContext {
                destination = {};
                state = 'running';
                createMediaElementSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
                createGain = vi.fn(() => {
                    const gain = { value: 1 };
                    gains.push(gain);
                    return { gain, connect: vi.fn(), disconnect: vi.fn() };
                });
                close = vi.fn(() => { this.state = 'closed'; return Promise.resolve(); });
                resume = vi.fn(() => Promise.resolve());
            }
            globalThis.AudioContext = CapturingContext as unknown as typeof AudioContext;
        });
        afterEach(() => { globalThis.AudioContext = realAudioContext; });

        it('a volume change between two calls is applied to the second call', () => {
            persisted.setPref(VOLUME_STORAGE_KEY, '0.2');
            const first = call();
            const { rerender } = render(<CallOverlay call={first} />);
            const firstAudio = screen.getByTestId('call-audio');
            expect(gains[gains.length - 1]?.value).toBeCloseTo(0.4);

            rerender(<CallOverlay call={call({ phase: 'idle', message: null })} />);
            persisted.setPref(VOLUME_STORAGE_KEY, '0.8');
            rerender(<CallOverlay call={call({ message: { ...first.message!, id: 11 } })} />);

            expect(screen.getByTestId('call-audio')).not.toBe(firstAudio);
            expect(gains[gains.length - 1]?.value).toBeCloseTo(1.6);
        });
    });
});
