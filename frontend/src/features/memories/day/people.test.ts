import { describe, it, expect } from 'vitest';
import { dayPeople, roomName } from './people';
import { MIKU, NAO, dayMessage } from './__fixtures__';

describe('day people', () => {
    it('reads her name from the room folder', () => {
        expect(roomName('messages/34 金村 美玖/58 金村 美玖')).toBe('金村 美玖');
    });

    it('groups a person’s rooms by the backend person key, in member order', () => {
        const older = dayMessage(MIKU, { id: 7, room: 'messages/12 金村美玖（ひらがな）/3 金村美玖' });
        const people = dayPeople([MIKU, NAO], [dayMessage(NAO, { id: 1 }), older, dayMessage(MIKU, { id: 8 })]);
        expect(people.map((p) => p.name)).toEqual(['金村 美玖', '小坂 菜緒']);
        expect(people[0].messages.map((m) => m.id)).toEqual([7, 8]);
    });

    it('keeps a message from an unknown person under her room name', () => {
        const stray = dayMessage({ ...NAO, person_key: 'x|y' }, { id: 3, room: 'messages/9 森田 ひかる/9 森田 ひかる' });
        expect(dayPeople([MIKU], [stray]).map((p) => p.name)).toEqual(['森田 ひかる']);
    });

    it('trusts the key, never the name: two keys with the same room name stay two people', () => {
        const twin = { ...MIKU, person_key: 'hinatazaka46|messages/99 金村 美玖/99 金村 美玖' };
        const people = dayPeople([MIKU, twin], [dayMessage(MIKU, { id: 1 }), dayMessage(twin, { id: 2 })]);
        expect(people).toHaveLength(2);
        expect(people.map((p) => p.messages.map((m) => m.id))).toEqual([[1], [2]]);
    });

    it('drops members without a message that day', () => {
        expect(dayPeople([MIKU, NAO], [dayMessage(NAO)]).map((p) => p.key)).toEqual([NAO.person_key]);
    });
});
