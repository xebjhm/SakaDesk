import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';

// The conversation cache is controlled by the test: not ready at first (the startup
// load failed), then recovered. Everything else uses the real persisted module.
const { conv } = vi.hoisted(() => ({
    conv: { ready: false, listeners: [] as Array<() => void>, store: {} as Record<string, unknown> },
}));
vi.mock('../../core/persistence/persisted', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../core/persistence/persisted')>();
    return {
        ...actual,
        persisted: {
            ...actual.persisted,
            conversationsReady: () => conv.ready,
            onConversationsReady: (fn: () => void) => {
                conv.listeners.push(fn);
                return () => { conv.listeners = conv.listeners.filter((l) => l !== fn); };
            },
            // Not ready: the cache is the empty fallback, as after a failed load.
            getConv: (k: string, fb: unknown) => (conv.ready && k in conv.store ? conv.store[k] : fb),
            setConv: (k: string, v: unknown) => { conv.store[k] = v; },
            setConvBeacon: (k: string, v: unknown) => { conv.store[k] = v; },
        },
    };
});
vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);

import { MessagesFeature } from './MessagesFeature';
import { readStateKey } from './readStateStore';

const SERVICE = 'hinatazaka46';
const ROOM = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const KEY = readStateKey(ROOM);
const IDS = [1, 2, 3, 4, 5, 6];

const member = { id: '58', name: '金村 美玖', path: ROOM, thumbnail_local: null, thumbnail: null, portrait: null, phone_image: null };

function serve() {
    server.use(
        http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
        http.get('/api/content/messages_by_path', () => HttpResponse.json({
            member,
            messages: IDS.map((id) => ({
                id, timestamp: `2024-01-15T09:0${id}:00Z`, type: 'text', content: `メッセージ ${id} 🌸`,
                is_favorite: false, media_file: null, width: null, height: null,
            })),
            total_count: IDS.length,
            max_message_id: 6,
        })),
        http.get('/api/chat/letters_local', () => HttpResponse.json({ letters: [] })),
        http.get('/api/account/profile', () => HttpResponse.json({ name: 'me', avatars: [] })),
        http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
        http.get('/api/chat/streak/:id', () => HttpResponse.json({ status: 'unavailable' })),
        http.put('/api/read-states', () => HttpResponse.json({ ok: true })),
        http.get('/api/app-state/translations', () => HttpResponse.json({})),
    );
}

const props = { appSettings: null, syncVersion: 0 };

function stored(): { lastReadId: number; readCount: number; revealedIds: number[] } {
    return JSON.parse((conv.store[KEY] as { value: string }).value);
}

/** Every stored lastReadId written from now on, to prove it never decreases. */
function watchWrites(): number[] {
    const seen: number[] = [];
    const desc = { ...conv.store };
    conv.store = new Proxy(desc, {
        set(target, k, v) {
            target[k as string] = v;
            if (k === KEY) seen.push(JSON.parse((v as { value: string }).value).lastReadId);
            return true;
        },
    });
    return seen;
}

function recover() {
    conv.ready = true;
    act(() => { conv.listeners.forEach((fn) => fn()); });
}

async function revealText(text: string) {
    // The shelter is a sibling of the bubble content inside the bubble container.
    let el: HTMLElement | null = await screen.findByText(text);
    while (el && !el.querySelector(':scope > [data-testid="unread-shelter"]')) el = el.parentElement;
    const shelter = el?.querySelector(':scope > [data-testid="unread-shelter"]') as HTMLElement | null;
    expect(shelter).not.toBeNull();
    fireEvent.click(shelter as HTMLElement);
}

describe('MessagesFeature read state after mid-session recovery (spec B2 §3)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        conv.ready = false;
        conv.store = { [KEY]: { value: JSON.stringify({ lastReadId: 5, readCount: 5, revealedIds: [] }) } };
        useAppStore.setState({
            activeService: SERVICE,
            selectedConversations: { [SERVICE]: { path: ROOM, name: '金村 美玖', isGroupChat: false } },
        });
        serve();
    });

    it('a reveal before and after recovery never lowers the stored lastReadId', async () => {
        render(<MessagesFeature {...props} />);
        // Not ready: the chat shows the empty fallback, so message 1 is sheltered.
        await waitFor(() => expect(screen.getAllByTestId('unread-shelter')).toHaveLength(6));
        await revealText('メッセージ 1 🌸');
        expect(stored().lastReadId).toBe(5); // deferred, nothing written

        const writes = watchWrites();
        recover();
        await waitFor(() => expect(stored().lastReadId).toBe(5));
        // Recovered: only message 6 is still unread in the open chat.
        await waitFor(() => expect(screen.getAllByTestId('unread-shelter')).toHaveLength(1));

        await revealText('メッセージ 6 🌸');
        await waitFor(() => expect(stored().lastReadId).toBe(6));
        expect(writes.every((id) => id >= 5)).toBe(true);
    });

    it('a chat with no deferred reveal merges the stored row on recovery', async () => {
        conv.store[KEY] = { value: JSON.stringify({ lastReadId: 3, readCount: 4, revealedIds: [5] }) };
        render(<MessagesFeature {...props} />);
        await waitFor(() => expect(screen.getAllByTestId('unread-shelter')).toHaveLength(6));

        const writes = watchWrites();
        recover();
        // Messages 4 and 6 are the only unread ones now; 5 stays revealed.
        await waitFor(() => expect(screen.getAllByTestId('unread-shelter')).toHaveLength(2));

        await revealText('メッセージ 6 🌸');
        await waitFor(() => expect(stored().revealedIds).toContain(6));
        expect(stored().lastReadId).toBe(3);
        expect(stored().revealedIds).toEqual(expect.arrayContaining([5, 6]));
        expect(writes.every((id) => id >= 3)).toBe(true);
    });
});
