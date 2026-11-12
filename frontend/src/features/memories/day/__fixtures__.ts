import type { DayMember, DayMessage, DayPayload, DayYearsKind, DayYearsMessage, DayYearsPayload, MemoryMessage } from '../types';
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

/** 歷年同一天 for 09-14: 2024 (Miku's おはよう at 07:10 JST, a photo at 15:02), 2025 (おはよう 07:25, おやすみ 23:30). */
export function dayYearsPayload(over: Partial<DayYearsPayload> = {}): DayYearsPayload {
    const m = (member: DayMember, kind: DayYearsKind | null, o: Partial<MemoryMessage>): DayYearsMessage => ({ ...dayMessage(member, o), kind });
    return {
        month_day: '09-14',
        members: [MIKU, NAO],
        years: [
            {
                year: 2024, date: '2024-09-14',
                messages: [
                    m(MIKU, 'ohayo', { id: 11, ts: '2024-09-13T22:10:00Z', text: 'おはよう☀️ 2024' }),
                    m(NAO, 'photo', {
                        id: 12, ts: '2024-09-14T06:02:00Z', type: 'picture', text: null,
                        media_file: 'messages/1 小坂 菜緒/1 小坂 菜緒/picture/12.jpg',
                        media_url: '/api/content/media/hinatazaka46/messages/1/picture/12.jpg',
                    }),
                ],
            },
            {
                year: 2025, date: '2025-09-14',
                messages: [
                    m(MIKU, 'ohayo', { id: 21, ts: '2025-09-13T22:25:00Z', text: 'おはよう！2025' }),
                    m(MIKU, 'oyasumi', { id: 22, ts: '2025-09-14T14:30:00Z', text: 'おやすみ🌙' }),
                ],
            },
        ],
        ...over,
    };
}
