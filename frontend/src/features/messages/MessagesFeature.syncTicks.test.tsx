import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { resetSyncProgressStore, setActiveProgress } from '../../shell/syncProgressStore';
import { MessagesFeature } from './MessagesFeature';

// A non-memo stand-in: it renders exactly when MessagesFeature renders.
const renders = { feature: 0, roomFetched: false };
vi.mock('./components/MemberList', () => ({
    MemberList: () => { renders.feature += 1; return null; },
}));
vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);

const SERVICE = 'hinatazaka46';
const ROOM = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const member = { id: '58', name: '金村 美玖', path: ROOM, thumbnail_local: null, thumbnail: null, portrait: null, phone_image: null };

describe('MessagesFeature during a sync (UI health #2)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        renders.feature = 0;
        renders.roomFetched = false;
        resetSyncProgressStore();
        useAppStore.setState({
            activeService: SERVICE,
            selectedConversations: { [SERVICE]: { path: ROOM, name: member.name, isGroupChat: false } },
        });
        server.use(
            http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
            http.get('/api/content/messages_by_path', () => { renders.roomFetched = true; return HttpResponse.json({ member, messages: [], total_count: 0, max_message_id: 0 }); }),
            http.get('/api/chat/letters_local', () => HttpResponse.json({ letters: [] })),
            http.get('/api/account/profile', () => HttpResponse.json({ name: 'me', avatars: [] })),
            http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
            http.get('/api/chat/streak/:id', () => HttpResponse.json({ status: 'unavailable' })),
        );
    });

    it('does not re-render on progress ticks; only the header pill changes', async () => {
        render(<MessagesFeature appSettings={null} syncVersion={0} />);
        await waitFor(() => expect(renders.roomFetched).toBe(true));
        await act(async () => { await new Promise((r) => queueMicrotask(() => r(null))); }); // flush its state updates
        act(() => setActiveProgress({ state: 'running', detail: 'Fetching page 1' }));
        const afterStart = renders.feature; // the one render for isSyncing false -> true
        for (let page = 2; page <= 6; page += 1) {
            act(() => setActiveProgress({ state: 'running', detail: `Fetching page ${page}` }));
        }
        expect(renders.feature).toBe(afterStart);
        expect(screen.getByText(/Fetching page 6/)).toBeInTheDocument();
    });
});
