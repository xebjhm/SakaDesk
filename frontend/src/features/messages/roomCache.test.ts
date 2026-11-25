import { describe, it, expect } from 'vitest';
import { storeRoom } from './roomCache';

const room = (n: number) => ({ messages: Array.from({ length: n }, (_, i) => i) });

describe('storeRoom', () => {
    it('keeps at most `rooms` entries, evicting the least recently stored', () => {
        const cache = new Map<string, { messages: number[] }>();
        for (const k of ['a', 'b', 'c']) storeRoom(cache, k, room(1), { rooms: 2, messages: 100 });
        expect([...cache.keys()]).toEqual(['b', 'c']);
    });

    it('moves a stored key to the most recent position', () => {
        const cache = new Map<string, { messages: number[] }>();
        storeRoom(cache, 'a', room(1), { rooms: 2, messages: 100 });
        storeRoom(cache, 'b', room(1), { rooms: 2, messages: 100 });
        storeRoom(cache, 'a', room(1), { rooms: 2, messages: 100 });
        storeRoom(cache, 'c', room(1), { rooms: 2, messages: 100 });
        expect([...cache.keys()]).toEqual(['a', 'c']);
    });

    it('evicts the oldest rooms until the message total fits', () => {
        const cache = new Map<string, { messages: number[] }>();
        storeRoom(cache, 'a', room(40), { rooms: 20, messages: 100 });
        storeRoom(cache, 'b', room(40), { rooms: 20, messages: 100 });
        storeRoom(cache, 'c', room(40), { rooms: 20, messages: 100 });
        expect([...cache.keys()]).toEqual(['b', 'c']);
    });

    it('always keeps the room just stored, even alone over the bound', () => {
        const cache = new Map<string, { messages: number[] }>();
        storeRoom(cache, 'a', room(10), { rooms: 20, messages: 100 });
        storeRoom(cache, 'big', room(500), { rooms: 20, messages: 100 });
        expect([...cache.keys()]).toEqual(['big']);
    });
});
