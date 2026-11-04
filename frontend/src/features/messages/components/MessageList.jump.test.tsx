import { describe, it, expect, vi } from 'vitest';
import { renderList } from '../../../__tests__/messageListHelpers';

vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../hooks/useChatScroll', () => ({
    useChatScroll: () => ({ initialTopMostItemIndex: undefined, handleRangeChanged: vi.fn() }),
}));
vi.mock('./MessageBubble', () => ({ MessageBubble: () => <span /> }));

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
        const { container } = renderList({ highlightedRowKey: 'msg-2' });
        expect(container.querySelector('#msg-2')?.className).toContain('animate-landing');
        expect(container.querySelector('#msg-2')?.className).not.toContain('bg-group-subtle');
        expect(container.querySelector('#msg-1')?.className).not.toContain('animate-landing');
        expect(container.querySelector('#msg-3')?.className).not.toContain('animate-landing');
    });
});
