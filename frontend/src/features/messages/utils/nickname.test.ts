import { describe, it, expect } from 'vitest';
import type { Message } from '../../../types';
import { applyNickname } from './nickname';

const msg = (id: number, content: string | null): Message => ({ id, timestamp: '2026-01-01T00:00:00Z', type: 'text', is_favorite: false, content });

describe('applyNickname', () => {
    it('replaces ASCII and fullwidth placeholders', () => {
        const out = applyNickname([msg(1, '%%%さん、ありがとう'), msg(2, '％％％ちゃん🌸')], 'ゆき');
        expect(out.map((m) => m.content)).toEqual(['ゆきさん、ありがとう', 'ゆきちゃん🌸']);
    });

    it('returns the same array when nothing changes', () => {
        const list = [msg(1, 'hello'), msg(2, null)];
        expect(applyNickname(list, 'ゆき')).toBe(list);
        expect(applyNickname(list, undefined)).toBe(list);
    });

    it('inserts the nickname literally (no $ patterns)', () => {
        expect(applyNickname([msg(1, '%%%!')], '$&$1')[0].content).toBe('$&$1!');
    });
});
