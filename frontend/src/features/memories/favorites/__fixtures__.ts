import { MEMBER_PATH, memoryMessage } from '../__fixtures__/memories';
import type { FavoriteItem, FavoritesPayload, MemoryMessage } from '../types';

export { MEMBER_PATH };
export const NAO_PATH = '日向坂46/messages/12 小坂 菜緒/40 小坂 菜緒';
const ROOM = 'messages/34 金村 美玖/58 金村 美玖';

/** One of her ★ messages (favourited, star time unknown; overrides win). */
export function favorite(id: number, over: Partial<MemoryMessage & { favorited_at: string | null }> = {}): FavoriteItem {
    return { ...memoryMessage({ id, favorited: true }), favorited_at: null, ...over };
}

export const NOTE = favorite(11, { text: 'ライブありがとう！%%%の声、ちゃんと届いてたよ🌸', ts: '2024-09-14T12:52:00Z' });
export const PRINT = favorite(12, {
    type: 'picture', text: null, caption: '今日の空', ts: '2024-08-01T09:00:00Z',
    media_url: `/api/content/media/hinatazaka46/${ROOM}/picture/12.jpg`, media_file: `${ROOM}/picture/12.jpg`,
});
export const VOICE = favorite(13, {
    type: 'voice', text: null, ts: '2023-12-31T15:30:00Z', duration_s: 75,
    media_url: `/api/content/media/hinatazaka46/${ROOM}/voice/13.m4a`, media_file: `${ROOM}/voice/13.m4a`,
});

export function favoritesPayload(over: Partial<FavoritesPayload> = {}): FavoritesPayload {
    return {
        total: 4,
        members: [
            { member_path: MEMBER_PATH, member_id: '58', name: '金村 美玖', avatar_url: null, count: 3 },
            { member_path: NAO_PATH, member_id: '40', name: '小坂 菜緒', avatar_url: null, count: 1 },
        ],
        items: [NOTE, PRINT, VOICE],
        ...over,
    };
}
