import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Message } from '../../../types';
import { MessageList } from './MessageList';
import { buildTimeline } from '../timeline/buildTimeline';

vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../hooks/useChatScroll', () => ({
    useChatScroll: () => ({ initialTopMostItemIndex: 0, handleRangeChanged: vi.fn() }),
}));
vi.mock('./MessageBubble', () => ({ MessageBubble: () => <span /> }));

const msg = (id: number, timestamp: string): Message => ({ id, timestamp, type: 'text', is_favorite: false, content: `m${id}` });

describe('MessageList date headers', () => {
    it('renders one date pill per local day, and a pill opens the calendar', () => {
        const timeline = buildTimeline([msg(1, '2025-01-01T03:00:00Z'), msg(2, '2025-01-01T04:00:00Z'), msg(3, '2025-03-05T03:00:00Z')], []);
        const onOpenCalendar = vi.fn();
        const { container } = render(
            <MessageList
                memberId="room"
                timeline={timeline}
                getSenderInfo={() => ({ name: 'n' })}
                isUnread={() => false}
                onReveal={vi.fn()}
                onLongPress={vi.fn()}
                onOpenCalendar={onOpenCalendar}
            />,
        );
        const dates = Array.from(container.querySelectorAll('time')).map((el) => el.getAttribute('datetime'));
        expect(dates).toEqual(timeline.groupDates);
        fireEvent.click(screen.getAllByRole('button')[0]);
        expect(onOpenCalendar).toHaveBeenCalledOnce();
    });

    it('gives a message without a valid timestamp an undated group with a 1 px header and no pill', () => {
        const timeline = buildTimeline([msg(1, 'not a date'), msg(2, '2025-01-01T03:00:00Z')], []);
        expect(timeline.groupDates).toContain('');
        const { container } = render(
            <MessageList
                memberId="room"
                timeline={timeline}
                getSenderInfo={() => ({ name: 'n' })}
                isUnread={() => false}
                onReveal={vi.fn()}
                onLongPress={vi.fn()}
                onOpenCalendar={vi.fn()}
            />,
        );
        const dates = Array.from(container.querySelectorAll('time')).map((el) => el.getAttribute('datetime'));
        expect(dates).toEqual(['2025-01-01']);
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(container.querySelectorAll('.h-px')).toHaveLength(1);
        expect(container.querySelector('#msg-1')).not.toBeNull();
    });
});
