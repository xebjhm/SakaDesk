import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { useAppStore } from '../../../store/appStore';
import type { Message } from '../../../types';
import { MessageBubble } from './MessageBubble';

const PHOTO_LABEL = '写真を読み込み中…';

const picture: Message = {
    id: 7, content: '写真 📷', timestamp: '2024-01-15T10:30:00Z', type: 'picture', is_favorite: false,
    media_file: 'messages/1/picture/7.jpg', width: 800, height: 600,
};
const video: Message = { ...picture, id: 8, type: 'video', media_file: 'messages/1/video/8.mp4' };
const props = { member_name: '金村 美玖 🌸', member_avatar: '/avatar.jpg', service: 'hinatazaka46' };

const box = () => screen.getByTestId('bubble-media-box');
const photo = () => screen.getByAltText('添付ファイル') as HTMLImageElement;
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('MessageBubble photo loading (L5 / F5)', () => {
    beforeAll(async () => {
        await i18n.changeLanguage('ja');
        useAppStore.setState({ activeService: 'hinatazaka46' });
    });
    afterAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        vi.useFakeTimers();
        server.use(
            http.get('/api/app-state/translations', () => HttpResponse.json({})),
            http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
        );
    });
    afterEach(() => { vi.useRealTimers(); });

    it('pulses until the photo loads; the spinner waits for reveal and labels itself under reduced motion', async () => {
        render(<MessageBubble {...props} message={picture} />);
        expect(box().className).toContain('animate-pulse');
        expect(box().className).toContain('motion-reduce:animate-none');
        expect(box().className).toContain('bg-sunken');
        expect(box().className).not.toContain('bg-elevated');
        expect(photo().className).toContain('opacity-0');

        await advance(199);
        expect(screen.queryByRole('status', { name: PHOTO_LABEL })).toBeNull();
        await advance(1);
        const status = screen.getByRole('status', { name: PHOTO_LABEL });
        expect(screen.getByText(PHOTO_LABEL).className).toContain('motion-reduce:not-sr-only');
        // Only under reduced motion: the pulse speaks for itself otherwise.
        expect(status.parentElement?.className).toContain('motion-reduce:flex');

        fireEvent.load(photo());
        expect(box().className).not.toContain('animate-pulse');
        expect(photo().className).toContain('opacity-100');
        expect(photo().className).toContain('motion-reduce:transition-none');
        await advance(400);
        expect(screen.queryByRole('status', { name: PHOTO_LABEL })).toBeNull();
    });

    it('an image already in the cache shows at once: no pulse and no spinner ever', async () => {
        const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
        const natural = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
        Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true });
        Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 800 });
        try {
            render(<MessageBubble {...props} message={picture} />);
            expect(box().className).not.toContain('animate-pulse');
            expect(photo().className).toContain('opacity-100');
            await advance(1000);
            expect(screen.queryByRole('status', { name: PHOTO_LABEL })).toBeNull();
        } finally {
            if (complete) Object.defineProperty(HTMLImageElement.prototype, 'complete', complete);
            if (natural) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', natural);
            else delete (HTMLImageElement.prototype as { naturalWidth?: number }).naturalWidth;
        }
    });

    it('a broken photo shows the existing fallback and stops pulsing', async () => {
        render(<MessageBubble {...props} message={picture} />);
        fireEvent.error(photo());
        expect(screen.queryByAltText('添付ファイル')).toBeNull();
        expect(box().querySelector('svg')).not.toBeNull();
        expect(box().className).not.toContain('animate-pulse');
        await advance(1000);
        expect(screen.queryByRole('status', { name: PHOTO_LABEL })).toBeNull();
    });

    it('a new message in the same bubble starts loading again', async () => {
        const { rerender } = render(<MessageBubble {...props} message={picture} />);
        fireEvent.load(photo());
        expect(box().className).not.toContain('animate-pulse');
        rerender(<MessageBubble {...props} message={{ ...picture, id: 9, media_file: 'messages/1/picture/9.jpg' }} />);
        expect(box().className).toContain('animate-pulse');
    });

    it('a new picture src for the same message pulses again (never a blank box)', async () => {
        const { rerender } = render(<MessageBubble {...props} message={picture} />);
        fireEvent.load(photo());
        expect(box().className).not.toContain('animate-pulse');
        rerender(<MessageBubble {...props} message={picture} mediaThumbWidth={640} />);
        expect(box().className).toContain('animate-pulse');
        expect(photo().className).toContain('opacity-0');
        fireEvent.load(photo());
        expect(box().className).not.toContain('animate-pulse');
    });

    it('video bubbles keep their viewer stage and never pulse', () => {
        render(<MessageBubble {...props} message={video} />);
        const stage = screen.getByTestId('bubble-media-box');
        expect(stage.className).toContain('bg-viewer-stage');
        expect(stage.className).not.toContain('animate-pulse');
    });
});
