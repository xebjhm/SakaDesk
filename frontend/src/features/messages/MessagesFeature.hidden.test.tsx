import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { FeatureActiveContext } from '../../design/featureActive';
import { clientLog } from '../../utils/clientLog';
import { useMilestone } from './milestones';
import { MessagesFeature } from './MessagesFeature';
import { ContentArea } from '../../core/layout/ContentArea';
import { openChat } from '../../shell/openChat';

vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('./milestones', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./milestones')>();
    return { ...actual, useMilestone: vi.fn(actual.useMilestone) };
});
vi.mock('../blogs', () => ({ BlogsFeature: () => <div>blogs</div> }));
vi.mock('../memories', () => ({ MemoriesFeature: () => <div>memories</div> }));
vi.mock('../../utils/clientLog', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/clientLog')>()),
    clientLog: vi.fn(),
}));

const SERVICE = 'hinatazaka46';
const ROOM = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const OTHER = 'sakurazaka46';
const OTHER_ROOM = '櫻坂46/messages/40 森田 ひかる/60 森田 ひかる';
const SECOND_ROOM = '日向坂46/messages/35 小坂 菜緒/59 小坂 菜緒';
const member = { id: '58', name: '金村 美玖', path: ROOM, thumbnail_local: null, thumbnail: null, portrait: null, phone_image: null };
let archived = false;
let roomFetches = 0;
/** The `path` of every room fetch, in order. */
let roomPaths: string[] = [];
let letterFetches = 0;
let readSyncs: string[] = [];
/** Group ids of the read syncs, in order (the room ids of ROOM / SECOND_ROOM are 34 / 35). */
let readSyncGroups: number[] = [];
let uiStates: { group_id: string | null }[] = [];

function serve() {
    server.use(
        http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
        http.get('/api/content/messages_by_path', ({ request }) => {
            roomFetches += 1;
            roomPaths.push(new URL(request.url).searchParams.get('path') ?? '');
            return HttpResponse.json({
                member,
                messages: [{ id: 1, timestamp: '2024-01-15T09:00:00Z', type: 'text', content: 'こんにちは', is_favorite: archived, media_file: null, width: null, height: null }],
                total_count: 1,
                max_message_id: 1,
            });
        }),
        http.post('/api/ui-state', async ({ request }) => {
            uiStates.push(await request.json() as { group_id: string | null });
            return new HttpResponse(null, { status: 204 });
        }),
        http.post('/api/chat/mark-room-read-remote', async ({ request }) => {
            const body = await request.json() as { service: string; group_id: number };
            readSyncs.push(body.service);
            readSyncGroups.push(body.group_id);
            return HttpResponse.json({ ok: true });
        }),
        http.get('/api/chat/letters_local', () => {
            letterFetches += 1;
            return HttpResponse.json({ letters: [] });
        }),
        http.get('/api/chat/message_dates/*', () => HttpResponse.json({ dates: [] })),
        http.get('/api/account/profile', () => HttpResponse.json({ name: 'me', avatars: [] })),
        http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
        http.get('/api/chat/streak/:id', () => HttpResponse.json({ status: 'unavailable' })),
    );
}

const READ_SYNC_ON = { sync_read_to_phone: true } as never;
const view = (active: boolean, syncVersion = 0, appSettings: never | null = null) => (
    <FeatureActiveContext.Provider value={active}>
        <MessagesFeature appSettings={appSettings} syncVersion={syncVersion} />
    </FeatureActiveContext.Provider>
);
const lastMilestoneRoom = () => {
    const calls = vi.mocked(useMilestone).mock.calls;
    return calls[calls.length - 1]?.[0].roomKey;
};
const star = () => document.querySelector('.text-semantic-star');

