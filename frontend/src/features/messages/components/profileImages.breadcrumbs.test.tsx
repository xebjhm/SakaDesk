import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { MemberProfilePopup } from './MemberProfilePopup';
import { MemberList } from './MemberList';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

// The profile_images breadcrumbs: every outcome of the profile card's load and of the
// sidebar's "View images" path logs one code, never the member path.

const PATH = '日向坂46/messages/66 石塚 瑶季/120 石塚 瑶季';
const IMAGES = { kinds: { thumbnail: [{ url: '/t.jpg', first_seen: null, current: true }, { url: '/o.jpg', first_seen: null, current: false }] } };

const loads = () => vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'dialog_load').map(([, f]) => f);

beforeEach(() => { vi.mocked(clientLog).mockClear(); });

describe('profile card images breadcrumbs', () => {
    it('logs ok with the image count', async () => {
        server.use(http.get('/api/content/profile_images', () => HttpResponse.json(IMAGES)));
        render(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="石塚 瑶季" memberPath={PATH} />);
        await waitFor(() => expect(loads()).toContainEqual({ surface: 'profile_images', outcome: 'ok', count: 2 }));
    });

    it('logs a failed load as an error', async () => {
        server.use(http.get('/api/content/profile_images', () => new HttpResponse(null, { status: 500 })));
        render(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="石塚 瑶季" memberPath={PATH} />);
        await waitFor(() => expect(loads()).toContainEqual({ surface: 'profile_images', outcome: 'error' }));
    });

    it('logs an aborted load (closed before it answered) as cancelled', async () => {
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        server.use(http.get('/api/content/profile_images', async () => { await gate; return HttpResponse.json(IMAGES); }));
        const { rerender } = render(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="石塚 瑶季" memberPath={PATH} />);
        rerender(<MemberProfilePopup isOpen={false} onClose={vi.fn()} memberName="石塚 瑶季" memberPath={PATH} />);
        release();
        await waitFor(() => expect(loads()).toContainEqual({ surface: 'profile_images', outcome: 'cancelled' }));
        expect(loads()).not.toContainEqual(expect.objectContaining({ outcome: 'ok' }));
        expect(JSON.stringify(loads())).not.toContain('石塚');
    });
});

function sidebar(images: () => Response | Promise<Response>) {
    server.use(
        http.get('/api/content/groups', () => HttpResponse.json({
            groups: [{
                id: '66', name: '石塚 瑶季', service: 'hinatazaka46', dir_name: '66 石塚 瑶季', group_path: PATH,
                member_count: 1, is_group_chat: false, is_active: true, members: [{ id: '120', name: '石塚 瑶季', path: PATH }],
            }],
            last_sync: {},
        })),
        http.post('/api/content/unread_counts', () => HttpResponse.json({})),
        http.get('/api/content/profile_images', images),
    );
    render(<MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} />);
}

async function viewImages() {
    fireEvent.contextMenu(await screen.findByText('石塚 瑶季'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View images' }));
}

describe('sidebar "View images" breadcrumbs', () => {
    it('logs ok with the image count when the viewer opens', async () => {
        sidebar(() => HttpResponse.json(IMAGES));
        await viewImages();
        await screen.findByRole('tablist');
        expect(loads()).toContainEqual({ surface: 'profile_images', outcome: 'ok', count: 2 });
    });

    it('logs skipped (empty) when the member has no images', async () => {
        sidebar(() => HttpResponse.json({ kinds: {} }));
        await viewImages();
        await waitFor(() => expect(loads()).toContainEqual({ surface: 'profile_images', outcome: 'skipped', reason: 'empty' }));
        expect(screen.queryByRole('tablist')).toBeNull();
    });

    it('logs a failed load as an error and opens nothing', async () => {
        const error = vi.spyOn(console, 'error');
        sidebar(() => new HttpResponse(null, { status: 500 }));
        await viewImages();
        await waitFor(() => expect(loads()).toContainEqual({ surface: 'profile_images', outcome: 'error' }));
        expect(screen.queryByRole('tablist')).toBeNull();
        expect(error).not.toHaveBeenCalledWith('Failed to load profile images:', expect.anything());
        error.mockRestore();
    });
});
