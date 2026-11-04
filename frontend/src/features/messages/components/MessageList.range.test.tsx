import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { virtuosoCapture, resetVirtuosoCapture } from '../../../__tests__/virtuosoMock';
import { renderList } from '../../../__tests__/messageListHelpers';
import { useCollapseOnOutOfView } from '../hooks/useMessageVisibility';

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
});
