import { memoryMessage } from '../__fixtures__/memories';
import type { FirstMeetPayload } from '../types';

/** 初見と今 with an おはよう row (1 year 8 days) and a photo row (5 days). */
export function firstMeet(over: Partial<FirstMeetPayload> = {}): FirstMeetPayload {
    return {
        mode: 'first_meet',
        rows: [
            {
                kind: 'ohayo',
                then: memoryMessage({ id: 13, ts: '2025-11-01T22:40:00Z', text: 'はじめてのおはよう、緊張する…！' }),
                now: memoryMessage({ id: 14, ts: '2026-11-09T22:05:00Z', text: 'おはよ〜 今日も一日がんばろうね☀️' }),
                elapsed: { years: 1, days: 8 },
            },
            {
                kind: 'photo',
                then: memoryMessage({
                    id: 11, type: 'picture', text: null, caption: '初めて送る写真！', ts: '2025-11-03T09:22:00Z',
                    media_url: '/api/content/media/hinatazaka46/a.jpg', media_file: 'messages/a.jpg',
                }),
                now: memoryMessage({
                    id: 12, type: 'picture', text: null, ts: '2025-11-08T06:10:00Z',
                    media_url: '/api/content/media/hinatazaka46/b.jpg', media_file: 'messages/b.jpg',
                }),
                elapsed: { years: 0, days: 5 },
            },
        ],
        avatar_then: null,
        avatar_now: null,
        ...over,
    };
}
