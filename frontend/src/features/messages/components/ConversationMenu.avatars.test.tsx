import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';

const captured: Record<string, string | undefined> = {};
vi.mock('../../../core/media/MediaGalleryModal', () => ({
    MediaGalleryModal: ({ memberAvatar }: { memberAvatar?: string }) => { captured.gallery = memberAvatar; return null; },
}));
vi.mock('../../../core/modals/FavoritesModal', () => ({
    FavoritesModal: ({ memberAvatar }: { memberAvatar?: string }) => { captured.favorites = memberAvatar; return null; },
}));
import { ConversationMenu } from './ConversationMenu';

const LOCAL = '/api/content/media/hinatazaka46/messages/34%20A/58%20A/profile_images/thumbnail/t.jpg';
const RESIZED = '/api/content/avatar/hinatazaka46/messages/34%20A/58%20A/profile_images/thumbnail/t.jpg';

function renderMenu(memberAvatar: string) {
    render(
        <ConversationMenu
            conversationPath="p"
            isGroupChat={false}
            messages={[]}
            memberName="金村 美玖"
            memberAvatar={memberAvatar}
            onOpenCalendar={vi.fn()}
            letters={[]}
            lettersStatus="ready"
            onJumpToLetter={vi.fn()}
        />,
    );
}

describe('ConversationMenu avatar sizes', () => {
    const original = window.devicePixelRatio;
    afterEach(() => Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: original }));

    it('hands the media gallery (48 CSS px) and favourites (40 CSS px) variants matched to the screen', () => {
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: 1.75 });
        renderMenu(LOCAL);
        // 48 × 1.75 = 84 → 96; 40 × 1.75 = 70 → 80
        expect(captured.gallery).toBe(`${RESIZED}?w=96`);
        expect(captured.favorites).toBe(`${RESIZED}?w=80`);
    });

    it('passes a CDN avatar through unchanged', () => {
        renderMenu('https://cdn.example/t.jpg');
        expect(captured.gallery).toBe('https://cdn.example/t.jpg');
        expect(captured.favorites).toBe('https://cdn.example/t.jpg');
    });
});
