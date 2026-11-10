import { describe, it, expect } from 'vitest';
import { memberKey, messageKey, roomName } from './people';
import { memoryMessage } from '../__fixtures__/memories';

describe('day people', () => {
    it('reads her name from the room folder', () => {
        expect(roomName('messages/34 金村 美玖/58 金村 美玖')).toBe('金村 美玖');
    });

    it('matches a message from an older room to the same person', () => {
        const member = { service: 'hinatazaka46', name: '金村 美玖' };
        const older = memoryMessage({ room: 'messages/12 金村美玖（ひらがな）/3 金村美玖' });
        expect(messageKey(older)).toBe(memberKey(member));
    });

    it('keeps two services apart', () => {
        expect(memberKey({ service: 'a', name: 'X' })).not.toBe(memberKey({ service: 'b', name: 'X' }));
    });
});
