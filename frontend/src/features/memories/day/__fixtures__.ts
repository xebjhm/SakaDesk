import type { DayMember, DayMessage, DayPayload, MemoryMessage } from '../types';
import { MEMBER_PATH, memoryMessage } from '../__fixtures__/memories';

export const KOSAKA_PATH = '日向坂46/messages/1 小坂 菜緒/1 小坂 菜緒';
export const MORITA_PATH = '櫻坂46/messages/9 森田 ひかる/9 森田 ひかる';

export const MIKU: DayMember = {
    member_path: MEMBER_PATH, member_id: '58', name: '金村 美玖', avatar_url: null, service: 'hinatazaka46', oshi: true,
    person_key: 'hinatazaka46|messages/34 金村 美玖/58 金村 美玖',
};
export const NAO: DayMember = {
    member_path: KOSAKA_PATH, member_id: '1', name: '小坂 菜緒', avatar_url: null, service: 'hinatazaka46', oshi: false,
    person_key: 'hinatazaka46|messages/1 小坂 菜緒/1 小坂 菜緒',
};
export const HIKARU: DayMember = {
    member_path: MORITA_PATH, member_id: '9', name: '森田 ひかる', avatar_url: null, service: 'sakurazaka46', oshi: false,
    person_key: 'sakurazaka46|messages/9 森田 ひかる/9 森田 ひかる',
};

/** One of `member`'s messages that day (her room, path, service and key; overrides win). */
export function dayMessage(member: DayMember, over: Partial<MemoryMessage> = {}): DayMessage {
    const room = member.member_path.slice(member.member_path.indexOf('/') + 1);
    return {
        ...memoryMessage({ room, member_path: member.member_path, service: member.service }),
        person_key: member.person_key,
        ...over,
    };
}

/** One concert day: Miku at 13:02 and 21:52 JST, Nao's photo at 13:15 JST. */
export function dayPayload(over: Partial<DayPayload> = {}): DayPayload {
    return {
        date: '2024-09-14',
        members: [MIKU, NAO],
        messages: [
            dayMessage(MIKU, { id: 1, ts: '2024-09-14T04:02:00Z', text: 'リハ終わり！' }),
            dayMessage(NAO, {
                id: 2, ts: '2024-09-14T04:15:00Z', type: 'picture', text: null,
                media_file: 'messages/1 小坂 菜緒/1 小坂 菜緒/picture/2.jpg',
                media_url: '/api/content/media/hinatazaka46/messages/1/picture/2.jpg',
            }),
            dayMessage(MIKU, { id: 3, ts: '2024-09-14T12:52:00Z', text: '最高の景色だった…%%%' }),
        ],
        other_services: [],
        ...over,
    };
}
