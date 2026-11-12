import type {
    BinderCard, BinderPayload, MemoirHeaderPayload, MemoirMembersPayload, MemoryMessage,
} from '../types';
import { MEMBER_PATH, memoryMessage } from '../__fixtures__/memories';

export const NAO_PATH = '日向坂46/messages/1 小坂 菜緒/1 小坂 菜緒';
export const GRAD_PATH = '日向坂46/messages/2 潮 紗理菜/2 潮 紗理菜';
/** An older room of 小坂 菜緒 (same person, another chat). */
export const NAO_OLD_PATH = '日向坂46/messages/0 小坂 菜緒/1 小坂 菜緒';

export function membersPayload(): MemoirMembersPayload {
    return {
        members: [
            {
                member_path: MEMBER_PATH, member_paths: [MEMBER_PATH], member_id: '58', name: '金村 美玖', avatar_url: null,
                oshi: true, graduated: false, progress: { earned: 18, total: 30 },
            },
            {
                member_path: NAO_PATH, member_paths: [NAO_OLD_PATH, NAO_PATH], member_id: '1', name: '小坂 菜緒', avatar_url: null,
                oshi: false, graduated: false, progress: { earned: 0, total: 24 },
            },
            {
                member_path: GRAD_PATH, member_paths: [GRAD_PATH], member_id: '2', name: '潮 紗理菜', avatar_url: null,
                oshi: false, graduated: true, progress: { earned: 9, total: 25 },
            },
        ],
    };
}

export function headerPayload(over: Partial<MemoirHeaderPayload['chips']> = {}): MemoirHeaderPayload {
    return {
        member_path: MEMBER_PATH,
        name: '金村 美玖',
        avatar_url: '/api/content/media/hinatazaka46/icon.jpg',
        graduated: false,
        chips: { subscription_days: 842, nickname_count: 57, voice_seconds: 3 * 3600 + 25 * 60 + 12, ...over },
    };
}

/** A binder card (overrides win): earned, not foil, no refs, years or progress. */
export function card(over: Partial<BinderCard> & { key: string }): BinderCard {
    return {
        earned: true, foil: false, rare: false, date: '2024-09-14', face: null, refs: {},
        progress: null, years: [], detail: {}, letter: null,
        ...over,
    };
}

export const face = (over: Partial<MemoryMessage> = {}) => memoryMessage(over);

export function binderPayload(): BinderPayload {
    return {
        progress: { earned: 6, total: 8 },
        shelves: [
            {
                key: 'first',
                cards: [
                    card({ key: 'first.message', date: '2024-07-24', face: face({ id: 1, text: '%%%、はじめまして！' }) }),
                    card({ key: 'first.picture', earned: false, date: null }),
                    card({ key: 'first.nickname', foil: true, face: face({ id: 3, text: '%%%ありがとう' }) }),
                ],
            },
            {
                key: 'numbers',
                cards: [card({ key: 'count.messages.1000', earned: false, date: null, progress: { current: 420, target: 1000 } })],
            },
            {
                key: 'special',
                cards: [
                    card({
                        key: 'special.newyear', date: '2026-01-01', face: face({ id: 30, text: 'あけおめ！' }),
                        years: [
                            { year: 2024, date: '2024-01-01', face: face({ id: 10, text: '2024のあけおめ' }) },
                            { year: 2025, date: '2025-01-01', face: face({ id: 20, text: '2025のあけおめ' }) },
                            { year: 2026, date: '2026-01-01', face: face({ id: 30, text: 'あけおめ！' }) },
                        ],
                    }),
                ],
            },
            {
                key: 'you',
                cards: [card({ key: 'you.letter.1', date: '2024-08-01', letter: { date: '2024-08-01', member_path: MEMBER_PATH, id: 1 } })],
            },
            {
                key: 'change',
                cards: [
                    card({
                        key: 'change.avatar.2025-03-01', date: '2025-03-01',
                        face: face({ id: 40, text: '新しいアイコン！' }),
                        refs: {
                            old_last: face({ id: 39, text: '前のアイコン最後' }),
                            new_first: face({ id: 40, text: '新しいアイコン！' }),
                        },
                        detail: { days: 120, messages: 345, old_url: '/api/content/media/old.jpg', new_url: '/api/content/media/new.jpg' },
                    }),
                ],
            },
        ],
    };
}
