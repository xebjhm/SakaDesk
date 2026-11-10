import { MEMBER_PATH, memoryMessage } from '../__fixtures__/memories';
import type { ThenNowDayPayload, ThenNowFirstWeekPayload } from '../types';

/** A day-mode pair: 2024-09-14 beside 2026-09-14, the same person, 花火 shared. */
export function thenNowDay(over: Partial<ThenNowDayPayload> = {}): ThenNowDayPayload {
    return {
        mode: 'day',
        then: {
            year: 2024, date: '2024-09-14', member_path: MEMBER_PATH, name: '金村 美玖', avatar_url: null,
            items: [memoryMessage({ id: 1, ts: '2024-09-14T12:00:00Z', text: '花火きれい🎆' })],
        },
        now: {
            year: 2026, date: '2026-09-14', member_path: MEMBER_PATH, name: '金村 美玖', avatar_url: null,
            items: [memoryMessage({ id: 2, ts: '2026-09-14T12:00:00Z', text: '今年も花火！' })],
        },
        shared_keyword: '花火',
        ...over,
    };
}

/** 初見 vs 今 with a photo row and an おはよう row. */
export function thenNowFirstWeek(over: Partial<ThenNowFirstWeekPayload> = {}): ThenNowFirstWeekPayload {
    return {
        mode: 'first_week',
        then_range: ['2023-03-01', '2023-03-07'],
        now_range: ['2026-11-04', '2026-11-10'],
        rows: [
            {
                kind: 'photo',
                then: memoryMessage({ id: 11, type: 'picture', text: null, ts: '2023-03-02T03:00:00Z', media_url: '/api/content/media/hinatazaka46/a.jpg' }),
                now: memoryMessage({ id: 12, type: 'picture', text: null, ts: '2026-11-05T03:00:00Z', media_url: '/api/content/media/hinatazaka46/b.jpg' }),
            },
            {
                kind: 'ohayo',
                then: memoryMessage({ id: 13, ts: '2023-03-01T22:00:00Z', text: 'おはようございます' }),
                now: memoryMessage({ id: 14, ts: '2026-11-09T22:00:00Z', text: 'おはよう☀️' }),
            },
        ],
        avatar_then: null,
        avatar_now: null,
        ...over,
    };
}
