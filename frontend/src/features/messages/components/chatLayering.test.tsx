import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { useAppStore } from '../../../store/appStore';
import type { Message } from '../../../types';
import { MessageList } from './MessageList';
import { MessageBubble } from './MessageBubble';
import { buildTimeline } from '../timeline/buildTimeline';

vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../hooks/useChatScroll', () => ({
    useChatScroll: () => ({ initialTopMostItemIndex: 0, handleRangeChanged: vi.fn() }),
}));

const msg = (id: number, over: Partial<Message> = {}): Message => ({
    id, timestamp: '2025-01-01T03:00:00Z', type: 'text', is_favorite: false, content: `m${id}`, ...over,
});

beforeAll(async () => { await i18n.changeLanguage('en'); });

beforeEach(() => {
    server.use(
        http.get('/api/app-state/translations', () => HttpResponse.json({})),
        http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
    );
});
afterEach(() => useAppStore.setState({ translationEnabled: false }));

describe('chat layering (H6)', () => {
    it('gives every timeline row its own stacking context so a shelter cannot out-paint the sticky date pill', () => {
        const timeline = buildTimeline([msg(1), msg(2)], []);
        const { container } = render(
            <MessageList
                memberId="room" timeline={timeline} getSenderInfo={() => ({ name: 'n' })}
                isUnread={() => true} onReveal={vi.fn()} onLongPress={vi.fn()}
            />,
        );
        for (const id of ['msg-1', 'msg-2']) {
            expect(container.querySelector(`#${id}`)).toHaveClass('isolate');
        }
    });

    it('puts the translate icon in the trailing column at the bubble edge, not in the header', () => {
        useAppStore.setState({ translationEnabled: true });
        const { container } = render(
            <MessageBubble message={msg(1)} member_name="N" isUnread={false} onReveal={vi.fn()} onLongPress={vi.fn()} service="日向坂46" runStart />,
        );
        const header = container.querySelector('time')!.parentElement!;
        expect(within(header).queryByRole('button', { name: /Translate/ })).toBeNull();
        const trailing = container.querySelector('[data-testid="message-trailing"]') as HTMLElement;
        expect(within(trailing).getByRole('button', { name: /Translate/ })).toBeInTheDocument();
    });

});