describe('MessagesFeature hidden behind another feature (UI health #11)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        archived = false;
        roomFetches = 0;
        roomPaths = [];
        letterFetches = 0;
        readSyncs = [];
        readSyncGroups = [];
        uiStates = [];
        vi.mocked(clientLog).mockClear();
        vi.mocked(useMilestone).mockClear();
        useAppStore.setState({
            activeService: SERVICE,
            selectedConversations: { [SERVICE]: { path: ROOM, name: '金村 美玖', isGroupChat: false } },
        });
        serve();
    });

    it('does not fetch on a finished sync while hidden, and refreshes once when shown', async () => {
        const { rerender } = render(view(true));
        await screen.findByText('こんにちは');
        expect(roomFetches).toBe(1);
        rerender(view(false));
        rerender(view(false, 1));
        await new Promise((r) => setTimeout(r, 50));
        expect(roomFetches).toBe(1);
        rerender(view(true, 1));
        await waitFor(() => expect(roomFetches).toBe(2));
    });

    it('stops reporting the chat as viewed while hidden', async () => {
        const { rerender } = render(view(true));
        await screen.findByText('こんにちは');
        rerender(view(false));
        await waitFor(() => expect(uiStates[uiStates.length - 1]).toMatchObject({ group_id: null }));
    });

    it('shows a star set elsewhere (e.g. the Memories gacha) when shown again', async () => {
        const { rerender } = render(view(true));
        await screen.findByText('こんにちは');
        expect(star()).toBeNull();
        rerender(view(false));
        archived = true;
        rerender(view(true));
        await waitFor(() => expect(star()).not.toBeNull());
    });

    it('asks for no room extras on a finished sync while hidden, and catches up when shown', async () => {
        const { rerender } = render(view(true));
        await screen.findByText('こんにちは');
        const before = letterFetches;
        rerender(view(false));
        rerender(view(false, 1));
        await new Promise((r) => setTimeout(r, 50));
        expect(letterFetches).toBe(before);
        rerender(view(true, 1));
        await waitFor(() => expect(letterFetches).toBe(before + 1));
    });

    it('evaluates no milestone while hidden', async () => {
        const { rerender } = render(view(true));
        await screen.findByText('こんにちは');
        rerender(view(false));
        expect(lastMilestoneRoom()).toBeNull();
        rerender(view(true));
        await waitFor(() => expect(lastMilestoneRoom()).not.toBeNull());
    });

    it('defers the room restore and the read sync of a group switch made while hidden', async () => {
        const { rerender } = render(view(true, 0, READ_SYNC_ON));
        await screen.findByText('こんにちは');
        await waitFor(() => expect(readSyncs).toEqual([SERVICE]));
        const fetchesBefore = roomFetches;
        rerender(view(false, 0, READ_SYNC_ON));
        act(() => {
            useAppStore.setState({
                activeService: OTHER,
                selectedConversations: {
                    [SERVICE]: { path: ROOM, name: '金村 美玖', isGroupChat: false },
                    [OTHER]: { path: OTHER_ROOM, name: '森田 ひかる', isGroupChat: false },
                },
            });
        });
        await new Promise((r) => setTimeout(r, 50));
        expect(readSyncs).toEqual([SERVICE]);
        expect(roomFetches).toBe(fetchesBefore);
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('chat_load', { outcome: 'deferred', reason: 'hidden_restore' });

        rerender(view(true, 0, READ_SYNC_ON));
        await waitFor(() => expect(readSyncs).toEqual([SERVICE, OTHER]));
        await waitFor(() => expect(roomFetches).toBe(fetchesBefore + 1));
    });

    it('read-syncs only the chat a toast or a Memories jump opens from another feature', async () => {
        useAppStore.setState({ activeFeatures: { [SERVICE]: 'messages' } });
        render(<ContentArea service={SERVICE} messagesContent={<MessagesFeature appSettings={READ_SYNC_ON} syncVersion={0} />} />);
        await screen.findByText('こんにちは');
        await waitFor(() => expect(readSyncGroups).toEqual([34]));
        act(() => { useAppStore.getState().setActiveFeature(SERVICE, 'blogs'); });
        expect(screen.getByText('blogs')).toBeInTheDocument();

        // openChat shows Messages and selects the other room in one batch (one render).
        const fetchedBefore = roomPaths.length;
        act(() => { openChat({ service: SERVICE, path: SECOND_ROOM, name: '小坂 菜緒', is_group_chat: false }); });
        await waitFor(() => expect(readSyncGroups).toEqual([34, 35]));
        await new Promise((r) => setTimeout(r, 50));
        expect(readSyncGroups).toEqual([34, 35]);
        // Only the opened room is asked for: no refresh of the room as last shown.
        expect(roomPaths.slice(fetchedBefore)).toEqual([SECOND_ROOM]);
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('chat_load', { outcome: 'skipped', reason: 'shown_by_navigation' });
    });

    it('opens the room again on return from another group\'s Blogs (read sync and refresh, as the remount did)', async () => {
        useAppStore.setState({ activeFeatures: { [SERVICE]: 'messages', [OTHER]: 'blogs' } });
        // As Layout: the content area follows the active group in the same render.
        const Area = () => (
            <ContentArea service={useAppStore((st) => st.activeService) ?? SERVICE} messagesContent={<MessagesFeature appSettings={READ_SYNC_ON} syncVersion={0} />} />
        );
        render(<Area />);
        await screen.findByText('こんにちは');
        await waitFor(() => expect(readSyncGroups).toEqual([34]));
        act(() => { useAppStore.setState({ activeService: OTHER }); });
        expect(screen.getByText('blogs')).toBeInTheDocument();
        const fetchedBefore = roomPaths.length;

        act(() => { useAppStore.setState({ activeService: SERVICE }); });
        await waitFor(() => expect(readSyncGroups).toEqual([34, 34]));
        await waitFor(() => expect(roomPaths.slice(fetchedBefore)).toEqual([ROOM]));
    });

    it('does not show its dialogs while hidden, and brings an open one back with Talk', async () => {
        const { rerender } = render(view(true));
        await screen.findByText('こんにちは');
        await userEvent.click(screen.getByRole('button', { name: 'More options' }));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Date Search' }));
        expect(await screen.findByRole('dialog', { name: 'Date Search' })).toBeInTheDocument();
        rerender(view(false));
        expect(screen.queryByRole('dialog')).toBeNull();
        rerender(view(true));
        expect(await screen.findByRole('dialog', { name: 'Date Search' })).toBeInTheDocument();
    });
});
