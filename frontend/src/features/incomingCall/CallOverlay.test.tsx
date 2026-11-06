import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { IncomingCall } from './useIncomingCall';
import { CallOverlay } from './CallOverlay';
import { persisted } from '../../core/persistence/persisted';
import { VOLUME_STORAGE_KEY } from '../../core/media/VoicePlayer';
import { groupRoles } from '../../design/tokens';

const SAKURA = groupRoles('sakurazaka').action;

const theme = { accentColor: '#7cc7e8', answerStyle: 'solid' as const, groupLabel: '日向坂46' };

const call = (over: Partial<IncomingCall> = {}): IncomingCall => ({
    phase: 'ringing',
    message: { id: 10, timestamp: '2026-11-01T10:00:00Z', type: 'voice', is_favorite: false, content: null },
    name: '金村 美玖', photoUrl: '/img/phone.jpg', audioUrl: '/api/content/media/x/a.m4a', talkStartedAt: null,
    answer: vi.fn(), decline: vi.fn(), hangUp: vi.fn(), onPlaybackEnded: vi.fn(), onPlaybackError: vi.fn(),
    ...over,
});

describe('CallOverlay', () => {
    it('renders no call UI when idle (only the empty live region)', () => {
        render(<CallOverlay call={call({ phase: 'idle', message: null })} {...theme} />);
        expect(screen.queryByTestId('call-overlay')).toBeNull();
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('lays out ambient backdrop, a 9:16 frame and a halo that follows the phase', () => {
        const { container, rerender } = render(
            <CallOverlay call={call()} accentColor={SAKURA} answerStyle="light" groupLabel="櫻坂46" />,
        );
        const overlay = screen.getByTestId('call-overlay');
        expect(overlay).toHaveClass('sd-call-overlay');
        expect(overlay.style.getPropertyValue('--sd-accent')).toBe(SAKURA);
        expect(container.querySelector('.sd-call-ambient')).toHaveStyle({ backgroundImage: 'url("/img/phone.jpg")' });
        expect(container.querySelector('.sd-call-stage .sd-call-frame .sd-call-screen')).not.toBeNull();
        expect(container.querySelector('.sd-call-halo')).toHaveAttribute('data-phase', 'ringing');
        expect(container.querySelector('.sd-call-screen')).toHaveAttribute('data-answer-style', 'light');
        expect(screen.getByText('櫻坂46')).toBeInTheDocument();
        rerender(<CallOverlay call={call({ phase: 'connected', talkStartedAt: Date.now() })} accentColor={SAKURA} answerStyle="light" groupLabel="櫻坂46" />);
        expect(container.querySelector('.sd-call-halo')).toHaveAttribute('data-phase', 'connected');
    });

    it('shows the final talk time on the ended screen', () => {
        vi.useFakeTimers();
        try {
            const start = Date.now();
            const { rerender } = render(<CallOverlay call={call({ phase: 'connected', talkStartedAt: start })} accentColor="#7cc7e8" answerStyle="solid" groupLabel="日向坂46" />);
            act(() => { vi.advanceTimersByTime(31_000); });
            rerender(<CallOverlay call={call({ phase: 'ended', talkStartedAt: start })} accentColor="#7cc7e8" answerStyle="solid" groupLabel="日向坂46" />);
            expect(screen.getByText('0:31')).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('Enter answers and Escape declines while ringing', () => {
        const c = call();
        render(<CallOverlay call={c} {...theme} />);
        fireEvent.keyDown(window, { key: 'Enter' });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(c.answer).toHaveBeenCalledTimes(1);
        expect(c.decline).toHaveBeenCalledTimes(1);
    });

    it('Escape hangs up while connected; Enter does nothing', () => {
        const c = call({ phase: 'connected', talkStartedAt: Date.now() });
        render(<CallOverlay call={c} {...theme} />);
        fireEvent.keyDown(window, { key: 'Enter' });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(c.answer).not.toHaveBeenCalled();
        expect(c.hangUp).toHaveBeenCalledTimes(1);
    });

    it('plays when connected and reports ended / error from the audio element', () => {
        const c = call({ phase: 'connected', talkStartedAt: Date.now() });
        render(<CallOverlay call={c} {...theme} />);
        const audio = screen.getByTestId('call-audio') as HTMLAudioElement;
        expect(audio.getAttribute('src')).toBe('/api/content/media/x/a.m4a');
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
        fireEvent(audio, new Event('ended'));
        fireEvent(audio, new Event('error'));
        expect(c.onPlaybackEnded).toHaveBeenCalledTimes(1);
        expect(c.onPlaybackError).toHaveBeenCalledTimes(1);
    });

    it('reports a playback error when play() rejects', async () => {
        // Swap by assignment: spy.mockRestore() would leave the global setup mock without its resolved value.
        const originalPlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = vi.fn().mockRejectedValueOnce(new Error('NotAllowedError'));
        try {
            const c = call({ phase: 'connected', talkStartedAt: Date.now() });
            render(<CallOverlay call={c} {...theme} />);
            await vi.waitFor(() => expect(c.onPlaybackError).toHaveBeenCalledTimes(1));
        } finally {
            HTMLMediaElement.prototype.play = originalPlay;
        }
    });

    it('pauses the audio when the call leaves connected', () => {
        const pause = vi.mocked(HTMLMediaElement.prototype.pause);
        const connected = call({ phase: 'connected', talkStartedAt: Date.now() });
        const { rerender } = render(<CallOverlay call={connected} {...theme} />);
        pause.mockClear();
        rerender(<CallOverlay call={{ ...connected, phase: 'ended' }} {...theme} />);
        expect(pause).toHaveBeenCalled();
    });

    describe('talk timer', () => {
        beforeEach(() => { vi.useFakeTimers(); });
        afterEach(() => { vi.useRealTimers(); });

        it('advances while connected and its interval is cleared when the call leaves connected', () => {
            const connected = call({ phase: 'connected', talkStartedAt: Date.now() });
            const { rerender } = render(<CallOverlay call={connected} {...theme} />);
            expect(screen.getByText('0:00')).toBeInTheDocument();
            act(() => { vi.advanceTimersByTime(3000); });
            expect(screen.getByText('0:03')).toBeInTheDocument();

            const withInterval = vi.getTimerCount();
            rerender(<CallOverlay call={{ ...connected, phase: 'ended' }} {...theme} />);
            expect(vi.getTimerCount()).toBe(withInterval - 1);
        });
    });

    it('keys are inert while the call has ended', () => {
        const c = call({ phase: 'ended', talkStartedAt: Date.now() });
        render(<CallOverlay call={c} {...theme} />);
        const notCancelled = fireEvent.keyDown(document.body, { key: 'Enter' });
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(notCancelled).toBe(true);
        expect(c.answer).not.toHaveBeenCalled();
        expect(c.decline).not.toHaveBeenCalled();
        expect(c.hangUp).not.toHaveBeenCalled();
    });

    describe('live region', () => {
        it('is one persistent element whose text follows the phase', () => {
            const ringing = call();
            const { rerender } = render(<CallOverlay call={call({ phase: 'idle', message: null })} {...theme} />);
            const region = screen.getByRole('status');
            expect(region).toHaveAttribute('aria-live', 'polite');
            expect(region).toBeEmptyDOMElement();

            rerender(<CallOverlay call={ringing} {...theme} />);
            expect(screen.getByRole('status')).toBe(region);
            expect(region).toHaveTextContent('金村 美玖');
            expect(region).toHaveTextContent('Incoming call…');

            rerender(<CallOverlay call={{ ...ringing, phase: 'connected', talkStartedAt: Date.now() }} {...theme} />);
            expect(region).toBeEmptyDOMElement();

            rerender(<CallOverlay call={{ ...ringing, phase: 'ended', talkStartedAt: Date.now() }} {...theme} />);
            expect(screen.getByRole('status')).toBe(region);
            expect(region).toHaveTextContent('Call ended');
        });
    });

    it('labels the overlay as a dialog named after the caller', () => {
        render(<CallOverlay call={call()} {...theme} />);
        const dialog = screen.getByRole('dialog', { name: '金村 美玖' });
        expect(dialog).toBe(screen.getByTestId('call-overlay'));
    });

    describe('keyboard handling', () => {
        it('Enter on a focused Decline button is left to the button (not answered, not cancelled)', () => {
            const c = call();
            render(<CallOverlay call={c} {...theme} />);
            const decline = screen.getByRole('button', { name: /decline/i });
            decline.focus();
            fireEvent.keyDown(decline, { key: 'Enter' });
            expect(c.answer).not.toHaveBeenCalled();
            // Native activation is left to the browser: the key event was not cancelled.
            expect(fireEvent.keyDown(decline, { key: 'Enter' })).toBe(true);
        });

        describe('focus on ring', () => {
            const idle = () => call({ phase: 'idle', message: null });

            it('moves focus from an outside button to the overlay; Enter then answers', () => {
                const c = call();
                const { rerender } = render(<div><button data-testid="outside">m</button><CallOverlay call={idle()} {...theme} /></div>);
                const outside = screen.getByTestId('outside');
                outside.focus();
                expect(document.activeElement).toBe(outside);
                rerender(<div><button data-testid="outside">m</button><CallOverlay call={c} {...theme} /></div>);
                expect(document.activeElement).toBe(screen.getByTestId('call-overlay'));
                fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
                expect(c.answer).toHaveBeenCalledTimes(1);
            });

            it('moves focus from an outside button to the overlay; Escape then declines', () => {
                const c = call();
                const { rerender } = render(<div><button data-testid="outside">m</button><CallOverlay call={idle()} {...theme} /></div>);
                screen.getByTestId('outside').focus();
                rerender(<div><button data-testid="outside">m</button><CallOverlay call={c} {...theme} /></div>);
                expect(document.activeElement).toBe(screen.getByTestId('call-overlay'));
                fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
                expect(c.decline).toHaveBeenCalledTimes(1);
            });

            it('takes focus from a focusable ancestor that contains the overlay; Escape declines', () => {
                const c = call();
                const tree = (call_: IncomingCall) => <div tabIndex={0} data-testid="timeline"><CallOverlay call={call_} {...theme} /></div>;
                const { rerender } = render(tree(idle()));
                const timeline = screen.getByTestId('timeline');
                timeline.focus();
                expect(document.activeElement).toBe(timeline);
                rerender(tree(c));
                expect(document.activeElement).toBe(screen.getByTestId('call-overlay'));
                fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
                expect(c.decline).toHaveBeenCalledTimes(1);
            });

            it('does not steal focus from an editable element; Enter there does not answer', () => {
                const c = call();
                const tree = (call_: IncomingCall) => <div><input data-testid="search" /><CallOverlay call={call_} {...theme} /></div>;
                const { rerender } = render(tree(idle()));
                const input = screen.getByTestId('search');
                input.focus();
                rerender(tree(c));
                expect(document.activeElement).toBe(input);
                fireEvent.keyDown(input, { key: 'Enter' });
                expect(c.answer).not.toHaveBeenCalled();
            });

            it('does not steal focus from an element inside another modal dialog', () => {
                const c = call();
                const tree = (call_: IncomingCall) => (
                    <div>
                        <div role="dialog" aria-modal="true" aria-label="settings">
                            <button data-testid="in-modal">ok</button>
                        </div>
                        <CallOverlay call={call_} {...theme} />
                    </div>
                );
                const { rerender } = render(tree(idle()));
                const inModal = screen.getByTestId('in-modal');
                inModal.focus();
                rerender(tree(c));
                expect(document.activeElement).toBe(inModal);
                fireEvent.keyDown(inModal, { key: 'Escape' });
                expect(c.decline).not.toHaveBeenCalled();
            });
        });

        it('ignores Enter / Escape from an input outside the overlay', () => {
            const c = call();
            render(<div><input data-testid="search" /><CallOverlay call={c} {...theme} /></div>);
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
                    <CallOverlay call={c} {...theme} />
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
            render(<CallOverlay call={c} {...theme} />);
            const stop = (e: Event) => e.preventDefault();
            document.body.addEventListener('keydown', stop);
            fireEvent.keyDown(document.body, { key: 'Escape' });
            document.body.removeEventListener('keydown', stop);
            expect(c.decline).not.toHaveBeenCalled();
        });

        it.each(['ctrlKey', 'altKey', 'metaKey', 'shiftKey'] as const)('ignores Enter with %s held', mod => {
            const c = call();
            render(<CallOverlay call={c} {...theme} />);
            fireEvent.keyDown(document.body, { key: 'Enter', [mod]: true });
            expect(c.answer).not.toHaveBeenCalled();
        });

        it('ignores Enter while an IME composition is in progress', () => {
            const c = call();
            render(<CallOverlay call={c} {...theme} />);
            fireEvent.keyDown(document.body, { key: 'Enter', isComposing: true });
            fireEvent.keyDown(document.body, { key: 'Enter', keyCode: 229 });
            expect(c.answer).not.toHaveBeenCalled();
        });

        it('still answers / declines when the key comes from the body', () => {
            const c = call();
            render(<CallOverlay call={c} {...theme} />);
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
            const { rerender } = render(<CallOverlay call={first} {...theme} />);
            const firstAudio = screen.getByTestId('call-audio');
            expect(gains[gains.length - 1]?.value).toBeCloseTo(0.4);

            rerender(<CallOverlay call={call({ phase: 'idle', message: null })} {...theme} />);
            persisted.setPref(VOLUME_STORAGE_KEY, '0.8');
            rerender(<CallOverlay call={call({ message: { ...first.message!, id: 11 } })} {...theme} />);

            expect(screen.getByTestId('call-audio')).not.toBe(firstAudio);
            expect(gains[gains.length - 1]?.value).toBeCloseTo(1.6);
        });
    });

    it('takes the context accent when no colour is passed', () => {
        render(<CallOverlay call={call()} answerStyle="solid" groupLabel="日向坂46" />);
        expect(screen.getByTestId('call-overlay').style.getPropertyValue('--sd-accent')).toBe('var(--ds-accent)');
    });
});
