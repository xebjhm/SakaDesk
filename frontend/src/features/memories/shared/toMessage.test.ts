import { describe, it, expect } from 'vitest';
import { toChatMessage } from './toMessage';
import { memoryMessage } from '../__fixtures__/memories';

describe('toChatMessage', () => {
    it('maps a text message for MessageBubble', () => {
        expect(toChatMessage(memoryMessage({ id: 7, text: '%%%🌸', favorited: true }))).toEqual({
            id: 7, timestamp: '2024-09-14T12:52:00Z', type: 'text', is_favorite: true, content: '%%%🌸',
        });
    });

    it('carries the media file and duration of a voice or picture', () => {
        const voice = toChatMessage(memoryMessage({ type: 'voice', text: null, media_file: 'messages/x/voice/1.m4a', duration_s: 12.5 }));
        expect(voice).toMatchObject({ type: 'voice', content: null, media_file: 'messages/x/voice/1.m4a', media_duration: 12.5 });
        const pic = toChatMessage(memoryMessage({ type: 'picture', media_file: 'messages/x/picture/1.jpg' }));
        expect(pic).not.toHaveProperty('media_duration');
    });
});
