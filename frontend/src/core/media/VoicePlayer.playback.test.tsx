import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import i18n from '../../i18n';
import { VoicePlayer } from './VoicePlayer';
import { clientLog } from '../../utils/clientLog';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

beforeAll(async () => { await i18n.changeLanguage('en'); });

let play: ReturnType<typeof vi.fn>;
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    play = vi.fn(() => Promise.resolve());
    window.HTMLMediaElement.prototype.play = play as never;
    window.HTMLMediaElement.prototype.pause = vi.fn() as never;
    window.HTMLMediaElement.prototype.load = vi.fn() as never;
});

const audio = (container: HTMLElement) => container.querySelector('audio') as HTMLAudioElement;

describe.each(['compact', 'premium'] as const)('VoicePlayer playback state (%s)', (variant) => {
    it('releases the audio element on unmount', () => {
        const { container, unmount } = render(<VoicePlayer src="/api/media/ボイス.m4a" variant={variant} />);
        const el = audio(container);
        expect(el.getAttribute('src')).toBe('/api/media/ボイス.m4a');
        expect(el.getAttribute('preload')).toBe('metadata');
        unmount();
        expect(el.getAttribute('src')).toBeNull();
        expect(el.load).toHaveBeenCalledTimes(1);
    });

    it('spins in the play button while waiting, then recovers', () => {
        const { container } = render(<VoicePlayer src="/api/media/voice.m4a" variant={variant} />);
        const el = audio(container);
        act(() => { el.dispatchEvent(new Event('waiting')); });
        const spinner = screen.getByTestId('voice-buffering');
        expect(spinner).toHaveClass('animate-spin', 'motion-reduce:animate-none');
        expect(spinner.closest('button')).toHaveAttribute('aria-busy', 'true');
        expect(clientLog).toHaveBeenCalledWith('media_playback', expect.objectContaining({ phase: 'waiting', surface: 'voice' }));
        act(() => { el.dispatchEvent(new Event('playing')); });
        expect(screen.queryByTestId('voice-buffering')).toBeNull();
        expect(clientLog).toHaveBeenCalledWith('media_playback', expect.objectContaining({ phase: 'recovered', reason: 'waiting' }));
    });

    it('shows a neutral error with Retry that reloads the element', () => {
        const { container } = render(<VoicePlayer src="/api/media/voice.m4a" variant={variant} />);
        const el = audio(container);
        act(() => { el.dispatchEvent(new Event('error')); });
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent("This voice message couldn't be played.");
        expect(alert.querySelector('span')).toHaveClass('text-secondary');
        expect(alert.innerHTML).not.toMatch(/danger/);
        const retry = screen.getByRole('button', { name: 'Retry' });
        expect(retry).toHaveClass('bg-transparent', 'text-secondary'); // neutral ghost button
        vi.mocked(el.load).mockClear();
        fireEvent.click(retry);
        expect(el.load).toHaveBeenCalledTimes(1);
        expect(play).toHaveBeenCalled();
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('VoicePlayer play()', () => {
    it('logs a rejected autoplay', async () => {
        play.mockImplementation(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')));
        render(<VoicePlayer src="/api/media/voice.m4a" variant="fullscreen" autoPlay viewerMode />);
        await act(async () => { await Promise.resolve(); });
        expect(clientLog).toHaveBeenCalledWith('media_playback', expect.objectContaining({
            phase: 'play_rejected', surface: 'voice', error_type: 'notallowederror',
        }));
    });

    it('releases the old clip before playing a new source', () => {
        const { container, rerender } = render(<VoicePlayer src="/api/media/a.m4a" />);
        const el = audio(container);
        const srcAtLoad: Array<string | null> = [];
        vi.mocked(el.load).mockImplementation(() => { srcAtLoad.push(el.getAttribute('src')); });
        rerender(<VoicePlayer src="/api/media/b.m4a" />);
        expect(srcAtLoad).toEqual([null]);
        expect(el.getAttribute('src')).toBe('/api/media/b.m4a');
    });
});
