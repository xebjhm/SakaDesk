import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import type { Message } from '../../../types';
import { virtuosoCapture } from '../../../__tests__/virtuosoMock';
import { useCollapseOnOutOfView } from '../hooks/useMessageVisibility';
import { MessageList } from './MessageList';

vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../hooks/useChatScroll', () => ({
    useChatScroll: () => ({ initialTopMostItemIndex: undefined, handleRangeChanged: vi.fn() }),
}));
vi.mock('./MessageBubble', () => ({ MessageBubble: () => <span /> }));

const msg = (id: number): Message =>
    ({ id, timestamp: `2026-01-0${id}T00:00:00Z`, type: 'text', is_favorite: false, content: `m${id}` });
const messages = [msg(1), msg(2), msg(3)];

function renderList(onRangeChanged = vi.fn()) {
    render(
        <MessageList
            memberId="room"
            messages={messages}
            getSenderInfo={() => ({ name: 'n' })}
            isUnread={() => false}
            onReveal={vi.fn()}
            onLongPress={vi.fn()}
            onRangeChanged={onRangeChanged}
        />,
    );
    return onRangeChanged;
}

describe('MessageList rangeChanged wiring', () => {
    it('reports the rendered range to the unread navigation', () => {
        const onRangeChanged = renderList();
        act(() => virtuosoCapture.rangeChanged!({ startIndex: 0, endIndex: 1 }));
        expect(onRangeChanged).toHaveBeenCalledWith({ startIndex: 0, endIndex: 1 });
    });

    it('collapses the panels of messages that left the rendered range, and only those', () => {
        const collapse1 = vi.fn();
        const collapse3 = vi.fn();
        renderHook(() => {
            useCollapseOnOutOfView(1, true, collapse1);
            useCollapseOnOutOfView(3, true, collapse3);
        });
        renderList();
        act(() => virtuosoCapture.rangeChanged!({ startIndex: 0, endIndex: 1 }));
        expect(collapse3).toHaveBeenCalledTimes(1);
        expect(collapse1).not.toHaveBeenCalled();
    });
});
