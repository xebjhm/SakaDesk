import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import type { Message } from '../../../types';
import { MessageBubble } from './MessageBubble';

const msg: Message = { id: 7, content: 'またね', timestamp: '2024-01-15T10:30:00Z', type: 'text', is_favorite: false };

describe('MessageBubble keyboard paths (UI health A-K4, A-K8)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        server.use(http.get('/api/app-state/translations', () => HttpResponse.json({})));
    });

    it('offers a star toggle, hidden until keyboard focus is in the row', async () => {
        const onToggleFavorite = vi.fn();
        render(<MessageBubble message={msg} member_name="n" onToggleFavorite={onToggleFavorite} />);
        const star = screen.getByRole('button', { name: 'Favorite' });
        expect(star).toHaveAttribute('aria-pressed', 'false');
        expect(star).toHaveClass('opacity-0', 'focus-visible:opacity-100');
        // No invisible hit target: a stray mouse click must not set a favourite on the official app.
        expect(star).toHaveClass('pointer-events-none', 'focus-visible:pointer-events-auto', 'group-has-[:focus-visible]/row:pointer-events-auto');
        star.focus();
        await userEvent.keyboard('{Enter}');
        expect(onToggleFavorite).toHaveBeenCalledWith(7, false);
    });

    it('reflects the shown favourite state in aria-pressed', () => {
        render(<MessageBubble message={msg} member_name="n" isFavorite onToggleFavorite={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Favorite' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('has no star toggle on an unread or read-only bubble', () => {
        const { rerender } = render(<MessageBubble message={msg} member_name="n" isUnread onToggleFavorite={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Favorite' })).toBeNull();
        rerender(<MessageBubble message={msg} member_name="n" readOnly onToggleFavorite={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Favorite' })).toBeNull();
    });

    it('shows a follow-up time on keyboard focus too', () => {
        const { container } = render(<MessageBubble message={msg} member_name="n" runStart={false} onToggleFavorite={vi.fn()} />);
        expect(container.querySelector('[data-testid="message-trailing"] time')).toHaveClass('group-has-[:focus-visible]/row:opacity-100');
    });
});
