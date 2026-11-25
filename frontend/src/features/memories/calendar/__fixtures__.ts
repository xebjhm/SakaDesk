import { memoryMessage } from '../__fixtures__/memories';
import type { CalendarDay, CalendarMonthPayload, CalendarMonthsPayload, MemoryMessage } from '../types';

const ROOM = 'messages/34 金村 美玖/58 金村 美玖';

/** A day's text-free cell photo (the backend leaves `text`, `caption` and `avatar_url` null). */
export function cellPhoto(id: number, date: string, over: Partial<MemoryMessage> = {}): MemoryMessage {
    return memoryMessage({
        id,
        room: ROOM,
        ts: `${date}T03:00:00Z`,
        type: 'picture',
        text: null,
        media_url: `/api/content/media/hinatazaka46/${ROOM}/picture/${id}.jpg`,
        media_file: `${ROOM}/picture/${id}.jpg`,
        ...over,
    });
}

export function calendarDay(date: string, members: number, photo: MemoryMessage | null = null): CalendarDay {
    return { date, members, photo, photo_rule: photo ? 'score' : null };
}

export function monthsPayload(months: string[] = ['2023-12', '2024-08', '2024-09']): CalendarMonthsPayload {
    return { months };
}

/** September 2024: the 14th (Saturday) with a photo and 7 people, the 16th (敬老の日) with 2 and no photo. */
export function monthPayload(month = '2024-09', days?: CalendarDay[]): CalendarMonthPayload {
    return {
        month,
        days: days ?? [
            calendarDay(`${month}-14`, 7, cellPhoto(41, `${month}-14`)),
            calendarDay(`${month}-16`, 2),
        ],
    };
}
