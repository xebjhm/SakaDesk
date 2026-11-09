import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { MemberList } from './MemberList';

const PATH = '日向坂46/messages/66 石塚 瑶季/120 石塚 瑶季';

function group(id: string, name: string, isGroupChat: boolean, path: string) {
    return {
        id, name, service: 'hinatazaka46', dir_name: `${id} ${name}`, group_path: path,
        member_count: isGroupChat ? 5 : 1, is_group_chat: isGroupChat, is_active: true,
        members: isGroupChat ? [] : [{ id: '120', name, path }],
    };
}

const PATH_B = '日向坂46/messages/67 別の人/121 別の人';

function setup() {
    server.use(
        http.get('/api/content/groups', () =>
            HttpResponse.json({
                groups: [
                    group('66', '石塚 瑶季', false, PATH),
                    group('1', '全体チャット', true, '日向坂46/messages/1 全体チャット'),
                ],
                last_sync: {},
            }),
        ),
        http.post('/api/content/unread_counts', () => HttpResponse.json({})),
        http.get('/api/content/profile_images', ({ request }) => {
            expect(new URL(request.url).searchParams.get('path')).toBe(PATH);
            return HttpResponse.json({ kinds: { thumbnail: [{ url: '/t.jpg', first_seen: null, current: true }] } });
        }),
    );
    render(<MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} />);
}

describe('MemberList — right-click menu', () => {
    it('offers "View images" on a member and opens the viewer', async () => {
        setup();
        fireEvent.contextMenu(await screen.findByText('石塚 瑶季'));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'View images' }));
        expect(await screen.findByRole('tablist')).toBeInTheDocument();
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('renders the viewer under document.body, not inside the (transformed) sidebar', async () => {
        setup();
        fireEvent.contextMenu(await screen.findByText('石塚 瑶季'));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'View images' }));
        const tablist = await screen.findByRole('tablist');
        const backdrop = tablist.closest('[data-testid="modal-backdrop"]')!;
        expect(backdrop.parentElement).toBe(document.body);
    });

    it('does not open a viewer when the member has no images', async () => {
        server.use(
            http.get('/api/content/groups', () =>
                HttpResponse.json({ groups: [group('66', '石塚 瑶季', false, PATH)], last_sync: {} }),
            ),
            http.post('/api/content/unread_counts', () => HttpResponse.json({})),
            http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
        );
        let requested = false;
        server.events.on('response:mocked', ({ request }) => {
            if (request.url.includes('profile_images')) requested = true;
        });
        render(<MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} />);
        fireEvent.contextMenu(await screen.findByText('石塚 瑶季'));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'View images' }));
        await waitFor(() => expect(requested).toBe(true));
        await new Promise(r => setTimeout(r, 20));
        expect(screen.queryByRole('tablist')).toBeNull();
        server.events.removeAllListeners();
    });

    it('lets only the latest request open the viewer when responses arrive out of order', async () => {
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>(r => { releaseFirst = r; });
        server.use(
            http.get('/api/content/groups', () =>
                HttpResponse.json({
                    groups: [group('66', '石塚 瑶季', false, PATH), group('67', '別の人', false, PATH_B)],
                    last_sync: {},
                }),
            ),
            http.post('/api/content/unread_counts', () => HttpResponse.json({})),
            http.get('/api/content/profile_images', async ({ request }) => {
                if (new URL(request.url).searchParams.get('path') === PATH) {
                    await firstGate;
                    return HttpResponse.json({ kinds: { thumbnail: [{ url: '/first.jpg', first_seen: null, current: true }] } });
                }
                return HttpResponse.json({ kinds: { thumbnail: [{ url: '/second.jpg', first_seen: null, current: true }] } });
            }),
        );
        render(<MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} />);

        fireEvent.contextMenu(await screen.findByText('石塚 瑶季'));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'View images' }));
        fireEvent.contextMenu(await screen.findByText('別の人'));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'View images' }));

        await screen.findByRole('tablist');
        expect(document.querySelector('[tabindex="-1"] img')?.getAttribute('src')).toBe('/second.jpg');

        releaseFirst();
        await new Promise(r => setTimeout(r, 20));
        expect(document.querySelector('[tabindex="-1"] img')?.getAttribute('src')).toBe('/second.jpg');
    });

    it('has no menu on group chats', async () => {
        setup();
        fireEvent.contextMenu(await screen.findByText('全体チャット'));
        expect(screen.queryByRole('menu')).toBeNull();
    });
});
