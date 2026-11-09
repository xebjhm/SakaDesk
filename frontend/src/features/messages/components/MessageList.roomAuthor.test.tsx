import { describe, it, expect, vi } from 'vitest';
import type { Message } from '../../../types';
import { avatarClickFor } from './MessageList';

const baseMessage: Message = {
    id: 1,
    timestamp: '2026-01-01T00:00:00Z',
    type: 'text',
    is_favorite: false,
    content: 'hello',
};

describe('avatarClickFor', () => {
    it('keeps the handler for a regular member', () => {
        const spy = vi.fn();
        const handler = avatarClickFor({ ...baseMessage, member_id: 22 }, spy);
        expect(handler).toBe(spy);
        handler?.();
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('drops the handler for member 0 (the room itself)', () => {
        const spy = vi.fn();
        const handler = avatarClickFor({ ...baseMessage, member_id: 0 }, spy);
        expect(handler).toBeUndefined();
        expect(spy).not.toHaveBeenCalled();
    });

    it('drops the handler for "0" as sent by the group endpoint (string id)', () => {
        const spy = vi.fn();
        expect(avatarClickFor({ ...baseMessage, member_id: '0' }, spy)).toBeUndefined();
        expect(avatarClickFor({ ...baseMessage, member_id: '22' }, spy)).toBe(spy);
        expect(avatarClickFor({ ...baseMessage, member_id: '' }, spy)).toBe(spy);
    });

    it('keeps the handler when member_id is absent (non-group chats)', () => {
        const spy = vi.fn();
        expect(avatarClickFor(baseMessage, spy)).toBe(spy);
    });

    it('returns undefined when no handler is provided', () => {
        expect(avatarClickFor({ ...baseMessage, member_id: 22 }, undefined)).toBeUndefined();
    });
});
