import { describe, it, expect } from 'vitest';
import { memoryMessage } from '../__fixtures__/memories';
import { messageName, nameFromRoom } from './nameFromRoom';

describe('messageName', () => {
    it("prefers the payload's name, then a known name, then the room dir", () => {
        const m = memoryMessage({ room: 'messages/34 金村 美玖/12 金村 美玖' });
        expect(messageName({ ...m, name: '金村 美玖（新）' }, '別の名前')).toBe('金村 美玖（新）');
        expect(messageName(m, '金村 美玖')).toBe('金村 美玖');
        expect(messageName(m)).toBe('金村 美玖');
        expect(nameFromRoom('messages/1 小坂 菜緒/40 小坂 菜緒')).toBe('小坂 菜緒');
    });
});
