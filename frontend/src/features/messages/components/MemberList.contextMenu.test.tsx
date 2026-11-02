import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

    it('has no menu on group chats', async () => {
        setup();
        fireEvent.contextMenu(await screen.findByText('全体チャット'));
        expect(screen.queryByRole('menu')).toBeNull();
    });
});
