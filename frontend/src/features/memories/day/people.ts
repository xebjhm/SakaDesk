import type { DayMember, DayMessage } from '../types';

/** Her name as written on a room folder (`<id> <name>`, the room's last segment). */
export function roomName(room: string): string {
    const last = room.split('/').pop() ?? '';
    const space = last.indexOf(' ');
    return space < 0 ? last : last.slice(space + 1);
}

/** One person of the day with her messages in time order (a swimlane, a chip). */
export interface DayPerson {
    /** The backend's `person_key` (all her rooms, unique across services). */
    key: string;
    name: string;
    avatarUrl: string | null;
    service: string;
    oshi: boolean;
    messages: DayMessage[];
}

/**
 * The day's people in the payload's order (oshi first), each with her messages, grouped by the
 * backend's `person_key` (one person can post from several rooms). A message whose key is not
 * among `members` (never expected) still gets a person of its own, named after its room
 * folder, so nothing she sent is dropped.
 */
export function dayPeople(members: DayMember[], messages: DayMessage[]): DayPerson[] {
    const byKey = new Map<string, DayPerson>();
    for (const m of members) {
        if (!byKey.has(m.person_key)) {
            byKey.set(m.person_key, {
                key: m.person_key, name: m.name, avatarUrl: m.avatar_url, service: m.service, oshi: m.oshi, messages: [],
            });
        }
    }
    for (const msg of messages) {
        let person = byKey.get(msg.person_key);
        if (!person) {
            person = {
                key: msg.person_key, name: roomName(msg.room), avatarUrl: msg.avatar_url, service: msg.service, oshi: false, messages: [],
            };
            byKey.set(msg.person_key, person);
        }
        person.messages.push(msg);
    }
    return [...byKey.values()].filter((p) => p.messages.length > 0);
}
