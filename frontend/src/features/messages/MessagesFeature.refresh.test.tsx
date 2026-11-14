import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import type { Timeline } from './timeline/buildTimeline';
import { MessagesFeature } from './MessagesFeature';
import { clientLog } from '../../utils/clientLog';

vi.mock('../../utils/clientLog', async (orig) => ({ ...(await orig<typeof import('../../utils/clientLog')>()), clientLog: vi.fn() }));
const chatLoads = () => vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'chat_load');

// Every timeline the list was given, in render order: a 304 must not produce a new one.
const timelines: Timeline[] = [];
vi.mock('./components/MessageList', () => ({
    MessageList: (p: { timeline: Timeline }) => {
        timelines.push(p.timeline);
        return <div data-testid="list">{p.timeline.items.length}</div>;
    },
}));
vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);

const SERVICE = 'hinatazaka46';
const ROOM = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const member = { id: '58', name: '金村 美玖', path: ROOM, thumbnail_local: null, thumbnail: null, portrait: null, phone_image: null };
const body = (content: string) => ({
    member,
    messages: [{ id: 1, timestamp: '2024-01-15T09:00:00Z', type: 'text', content, is_favorite: false, media_file: null, width: null, height: null }],
    total_count: 1,
    max_message_id: 1,
});

interface Seen { tag: string | null; lastRead: string | null }
let seen: Seen[] = [];
let version = '"v1"';
let content = 'こんにちは';

function serve() {
    server.use(
        http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
        http.get('/api/content/messages_by_path', ({ request }) => {
            const tag = request.headers.get('If-None-Match');
            seen.push({ tag, lastRead: new URL(request.url).searchParams.get('last_read_id') });
            if (tag === version) return new HttpResponse(null, { status: 304, headers: { ETag: version } });
            return HttpResponse.json(body(content), { headers: { ETag: version } });
        }),
        http.get('/api/chat/letters_local', () => HttpResponse.json({ letters: [] })),
        http.get('/api/account/profile', () => HttpResponse.json({ name: 'me', avatars: [] })),
        http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
        http.get('/api/chat/streak/:id', () => HttpResponse.json({ status: 'unavailable' })),
    );
}

const props = { appSettings: null, syncVersion: 0 };

describe('MessagesFeature: conditional room refresh (UI health #1)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        vi.mocked(clientLog).mockClear();
        timelines.length = 0;
        seen = [];
        version = '"v1"';
        content = 'こんにちは';
        useAppStore.setState({
            activeService: SERVICE,
            selectedConversations: { [SERVICE]: { path: ROOM, name: '金村 美玖', isGroupChat: false } },
        });
        serve();
    });

    it('sends the ETag on a refresh and keeps the same timeline on a 304', async () => {
        const { rerender, findByTestId } = render(<MessagesFeature {...props} />);
        await findByTestId('list');
        const shown = timelines[timelines.length - 1];

        rerender(<MessagesFeature {...props} syncVersion={1} />);
        // The breadcrumb is logged after the 304 was handled: the refresh has fully run.
        await waitFor(() => expect(chatLoads()).toEqual([['chat_load', { outcome: 'not_modified' }]]));

        expect(seen.map((s) => s.tag)).toEqual([null, '"v1"']);
        expect(timelines[timelines.length - 1]).toBe(shown);
    });

    it('a 304 for a room that is not cached is a failed load: error_code 304, no room kept', async () => {
        // The server answers 304 although no ETag was sent (the room was evicted while the request ran).
        server.use(http.get('/api/content/messages_by_path', () => new HttpResponse(null, { status: 304 })));
        const { queryByTestId } = render(<MessagesFeature {...props} />);
        await waitFor(() => expect(chatLoads()).toHaveLength(1));
        expect(chatLoads()[0]).toEqual(['chat_load', { outcome: 'error_state', reason: 'error', error_code: 304 }]);
        expect(queryByTestId('list')).toBeNull();
    });

    it('never sends last_read_id (the read position must not change the ETag)', async () => {
        const { rerender, findByTestId } = render(<MessagesFeature {...props} />);
        await findByTestId('list');
        rerender(<MessagesFeature {...props} syncVersion={1} />);
        await waitFor(() => expect(seen).toHaveLength(2));
        expect(seen.map((s) => s.lastRead)).toEqual([null, null]);
    });

    it('replaces the room and remembers the new ETag when it changed', async () => {
        const { rerender, findByTestId } = render(<MessagesFeature {...props} />);
        await findByTestId('list');
        const before = timelines[timelines.length - 1];

        version = '"v2"';
        content = '更新';
        rerender(<MessagesFeature {...props} syncVersion={1} />);
        await waitFor(() => expect(timelines[timelines.length - 1]).not.toBe(before));

        rerender(<MessagesFeature {...props} syncVersion={2} />);
        await waitFor(() => expect(seen).toHaveLength(3));
        expect(seen.map((s) => s.tag)).toEqual([null, '"v1"', '"v2"']);
    });
});
