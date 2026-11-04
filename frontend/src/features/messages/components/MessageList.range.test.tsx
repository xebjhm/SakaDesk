import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import { virtuosoCapture, resetVirtuosoCapture } from '../../../__tests__/virtuosoMock';
import { messages, renderList } from '../../../__tests__/messageListHelpers';
import { useCollapseOnOutOfView } from '../hooks/useMessageVisibility';
import { buildTimeline } from '../timeline/buildTimeline';
import { MessageList } from './MessageList';

const { handleRangeChanged } = vi.hoisted(() => ({ handleRangeChanged: vi.fn() }));

vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../hooks/useChatScroll', () => ({
    useChatScroll: () => ({ initialTopMostItemIndex: undefined, handleRangeChanged }),
}));
vi.mock('./MessageBubble', () => ({ MessageBubble: () => <span /> }));

function emitRange(range: { startIndex: number; endIndex: number }) {
    if (!virtuosoCapture.rangeChanged) throw new Error('MessageList never passed rangeChanged to the list');
    act(() => virtuosoCapture.rangeChanged!(range));
}

beforeEach(() => {
    resetVirtuosoCapture();
    handleRangeChanged.mockClear();
});

describe('MessageList rangeChanged wiring', () => {
    it('reports the rendered range to scroll saving and the unread navigation', () => {
        const onRangeChanged = vi.fn();
        renderList({ onRangeChanged });
        emitRange({ startIndex: 0, endIndex: 1 });
        expect(handleRangeChanged).toHaveBeenCalledWith({ startIndex: 0, endIndex: 1 });
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
        emitRange({ startIndex: 0, endIndex: 1 });
        expect(collapse3).toHaveBeenCalledTimes(1);
        expect(collapse1).not.toHaveBeenCalled();
    });

    it('leaves letters out of the panel registry and keeps message rows keyed msg-<id>', () => {
        const collapse2 = vi.fn();
        renderHook(() => useCollapseOnOutOfView(2, true, collapse2));
        const letter = { id: 2, text: '', created_at: '2026-01-01T12:00:00Z', image_url: null, width: null, height: null };
        const { container } = render(
            <MessageList
                memberId="room"
                timeline={buildTimeline(messages, [letter])}
                getSenderInfo={() => ({ name: 'n' })}
                isUnread={() => false}
                onReveal={vi.fn()}
                onLongPress={vi.fn()}
                renderLetter={() => <span>letter</span>}
            />,
        );
        // Rows: msg-1, letter-2, msg-2, msg-3; range 0..1 holds msg-1 and letter-2 only.
        act(() => virtuosoCapture.rangeChanged!({ startIndex: 0, endIndex: 1 }));
        expect(collapse2).toHaveBeenCalledTimes(1);
        expect(container.querySelector('#letter-2')).not.toBeNull();
        expect(container.querySelector('#msg-2')).not.toBeNull();
    });
});
