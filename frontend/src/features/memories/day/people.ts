import type { DayMember, MemoryMessage } from '../types';

/**
 * Who sent a message. The day payload's members carry only the chat path of their newest room,
 * while a message carries its own room, and one person can have several rooms. The backend
 * groups rooms into a person by the normalised name of the room folder
 * (`backend/services/memories/names.py` `normalize_member_name`); this mirrors it per service.
 */

const SUFFIX = /[（(][^）)]*[）)]$/;

/** NFKC, no whitespace, no trailing "(group)" suffix (as the backend). */
function normalizeName(name: string): string {
    return name.normalize('NFKC').trim().replace(SUFFIX, '').replace(/\s+/g, '');
}

/** Her name as written on a room folder (`<id> <name>`, the room's last segment). */
export function roomName(room: string): string {
    const last = room.split('/').pop() ?? '';
    const space = last.indexOf(' ');
    return space < 0 ? last : last.slice(space + 1);
}

/** A person's key within one service. */
export function memberKey(member: Pick<DayMember, 'service' | 'name'>): string {
    return `${member.service}|${normalizeName(member.name)}`;
}

/** The key of the person who sent `m` (matches {@link memberKey}). */
export function messageKey(m: Pick<MemoryMessage, 'service' | 'room'>): string {
    return `${m.service}|${normalizeName(roomName(m.room))}`;
}

/** One person of the day with her messages in time order (a swimlane, a chip). */
export interface DayPerson {
    key: string;
    name: string;
    avatarUrl: string | null;
    service: string;
    /** Her chat path (the newest room); a message's own `member_path` is used to jump. */
    memberPath: string;
    oshi: boolean;
    messages: MemoryMessage[];
}

/**
 * The day's people in the payload's order (oshi first), each with her messages. A message whose
 * sender is not among `members` (never expected) still gets a person of its own, named after
 * its room folder, so nothing she sent is dropped.
 */
export function dayPeople(members: DayMember[], messages: MemoryMessage[]): DayPerson[] {
    const byKey = new Map<string, DayPerson>();
    for (const m of members) {
        const key = memberKey(m);
        if (!byKey.has(key)) {
            byKey.set(key, {
                key, name: m.name, avatarUrl: m.avatar_url, service: m.service, memberPath: m.member_path, oshi: m.oshi, messages: [],
            });
        }
    }
    for (const msg of messages) {
        const key = messageKey(msg);
        let person = byKey.get(key);
        if (!person) {
            person = {
                key, name: roomName(msg.room), avatarUrl: msg.avatar_url, service: msg.service, memberPath: msg.member_path, oshi: false, messages: [],
            };
            byKey.set(key, person);
        }
        person.messages.push(msg);
    }
    return [...byKey.values()].filter((p) => p.messages.length > 0);
}
