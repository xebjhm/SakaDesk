import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTimeline } from '../timeline/buildTimeline';
import { renderList } from '../../../__tests__/messageListHelpers';
import type { Message } from '../../../types';

// Last thumbnail width each bubble was given, by message id (the list may render more than once).
const { thumbs } = vi.hoisted(() => ({ thumbs: new Map<number, number | undefined>() }));
vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../hooks/useChatScroll', () => ({ useChatScroll: () => ({ initialTopMostItemIndex: 0, handleRangeChanged: () => {} }) }));
vi.mock('./MessageBubble', () => ({
    MessageBubble: (p: { message: { id: number }; mediaThumbWidth?: number }) => { thumbs.set(p.message.id, p.mediaThumbWidth); return null; },
}));

const pic = (id: number, file: string): Message => ({
    id, timestamp: `2026-01-0${id}T00:00:00Z`, type: 'picture', is_favorite: false, content: null,
    media_file: file, width: 800, height: 600,
} as Message);

describe('MessageList chat thumbnails (UI health #8)', () => {
    beforeEach(() => {
        thumbs.clear();
        Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    });

    it('asks pictures for the pre-generated thumbnail when it covers their box; GIFs keep the original', () => {
        renderList({ timeline: buildTimeline([pic(1, 'p/1.jpg'), pic(2, 'p/2.gif')], []) });
        expect(thumbs.get(1)).toBe(480);
        expect(thumbs.has(2)).toBe(true);
        expect(thumbs.get(2)).toBeUndefined();
    });

    it('at a device pixel ratio of 2 the thumbnail no longer covers the box, so the original is used', () => {
        Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
        renderList({ timeline: buildTimeline([pic(1, 'p/1.jpg')], []) });
        expect(thumbs.has(1)).toBe(true);
        expect(thumbs.get(1)).toBeUndefined();
    });
});
