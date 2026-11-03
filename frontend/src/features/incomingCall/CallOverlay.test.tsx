import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { IncomingCall } from './useIncomingCall';
import { CallOverlay } from './CallOverlay';

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
});
