import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import { virtuosoCapture, resetVirtuosoCapture } from '../../../__tests__/virtuosoMock';
import { messages, renderList } from '../../../__tests__/messageListHelpers';
import { useCollapseOnOutOfView } from '../hooks/useMessageVisibility';
import { buildTimeline } from '../timeline/buildTimeline';
import { MessageList } from './MessageList';

const { handleRangeChanged, topVisibleRowIndex } = vi.hoisted(() => ({
    handleRangeChanged: vi.fn(),
    // jsdom has no layout: by default nothing hides behind the sticky date header.
    topVisibleRowIndex: vi.fn((_scroller: unknown, range: { startIndex: number }) => range.startIndex),
}));

vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../hooks/useChatScroll', () => ({
    useChatScroll: () => ({ initialTopMostItemIndex: 0, handleRangeChanged }),
}));
vi.mock('../timeline/landing', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../timeline/landing')>()),
    topVisibleRowIndex,
}));
vi.mock('./MessageBubble', () => ({ MessageBubble: () => <span /> }));

/** Report a range, then run the frame in which the list resolves what the user sees. */
function emitRange(range: { startIndex: number; endIndex: number }) {
    if (!virtuosoCapture.rangeChanged) throw new Error('MessageList never passed rangeChanged to the list');
    act(() => virtuosoCapture.rangeChanged!(range));
    act(() => { vi.advanceTimersToNextFrame(); });
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    resetVirtuosoCapture();
    handleRangeChanged.mockClear();
    topVisibleRowIndex.mockClear();
    topVisibleRowIndex.mockImplementation((_scroller, range) => range.startIndex);
});
afterEach(() => vi.useRealTimers());

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
        emitRange({ startIndex: 0, endIndex: 1 });
        expect(collapse2).toHaveBeenCalledTimes(1);
        expect(container.querySelector('#letter-2')).not.toBeNull();
        expect(container.querySelector('#msg-2')).not.toBeNull();
    });

    it('a row hidden behind the sticky date header counts as neither seen by unread nav nor visible', () => {
        topVisibleRowIndex.mockImplementation((_scroller, range) => range.startIndex + 1);
        const onRangeChanged = vi.fn();
        const collapse1 = vi.fn();
        const collapse2 = vi.fn();
        renderHook(() => {
            useCollapseOnOutOfView(1, true, collapse1);
            useCollapseOnOutOfView(2, true, collapse2);
        });
        renderList({ onRangeChanged });
        emitRange({ startIndex: 0, endIndex: 2 });
        expect(handleRangeChanged).toHaveBeenCalledWith({ startIndex: 0, endIndex: 2 }); // resolves its own
        expect(onRangeChanged).toHaveBeenCalledWith({ startIndex: 1, endIndex: 2 });
        expect(collapse1).toHaveBeenCalledTimes(1);
        expect(collapse2).not.toHaveBeenCalled();
    });

    it('resolves what the user sees one frame later, once per frame, and never for another room', () => {
        const onRangeChanged = vi.fn();
        const { rerender } = renderList({ onRangeChanged });
        act(() => virtuosoCapture.rangeChanged!({ startIndex: 0, endIndex: 1 }));
        act(() => virtuosoCapture.rangeChanged!({ startIndex: 1, endIndex: 2 }));
        expect(onRangeChanged).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersToNextFrame(); });
        expect(onRangeChanged.mock.calls).toEqual([[{ startIndex: 1, endIndex: 2 }]]);

        act(() => virtuosoCapture.rangeChanged!({ startIndex: 0, endIndex: 0 }));
        rerender(
            <MessageList
                memberId="other-room"
                timeline={buildTimeline(messages, [])}
                getSenderInfo={() => ({ name: 'n' })}
                isUnread={() => false}
                onReveal={vi.fn()}
                onLongPress={vi.fn()}
                onRangeChanged={onRangeChanged}
            />,
        );
        act(() => { vi.advanceTimersToNextFrame(); });
        expect(onRangeChanged).toHaveBeenCalledTimes(1);
    });
});
