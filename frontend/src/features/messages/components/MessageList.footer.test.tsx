import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../i18n';
import type { Message } from '../../../types';
import { MessageList } from './MessageList';
import { MilestoneFooter } from './MilestoneFooter';
import { buildTimeline } from '../timeline/buildTimeline';

vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../hooks/useChatScroll', () => ({
    useChatScroll: () => ({ initialTopMostItemIndex: 0, handleRangeChanged: vi.fn() }),
}));
vi.mock('./MessageBubble', () => ({ MessageBubble: ({ message }: { message: Message }) => <span>{message.content}</span> }));

beforeAll(async () => { await i18n.changeLanguage('en'); });

const msg = (id: number, timestamp: string): Message => ({ id, timestamp, type: 'text', is_favorite: false, content: `m${id}` });

describe('MessageList footer (R-d)', () => {
    it('shows the footer node after the newest message', () => {
        const timeline = buildTimeline([msg(1, '2025-01-01T03:00:00Z'), msg(2, '2025-01-02T03:00:00Z')], []);
        render(
            <MessageList memberId="room" timeline={timeline} getSenderInfo={() => ({ name: 'n' })} isUnread={() => false}
                onReveal={vi.fn()} onLongPress={vi.fn()} footer={<p>🎉 5,000</p>} />,
        );
        const last = screen.getByText('m2');
        const footer = screen.getByText('🎉 5,000');
        expect(last.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

describe('MilestoneFooter', () => {
    it.each([
        [{ kind: 'messages', value: 5000 }, '5,000', 'messages in this chat'],
        [{ kind: 'days', value: 100 }, '100', 'days subscribed'],
        [{ kind: 'days', value: 365 }, '1', 'year subscribed'],
        [{ kind: 'days', value: 730 }, '2', 'years subscribed'],
    ] as const)('%o shows %s / %s', (milestone, value, label) => {
        render(<MilestoneFooter milestone={milestone} />);
        expect(screen.getByText(value)).toHaveClass('font-display', 'tabular-nums');
        expect(screen.getByText(label)).toBeInTheDocument();
    });
});
