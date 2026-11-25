import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '../../../store/appStore';
import { jumpToChat } from './jumpToChat';
import { memoryMessage } from '../__fixtures__/memories';

// The real openChat boundary: the chat reads `targetMessageId` (MessageList seeds the scroll and
// calls the shared jump that highlights the row) for the conversation selected here.
describe('jumpToChat through the real openChat', () => {
    beforeEach(() => {
        useAppStore.setState({ activeService: 'sakurazaka46', selectedConversations: {}, conversationNavCounter: 0, targetMessageId: null });
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 204 })));
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('sets the target message and opens her room on the message service', () => {
        const msg = memoryMessage({ id: 98765 });
        jumpToChat(msg, '金村 美玖', 'favorites');
        const s = useAppStore.getState();
        expect(s.targetMessageId).toBe(98765);
        expect(s.selectedConversations.hinatazaka46).toMatchObject({ path: msg.member_path, isGroupChat: false });
        expect(s.activeService).toBe('hinatazaka46');
    });
});
