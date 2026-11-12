import { describe, it, expect } from 'vitest';
import type { Message } from '../../../types';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { applyNickname, replaceNickname } from './nickname';

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

describe('replaceNickname', () => {
    it('replaces every ASCII and fullwidth placeholder in one string, literally', () => {
        expect(replaceNickname('%%%、おやすみ ％％％', 'ゆき')).toBe('ゆき、おやすみ ゆき');
        expect(replaceNickname('%%%!', '$&')).toBe('$&!');
        expect(replaceNickname('no placeholder', 'ゆき')).toBe('no placeholder');
    });
});

describe('nickname coverage in the chat screen', () => {
    // 0.4.1: Favorites showed raw %%% because MessagesFeature handed the raw
    // list to ConversationMenu. Children that show message text get displayMessages.
    it('MessagesFeature never passes the raw message list to a child', () => {
        const src = readFileSync(path.resolve(process.cwd(), 'src/features/messages/MessagesFeature.tsx'), 'utf-8');
        expect(src).not.toMatch(/messages=\{messages\}/);
        expect(src).toMatch(/messages=\{displayMessages\}/);
    });
});
