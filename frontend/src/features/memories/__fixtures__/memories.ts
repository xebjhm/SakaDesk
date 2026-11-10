import type { MemoryMessage } from '../types';

export const MEMBER_PATH = '日向坂46/messages/34 金村 美玖/58 金村 美玖';

/** One of her messages in the shared message-object shape (overrides win). */
export function memoryMessage(over: Partial<MemoryMessage> = {}): MemoryMessage {
    return {
        id: 123,
        room: 'messages/34 金村 美玖/58 金村 美玖',
        member_path: MEMBER_PATH,
        service: 'hinatazaka46',
        ts: '2024-09-14T12:52:00Z',
        type: 'text',
        text: '%%%、おはよう🌸',
        caption: null,
        caption_id: null,
        media_url: null,
        media_file: null,
        duration_s: null,
        favorited: false,
        avatar_url: null,
        ...over,
    };
}
