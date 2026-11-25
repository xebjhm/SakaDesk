import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { MessagesFeature } from './MessagesFeature';

vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);

const SERVICE = 'hinatazaka46';
const ROOM = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const THUMB = '/api/content/media/hinatazaka46/messages/34%20A/58%20A/profile_images/thumbnail/t.jpg';
const MY_AVATAR = '/api/content/media/hinatazaka46/account/profile_images/thumbnail/me.jpg';

const member = { id: '58', name: '金村 美玖', path: ROOM, thumbnail_local: THUMB, thumbnail: 'https://cdn.example/t.jpg', portrait: null, phone_image: null };

function serve() {
    server.use(
        http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
        http.get('/api/content/messages_by_path', () => HttpResponse.json({
            member,
            messages: [{ id: 1, timestamp: '2024-01-15T09:00:00Z', type: 'text', content: 'こんにちは', is_favorite: false, media_file: null, width: null, height: null }],
            total_count: 1,
            max_message_id: 1,
        })),
        http.get('/api/chat/letters_local', () => HttpResponse.json({
            letters: [{ id: 7, text: '手紙', created_at: '2024-01-15T08:00:00Z', image_url: null, width: null, height: null }],
        })),
        http.get('/api/account/profile', () => HttpResponse.json({ name: 'me', avatars: [{ url: MY_AVATAR, first_seen: '2023-01-01T00:00:00Z' }] })),
        http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
        http.get('/api/chat/streak/:id', () => HttpResponse.json({ status: 'unavailable' })),
    );
}

function setRatio(value: number) {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value });
}

const props = { appSettings: null, syncVersion: 0 };

describe('MessagesFeature avatar sizes', () => {
    const original = window.devicePixelRatio;
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        useAppStore.setState({
            activeService: SERVICE,
            selectedConversations: { [SERVICE]: { path: ROOM, name: '金村 美玖', isGroupChat: false } },
        });
    });
    afterEach(() => setRatio(original));

    it('requests 40 CSS px variants matched to the screen for the header, messages and letters', async () => {
        setRatio(1.75);
        serve();
        render(<MessagesFeature {...props} />);

        const bubble = await screen.findByTestId('message-avatar');
        // 40 CSS px × 1.75 = 70 device px → the 80 px variant
        const resized = '/api/content/avatar/hinatazaka46/messages/34%20A/58%20A/profile_images/thumbnail/t.jpg?w=80';
        expect(within(bubble).getByRole('img')).toHaveAttribute('src', resized);

        const header = screen.getByRole('heading', { name: '金村 美玖' }).closest('[class*="h-16"]') as HTMLElement;
        expect(header.querySelector('img')).toHaveAttribute('src', resized);

        // The letter row shows the user's own archived avatar at the same size.
        expect(await screen.findByRole('img', { name: 'me' })).toHaveAttribute(
            'src',
            '/api/content/avatar/hinatazaka46/account/profile_images/thumbnail/me.jpg?w=80',
        );
    });

    it('re-picks the width for another screen density', async () => {
        setRatio(1);
        serve();
        render(<MessagesFeature {...props} />);
        const bubble = await screen.findByTestId('message-avatar');
        // 40 CSS px at 1x → the smallest variant (64)
        expect(within(bubble).getByRole('img').getAttribute('src')).toMatch(/^\/api\/content\/avatar\/.*\?w=64$/);
    });

    it('keeps the full-size image for the large profile card', async () => {
        setRatio(1.75);
        serve();
        render(<MessagesFeature {...props} />);
        (await screen.findByTestId('message-avatar')).click();
        // The card draws the avatar at 192 CSS px: the original, not a small variant.
        const card = await screen.findByRole('dialog');
        expect(within(card).getByRole('img', { name: '金村 美玖' })).toHaveAttribute('src', THUMB);
    });
});
