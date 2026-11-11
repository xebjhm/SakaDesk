import { describe, it, expect } from 'vitest';
import { deriveChatLoad, type ChatLoadInput } from './chatLoadState';

const A = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const B = '日向坂46/messages/12 小坂 菜緒/20 小坂 菜緒 🌸';
const base: ChatLoadInput = { selectedGroupDir: B, messagesForDir: B, messageCount: 3, lettersReady: true, failure: null };

describe('deriveChatLoad', () => {
    it('no room open: nothing waits, the gallery is ready', () => {
        expect(deriveChatLoad({ ...base, selectedGroupDir: undefined, failure: 'error' })).toEqual({
            roomPending: false, lettersPending: false, chatWaiting: false, failure: null, listStatus: 'ready',
        });
    });

    it('the previous room still in state: the room is pending and the gallery loading', () => {
        const s = deriveChatLoad({ ...base, messagesForDir: A });
        expect(s).toMatchObject({ roomPending: true, lettersPending: false, chatWaiting: true, listStatus: 'loading' });
    });

    it('messages in, letters not yet: the timeline waits, the gallery is ready', () => {
        const s = deriveChatLoad({ ...base, lettersReady: false });
        expect(s).toMatchObject({ roomPending: false, lettersPending: true, chatWaiting: true, listStatus: 'ready' });
    });

    it('an empty loaded room never waits for letters and stays ready', () => {
        const s = deriveChatLoad({ ...base, messageCount: 0, lettersReady: false });
        expect(s).toMatchObject({ chatWaiting: false, listStatus: 'ready' });
    });

    it.each(['timeout', 'error'] as const)('a %s failure stops the wait and reads as a gallery error', (failure) => {
        const s = deriveChatLoad({ ...base, messagesForDir: null, failure });
        expect(s).toMatchObject({ roomPending: false, chatWaiting: false, failure, listStatus: 'error' });
    });

    it('a loaded room is ready', () => {
        expect(deriveChatLoad(base)).toMatchObject({ chatWaiting: false, failure: null, listStatus: 'ready' });
    });
});
