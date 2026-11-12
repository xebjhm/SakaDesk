import type { MemoryMessage } from '../types';

const textKey = (service: string, room: string, id: number) => `${service}|${room}|${id}`;

/**
 * The text messages of a day list, keyed `service|room|id`: the words already shown as their own
 * bubble or frame. Pass the list as rendered (after any member filter).
 */
export function shownTexts(messages: readonly MemoryMessage[]): Set<string> {
    const keys = new Set<string>();
    for (const m of messages) if (m.type === 'text') keys.add(textKey(m.service, m.room, m.id));
    return keys;
}

/**
 * A picture's or video's paired words for a day-context view: `caption`, unless the message it
 * comes from (`caption_id`, same room) is already in the list, where her words are shown once,
 * as that message. Single-item views (album, cork board, card faces) keep `caption` as is.
 */
export function contextCaption(m: MemoryMessage, shown: ReadonlySet<string>): string | null {
    if (!m.caption) return null;
    if (m.caption_id !== null && shown.has(textKey(m.service, m.room, m.caption_id))) return null;
    return m.caption;
}
