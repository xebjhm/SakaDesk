import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { clientLog } from '../../utils/clientLog';
import * as timelineModule from './timeline/buildTimeline';
import { MessagesFeature } from './MessagesFeature';

vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../../utils/clientLog', async (orig) => ({ ...(await orig<typeof import('../../utils/clientLog')>()), clientLog: vi.fn() }));
// The sidebar is a stand-in: one button per room, so the test can switch rooms directly.
vi.mock('./components/MemberList', () => ({
    MemberList: ({ onSelectGroup }: { onSelectGroup: (dir: string, group: boolean, name: string) => void }) => (
        <nav>
            <button type="button" onClick={() => onSelectGroup('日向坂46/messages/34 金村 美玖/58 金村 美玖', false, '金村 美玖')}>open A</button>
            <button type="button" onClick={() => onSelectGroup('日向坂46/messages/35 他/59 他', false, '他')}>open B</button>
        </nav>
    ),
}));
vi.mock('./timeline/buildTimeline', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./timeline/buildTimeline')>();
    return { ...actual, buildTimeline: vi.fn(actual.buildTimeline) };
});

const SERVICE = 'hinatazaka46';
const ROOM = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const member = { id: '58', name: '金村 美玖', path: ROOM, thumbnail_local: null, thumbnail: null, portrait: null, phone_image: null };

function serve() {
    server.use(
        http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
        http.get('/api/content/messages_by_path', () => HttpResponse.json({
            member,
            messages: [{ id: 1, timestamp: '2024-01-15T09:00:00Z', type: 'text', content: 'こんにちは', is_favorite: false, media_file: null, width: null, height: null }],
            total_count: 1,
            max_message_id: 1,
        })),
        http.get('/api/chat/letters_local', () => HttpResponse.json({ letters: [] })),
        http.get('/api/account/profile', () => HttpResponse.json({ name: 'me', avatars: [] })),
        http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
        http.get('/api/chat/streak/:id', () => HttpResponse.json({ status: 'unavailable' })),
        http.post('/api/favorites/:id', () => HttpResponse.json({ success: true, message_id: 1, is_favorite: true })),
    );
}

const props = { appSettings: null, syncVersion: 0 };
const star = () => document.querySelector('.text-semantic-star');

async function toggleFromMenu() {
    await screen.findByText('こんにちは');
    await waitFor(() => {
        if (!screen.queryByRole('menuitem', { name: /favorites/ })) fireEvent.contextMenu(screen.getByText('こんにちは'));
        expect(screen.getByRole('menuitem', { name: /favorites/ })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('menuitem', { name: /favorites/ }));
}

describe('MessagesFeature: ★ without rebuilding the timeline (UI health #1)', () => {
    let consoleError: ReturnType<typeof vi.spyOn>;
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    afterEach(() => { consoleError.mockRestore(); });
    beforeEach(() => {
        vi.mocked(timelineModule.buildTimeline).mockClear();
        vi.mocked(clientLog).mockClear();
        consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        useAppStore.setState({
            activeService: SERVICE,
            selectedConversations: { [SERVICE]: { path: ROOM, name: '金村 美玖', isGroupChat: false } },
        });
        serve();
    });

    it('lights the star without calling buildTimeline again', async () => {
        render(<MessagesFeature {...props} />);
        await screen.findByText('こんにちは');
        const builds = vi.mocked(timelineModule.buildTimeline).mock.calls.length;

        await toggleFromMenu();

        await waitFor(() => expect(star()).not.toBeNull());
        expect(vi.mocked(timelineModule.buildTimeline).mock.calls.length).toBe(builds);
    });

    it('a failed save keeps the optimistic star until the answer, then reverts without a rebuild and logs a code-only breadcrumb', async () => {
        let answer!: () => void;
        const gate = new Promise<void>((resolve) => { answer = resolve; });
        server.use(http.post('/api/favorites/:id', async () => {
            await gate;
            return HttpResponse.json({ detail: 'x' }, { status: 500 });
        }));
        render(<MessagesFeature {...props} />);
        await screen.findByText('こんにちは');
        const builds = vi.mocked(timelineModule.buildTimeline).mock.calls.length;

        await toggleFromMenu();

        await waitFor(() => expect(star()).not.toBeNull());
        answer();
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('chat_load', { outcome: 'favorite_save_failed', message_id: 1 }));
        await waitFor(() => expect(star()).toBeNull());
        expect(vi.mocked(timelineModule.buildTimeline).mock.calls.length).toBe(builds);
    });

    it('a saved star is patched into the cached room: shown at once on a return visit, before the refresh answers', async () => {
        const OTHER = '日向坂46/messages/35 他/59 他';
        render(<MessagesFeature {...props} />);
        await toggleFromMenu();
        await waitFor(() => expect(star()).not.toBeNull());

        // Away to another room, then back; the return refresh is held so only the cache can show the star.
        const hold = new Promise<void>(() => {});
        server.use(http.get('/api/content/messages_by_path', async ({ request }) => {
            const path = new URL(request.url).searchParams.get('path');
            if (path === ROOM) await hold;
            return HttpResponse.json({
                member: { ...member, id: '59', path: OTHER },
                messages: [{ id: 2, timestamp: '2024-01-16T09:00:00Z', type: 'text', content: 'べつ', is_favorite: false, media_file: null, width: null, height: null }],
                total_count: 1, max_message_id: 2,
            });
        }));
        await userEvent.click(screen.getByRole('button', { name: 'open B' }));
        await screen.findByText('べつ');
        expect(star()).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'open A' }));
        await screen.findByText('こんにちは');
        expect(star()).not.toBeNull();
    });
});
