import type { DayMember, DayPayload } from '../types';
import { MEMBER_PATH, memoryMessage } from '../__fixtures__/memories';

export const KOSAKA_PATH = '日向坂46/messages/1 小坂 菜緒/1 小坂 菜緒';

export const MIKU: DayMember = {
    member_path: MEMBER_PATH, member_id: '58', name: '金村 美玖', avatar_url: null, service: 'hinatazaka46', oshi: true,
};
export const NAO: DayMember = {
    member_path: KOSAKA_PATH, member_id: '1', name: '小坂 菜緒', avatar_url: null, service: 'hinatazaka46', oshi: false,
};

/** One concert day: Miku at 13:02 and 21:52, Nao's photo at 13:15 (all UTC). */
export function dayPayload(over: Partial<DayPayload> = {}): DayPayload {
    return {
        date: '2024-09-14',
        members: [MIKU, NAO],
        messages: [
            memoryMessage({ id: 1, ts: '2024-09-14T04:02:00Z', text: 'リハ終わり！' }),
            memoryMessage({
                id: 2, ts: '2024-09-14T04:15:00Z', type: 'picture', text: null,
                room: 'messages/1 小坂 菜緒/1 小坂 菜緒', member_path: KOSAKA_PATH,
                media_file: 'messages/1 小坂 菜緒/1 小坂 菜緒/picture/2.jpg',
                media_url: '/api/content/media/hinatazaka46/messages/1/picture/2.jpg',
            }),
            memoryMessage({ id: 3, ts: '2024-09-14T12:52:00Z', text: '最高の景色だった…%%%' }),
        ],
        other_services: [],
        ...over,
    };
}
