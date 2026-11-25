import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { MessagesFeature } from './MessagesFeature';

vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);

const SERVICE = 'hinatazaka46';
const ROOM = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const member = { id: '58', name: '金村 美玖', path: ROOM, thumbnail_local: null, thumbnail: null, portrait: null, phone_image: null };

/** The archive's star, as `/messages_by_path` reports it (a ★ set elsewhere lands here). */
let archived = false;

function serve() {
    server.use(
        http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
        http.get('/api/content/messages_by_path', () => HttpResponse.json({
            member,
            messages: [{ id: 1, timestamp: '2024-01-15T09:00:00Z', type: 'text', content: 'こんにちは', is_favorite: archived, media_file: null, width: null, height: null }],
            total_count: 1,
            max_message_id: 1,
        })),
        http.get('/api/chat/letters_local', () => HttpResponse.json({ letters: [] })),
        http.get('/api/account/profile', () => HttpResponse.json({ name: 'me', avatars: [] })),
        http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
        http.get('/api/chat/streak/:id', () => HttpResponse.json({ status: 'unavailable' })),
    );
}

const props = { appSettings: null, syncVersion: 0 };

/** The bubble's yellow ★ (shown only for a favourite). */
const star = () => document.querySelector('.text-semantic-star');

async function toggleFromMenu() {
    // The bubble can be replaced right after it first appears (first render, then the
    // data load), and a contextmenu on the replaced node opens nothing: retry on the
    // current node until the menu shows.
    await screen.findByText('こんにちは');
    await waitFor(() => {
        if (!screen.queryByRole('menuitem', { name: /favorites/ })) {
            fireEvent.contextMenu(screen.getByText('こんにちは'));
        }
        expect(screen.getByRole('menuitem', { name: /favorites/ })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('menuitem', { name: /favorites/ }));
}

/** A promise the test settles by hand. */
function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

describe("MessagesFeature's favourite toggle (through /api/favorites)", () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        archived = false;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        useAppStore.setState({
            activeService: SERVICE,
            selectedConversations: { [SERVICE]: { path: ROOM, name: '金村 美玖', isGroupChat: false } },
        });
        serve();
    });

    it('lights the star at once and keeps it when the server saves it', async () => {
        const answer = deferred<Response>();
        const seen: string[] = [];
        server.use(http.post('/api/favorites/:id', ({ request, params }) => {
            seen.push(`${params.id} ${new URL(request.url).searchParams.get('service')}`);
            return answer.promise;
        }));
        render(<MessagesFeature {...props} />);
        await toggleFromMenu();
        expect(star()).not.toBeNull();
        await act(async () => { answer.resolve(HttpResponse.json({ success: true, message_id: 1, is_favorite: true })); });
        await waitFor(() => expect(seen).toEqual([`1 ${SERVICE}`]));
        expect(star()).not.toBeNull();
    });

    it('reverts the star on a 200 with success: false (SD-CONTRACT-01)', async () => {
        const answer = deferred<Response>();
        server.use(http.post('/api/favorites/:id', () => answer.promise));
        render(<MessagesFeature {...props} />);
        await toggleFromMenu();
        expect(star()).not.toBeNull();
        await act(async () => { answer.resolve(HttpResponse.json({ success: false, message_id: 1, is_favorite: false, error: 'x' })); });
        await waitFor(() => expect(star()).toBeNull());
    });

    it('reverts the star on an HTTP error', async () => {
        server.use(http.post('/api/favorites/:id', () => HttpResponse.json({ detail: 'x' }, { status: 500 })));
        render(<MessagesFeature {...props} />);
        await toggleFromMenu();
        await waitFor(() => expect(star()).toBeNull());
    });

    it('clears a set star with DELETE', async () => {
        archived = true;
        let deleted = false;
        server.use(http.delete('/api/favorites/:id', () => {
            deleted = true;
            return HttpResponse.json({ success: true, message_id: 1, is_favorite: false });
        }));
        render(<MessagesFeature {...props} />);
        await screen.findByText('こんにちは');
        expect(star()).not.toBeNull();
        await toggleFromMenu();
        await waitFor(() => expect(deleted).toBe(true));
        expect(star()).toBeNull();
    });

    it('shows a star set elsewhere (e.g. the Memories gacha) when the chat opens again', async () => {
        const first = render(<MessagesFeature {...props} />);
        await screen.findByText('こんにちは');
        expect(star()).toBeNull();
        // Opening Memories unmounts the chat (ContentArea); a ★ set there is written to the archive.
        first.unmount();
        archived = true;
        render(<MessagesFeature {...props} />);
        await screen.findByText('こんにちは');
        await waitFor(() => expect(star()).not.toBeNull());
    });
});
