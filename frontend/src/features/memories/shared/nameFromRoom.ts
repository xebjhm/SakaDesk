import type { MemoryMessage } from '../types';

/** Her name from a room dir's last segment (`58 金村 美玖` → `金村 美玖`): the last resort. */
export const nameFromRoom = (room: string): string => (room.split('/').pop() ?? '').replace(/^\d+\s+/, '');

/**
 * Her display name for a message: the payload's own `name` (album month items, favorites), else
 * `known` (a list lookup), else the room dir's name as the last resort.
 */
export function messageName(m: MemoryMessage & { name?: string }, known?: string): string {
    return m.name || known || nameFromRoom(m.room);
}
