import { memoryMessage, MEMBER_PATH } from '../__fixtures__/memories';
import type {
    AlbumColorsPayload, AlbumMembersPayload, AlbumMonthPayload, AlbumMonthSummary, AlbumMonthsPayload, MemoryMessage,
} from '../types';

export { MEMBER_PATH };
export const NAO_PATH = '日向坂46/messages/12 小坂 菜緒/40 小坂 菜緒';
const ROOM = 'messages/34 金村 美玖/58 金村 美玖';

/** A picture of hers in `month` (`YYYY-MM`), id-keyed. */
export function photo(id: number, month: string, over: Partial<MemoryMessage> = {}): MemoryMessage {
    return memoryMessage({
        id,
        room: ROOM,
        ts: `${month}-14T03:${String(id % 60).padStart(2, '0')}:00Z`,
        type: 'picture',
        text: null,
        media_url: `/api/content/media/hinatazaka46/${ROOM}/picture/${id}.jpg`,
        media_file: `${ROOM}/picture/${id}.jpg`,
        ...over,
    });
}

export function membersPayload(over: Partial<AlbumMembersPayload> = {}): AlbumMembersPayload {
    return {
        total: 12,
        members: [
            { member_path: MEMBER_PATH, member_id: '58', name: '金村 美玖', avatar_url: null, count: 9 },
            { member_path: NAO_PATH, member_id: '40', name: '小坂 菜緒', avatar_url: null, count: 3 },
        ],
        ...over,
    };
}

/** Test-only colour strings (runtime data in the app). */
export const CORAL = 'coral';

export function monthSummary(month: string, over: Partial<AlbumMonthSummary> = {}): AlbumMonthSummary {
    return {
        month,
        count: 4,
        cover: photo(1, month, { caption: 'あの日の空、%%%にも見せたかった' }),
        cover_rule: 'score',
        cover_color: CORAL,
        has_favorites: false,
        ...over,
    };
}

export function monthsPayload(months: AlbumMonthSummary[] = [monthSummary('2026-10'), monthSummary('2022-05', { cover_color: null })]): AlbumMonthsPayload {
    return { months };
}

export function monthPayload(month: string, over: Partial<AlbumMonthPayload> = {}): AlbumMonthPayload {
    return {
        month,
        items: [
            photo(1, month, { text: 'おはよう' }),
            photo(2, month, { favorited: true }),
            photo(3, month, { caption: '連写1' }),
            photo(4, month, { caption: '連写2' }),
            photo(5, month, { caption: '連写3' }),
            photo(6, month, { type: 'video', media_url: `/api/content/media/hinatazaka46/${ROOM}/video/6.mp4` }),
        ],
        bursts: [{ burst_id: 7, room: ROOM, ids: [3, 4, 5] }],
        ...over,
    };
}

export function colorsPayload(colors: AlbumColorsPayload['colors'] = { '2026-10': CORAL, '2022-05': null }): AlbumColorsPayload {
    return { colors };
}
