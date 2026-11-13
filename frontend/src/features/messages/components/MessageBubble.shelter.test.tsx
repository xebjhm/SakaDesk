import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import type { Message } from '../../../types';
import { MessageBubble } from './MessageBubble';

const msg = (over: Partial<Message> = {}): Message => ({
    id: 1, content: 'こんにちは', timestamp: '2024-01-15T10:30:00Z', type: 'text', is_favorite: false, ...over,
});

describe('MessageBubble unread shelter (UI health #3)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        server.use(
            http.get('/api/app-state/translations', () => HttpResponse.json({})),
            http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
        );
    });

    it('is a named button that Enter and Space reveal', async () => {
        const onReveal = vi.fn();
        render(<MessageBubble message={msg()} member_name="n" service="hinatazaka46" isUnread onReveal={onReveal} />);
        const shelter = screen.getByRole('button', { name: 'Show unread message' });
        shelter.focus();
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard(' ');
        expect(onReveal).toHaveBeenCalledTimes(2);
    });

    it('names the shelter by kind', () => {
        render(<MessageBubble message={msg({ type: 'picture', content: null, media_file: 'p/1.jpg' })} member_name="n" service="hinatazaka46" isUnread onReveal={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Show unread photo' })).toBeInTheDocument();
    });

    it('makes the hidden content inert, and live again once revealed', () => {
        const { rerender } = render(<MessageBubble message={msg()} member_name="n" service="hinatazaka46" isUnread onReveal={vi.fn()} />);
        expect(screen.getByText('こんにちは').closest('[inert]')).not.toBeNull();
        rerender(<MessageBubble message={msg()} member_name="n" service="hinatazaka46" isUnread={false} onReveal={vi.fn()} />);
        expect(screen.getByText('こんにちは').closest('[inert]')).toBeNull();
    });
});
