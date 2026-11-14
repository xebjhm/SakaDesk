import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { buildTimeline } from '../timeline/buildTimeline';
import { messages } from '../../../__tests__/messageListHelpers';
import { MessageList } from './MessageList';

// vi.mock factories are hoisted above the imports: shared state comes from vi.hoisted.
const { bubbleRenders, revealProps } = vi.hoisted(() => ({
    bubbleRenders: [] as number[],
    revealProps: new Map<number, () => void>(),
}));
vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../hooks/useChatScroll', () => ({ useChatScroll: () => ({ initialTopMostItemIndex: 0, handleRangeChanged: () => {} }) }));
vi.mock('./MessageBubble', async () => {
    const { memo } = await import('react');
    // A memoised stand-in, like the real MessageBubble: it renders only when its props change.
    const Bubble = memo((p: { message: { id: number }; onReveal?: () => void }) => {
        bubbleRenders.push(p.message.id);
        if (p.onReveal) revealProps.set(p.message.id, p.onReveal);
        return <button type="button" onClick={p.onReveal}>{`reveal ${p.message.id}`}</button>;
    });
    return { MessageBubble: Bubble };
});

const timeline = buildTimeline(messages, []);
const getSenderInfo = () => ({ name: 'n' });
const isUnread = () => true;
const onLongPress = () => {};

function list(onReveal: (id: number) => void, memberId = 'room') {
    return (
        <MessageList
            memberId={memberId}
            timeline={timeline}
            getSenderInfo={getSenderInfo}
            isUnread={isUnread}
            onReveal={onReveal}
            onLongPress={onLongPress}
        />
    );
}

describe('MessageList memo boundaries (UI health #2)', () => {
    beforeEach(() => { bubbleRenders.length = 0; revealProps.clear(); });

    it('a new onReveal from the parent does not re-render any bubble', () => {
        const { rerender } = render(list(vi.fn()));
        const first = bubbleRenders.length;
        rerender(list(vi.fn()));
        expect(bubbleRenders.length).toBe(first);
    });

    it('a bubble reveal calls the latest onReveal with its id', () => {
        const older = vi.fn();
        const latest = vi.fn();
        const { rerender } = render(list(older));
        rerender(list(latest));
        fireEvent.click(screen.getByText('reveal 2'));
        expect(older).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledWith(2);
    });

    it('a room switch drops the old room callbacks; the same room keeps them', () => {
        const onReveal = vi.fn();
        const { rerender } = render(list(onReveal, 'room'));
        const first = revealProps.get(2);
        rerender(list(onReveal, 'room'));
        expect(revealProps.get(2)).toBe(first);

        rerender(list(onReveal, 'other'));
        // Same room key again after a switch: the map was cleared, so the callback is new.
        const afterSwitch = revealProps.get(2);
        expect(afterSwitch).not.toBe(first);

        // The new room rendered again stays stable (an effect-cleanup reset would drop it here).
        // A new onReveal makes the list render again (it is memoised on its props).
        rerender(list(vi.fn(), 'other'));
        expect(revealProps.get(2)).toBe(afterSwitch);
    });
});
