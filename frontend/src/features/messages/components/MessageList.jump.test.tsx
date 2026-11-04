import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Message } from '../../../types';
import { MessageList } from './MessageList';

// jsdom has no layout, so the real Virtuoso renders no rows; render every row instead.
vi.mock('react-virtuoso', () => ({
    Virtuoso: ({ data, itemContent }: {
        data: Message[];
        itemContent: (index: number, msg: Message) => React.ReactNode;
    }) => <div>{data.map((m, i) => <div key={m.id}>{itemContent(i, m)}</div>)}</div>,
}));
vi.mock('../hooks/useChatScroll', () => ({
    useChatScroll: () => ({ initialTopMostItemIndex: undefined, handleRangeChanged: vi.fn() }),
}));
vi.mock('./MessageBubble', () => ({ MessageBubble: () => <span /> }));

const msg = (id: number): Message =>
    ({ id, timestamp: '2026-01-01T00:00:00Z', type: 'text', is_favorite: false, content: `m${id}` });
const messages = [msg(1), msg(2), msg(3)];

function renderList(extra: Partial<React.ComponentProps<typeof MessageList>>) {
    return render(
        <MessageList
            memberId="room"
            messages={messages}
            getSenderInfo={() => ({ name: 'n' })}
            isUnread={() => false}
            onReveal={vi.fn()}
            onLongPress={vi.fn()}
            {...extra}
        />,
    );
}

describe('MessageList jump wiring', () => {
    it('jumps once to a present target and consumes it', () => {
        const onJumpToMessage = vi.fn();
        const onTargetMessageConsumed = vi.fn();
        renderList({ targetMessageId: 2, onJumpToMessage, onTargetMessageConsumed });
        expect(onJumpToMessage).toHaveBeenCalledTimes(1);
        expect(onJumpToMessage).toHaveBeenCalledWith(2);
        expect(onTargetMessageConsumed).toHaveBeenCalledTimes(1);
    });

    it('ignores a target that is not in the list', () => {
        const onJumpToMessage = vi.fn();
        const onTargetMessageConsumed = vi.fn();
        renderList({ targetMessageId: 99, onJumpToMessage, onTargetMessageConsumed });
        expect(onJumpToMessage).not.toHaveBeenCalled();
        expect(onTargetMessageConsumed).not.toHaveBeenCalled();
    });

    it('highlights only the flashed row', () => {
        const { container } = renderList({ highlightedMessageId: 2 });
        expect(container.querySelector('#msg-2')?.className).toContain('animate-landing');
        expect(container.querySelector('#msg-2')?.className).not.toContain('bg-group-subtle');
        expect(container.querySelector('#msg-1')?.className).not.toContain('animate-landing');
        expect(container.querySelector('#msg-3')?.className).not.toContain('animate-landing');
    });
});
