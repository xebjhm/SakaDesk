import { useState } from 'react';
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

    it('moves focus to the revealed bubble after a keyboard reveal, never to the body', async () => {
        const Harness = () => {
            const [unread, setUnread] = useState(true);
            return <MessageBubble message={msg()} member_name="n" service="hinatazaka46" isUnread={unread} onReveal={() => setUnread(false)} />;
        };
        render(<Harness />);
        screen.getByRole('button', { name: 'Show unread message' }).focus();
        await userEvent.keyboard('{Enter}');
        const content = screen.getByText('こんにちは').closest('[tabindex="-1"]');
        expect(content).not.toBeNull();
        expect(document.activeElement).toBe(content);
        expect(document.activeElement).not.toBe(document.body);
    });

    it('leaves focus alone after a mouse reveal', async () => {
        const Harness = () => {
            const [unread, setUnread] = useState(true);
            return <MessageBubble message={msg()} member_name="n" service="hinatazaka46" isUnread={unread} onReveal={() => setUnread(false)} />;
        };
        render(<Harness />);
        await userEvent.click(screen.getByRole('button', { name: 'Show unread message' }));
        expect(screen.queryByRole('button', { name: 'Show unread message' })).toBeNull();
        expect(screen.getByText('こんにちは').closest('[tabindex="-1"]')).not.toBe(document.activeElement);
    });

    it('does not pull focus on a later reveal when the keyboard reveal did not take effect', async () => {
        const props = { message: msg(), member_name: 'n', service: 'hinatazaka46' as const, onReveal: vi.fn() };
        const { rerender } = render(<MessageBubble {...props} isUnread />);
        screen.getByRole('button', { name: 'Show unread message' }).focus();
        await userEvent.keyboard('{Enter}');
        expect(props.onReveal).toHaveBeenCalledTimes(1);
        await new Promise(resolve => setTimeout(resolve, 10));
        (document.activeElement as HTMLElement).blur();
        rerender(<MessageBubble {...props} isUnread={false} />);
        expect(document.activeElement).toBe(document.body);
    });
});
