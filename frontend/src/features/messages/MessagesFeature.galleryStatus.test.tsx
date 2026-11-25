import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';

vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);
// The menu (and its media gallery) is a stand-in that records the list state it is handed.
const menu: { status?: string; retry?: () => void } = {};
vi.mock('./components/ConversationMenu', () => ({
    ConversationMenu: ({ messagesStatus, onRetryMessages }: { messagesStatus?: string; onRetryMessages?: () => void }) => {
        menu.status = messagesStatus;
        menu.retry = onRetryMessages;
        return null;
    },
}));

import { MessagesFeature } from './MessagesFeature';

const SERVICE = 'hinatazaka46';
const ROOM = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const member = { id: '58', name: '金村 美玖', path: ROOM, thumbnail_local: null, thumbnail: null, portrait: null, phone_image: null };
const props = { appSettings: null, syncVersion: 0 };

let listReply: () => Promise<Response> | Response;
let listCalls = 0;

function serve() {
    server.use(
        http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
        http.get('/api/content/messages_by_path', () => {
            listCalls += 1;
            return listReply();
        }),
        http.get('/api/chat/letters_local', () => HttpResponse.json({ letters: [] })),
        http.get('/api/account/profile', () => HttpResponse.json({ name: 'me', avatars: [] })),
        http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
        http.get('/api/chat/streak/:id', () => HttpResponse.json({ status: 'unavailable' })),
    );
}
const ok = () => HttpResponse.json({
    member,
    messages: [{ id: 1, timestamp: '2024-01-15T09:00:00Z', type: 'picture', content: null, is_favorite: false, media_file: 'messages/a/picture/1.jpg', width: 10, height: 10 }],
    total_count: 1,
    max_message_id: 1,
});

describe('MessagesFeature → media gallery list state', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        menu.status = undefined;
        menu.retry = undefined;
        listCalls = 0;
        useAppStore.setState({
            activeService: SERVICE,
            selectedConversations: { [SERVICE]: { path: ROOM, name: '金村 美玖', isGroupChat: false } },
        });
    });

    it('is loading until the room list arrives, then ready', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        listReply = async () => { await gate; return ok(); };
        serve();
        render(<MessagesFeature {...props} />);
        await waitFor(() => expect(menu.status).toBe('loading'));
        await act(async () => { release(); });
        await waitFor(() => expect(menu.status).toBe('ready'));
    });

    it.each([
        ['a loaded room', ok],
        ['a room with no messages', () => HttpResponse.json({ member, messages: [], total_count: 0, max_message_id: 0 })],
    ])('%s stays ready during a background refresh (no spinner over its grid or empty state)', async (_name, reply) => {
        listReply = reply;
        serve();
        const { rerender } = render(<MessagesFeature {...props} />);
        await waitFor(() => expect(menu.status).toBe('ready'));
        const before = listCalls;
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const seen: (string | undefined)[] = [];
        listReply = async () => { await gate; return reply(); };
        rerender(<MessagesFeature {...props} syncVersion={1} />);
        await waitFor(() => expect(listCalls).toBe(before + 1));
        seen.push(menu.status);
        await act(async () => { release(); });
        await waitFor(() => expect(menu.status).toBe('ready'));
        expect(seen).toEqual(['ready']);
    });

    it('is error when the room list failed, and Retry loads it again', async () => {
        listReply = () => new HttpResponse(null, { status: 500 });
        serve();
        render(<MessagesFeature {...props} />);
        await waitFor(() => expect(menu.status).toBe('error'));
        const before = listCalls;
        listReply = ok;
        await act(async () => { menu.retry!(); });
        await waitFor(() => expect(menu.status).toBe('ready'));
        expect(listCalls).toBe(before + 1);
    });
});
