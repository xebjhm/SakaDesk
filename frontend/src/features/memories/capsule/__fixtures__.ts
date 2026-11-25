import { memoryMessage } from '../__fixtures__/memories';
import type { CapsuleNote, CapsuleResurfaceItem } from '../types';

/** One of the fan's capsule notes (overrides win). */
export function capsuleNote(over: Partial<CapsuleNote> = {}): CapsuleNote {
    return {
        id: 7,
        anchor: { kind: 'day', date: '2024-09-14', card_key: null },
        body: 'はじめての握手会🌸\n緊張した',
        created_at: '2024-09-14T13:00:00Z',
        updated_at: '2024-09-14T13:00:00Z',
        ...over,
    };
}

/** A resurfaced note with her words of the anchor day (overrides win). */
export function resurfaceItem(over: Partial<CapsuleResurfaceItem> = {}): CapsuleResurfaceItem {
    return {
        note: capsuleNote(),
        years_ago: 1,
        message: memoryMessage({ id: 41, ts: '2024-09-14T12:52:00Z', text: '%%%、今日はありがとう' }),
        member_path: memoryMessage().member_path,
        name: '金村 美玖',
        ...over,
    };
}
