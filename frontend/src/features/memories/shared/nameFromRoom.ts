/** Her name from a room dir's last segment (`58 金村 美玖` → `金村 美玖`), when a list does not know the room. */
export const nameFromRoom = (room: string): string => (room.split('/').pop() ?? '').replace(/^\d+\s+/, '');
