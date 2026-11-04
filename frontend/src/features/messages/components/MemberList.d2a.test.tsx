import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { MemberList } from './MemberList';

const PATH = '日向坂46/messages/66 石塚 瑶季/120 石塚 瑶季';
const groups = [
    {
        id: '66', name: '石塚 瑶季', service: 'hinatazaka46', dir_name: '66 石塚 瑶季',
        group_path: '日向坂46/messages/66 石塚 瑶季', member_count: 1, is_group_chat: false,
        is_active: true, server_unread_count: 120,
        members: [{ id: '120', name: '石塚 瑶季', path: PATH }],
    },
    {
        id: '70', name: '卒業 メンバー', service: 'hinatazaka46', dir_name: '70 卒業 メンバー',
        group_path: '日向坂46/messages/70 卒業 メンバー', member_count: 1, is_group_chat: false,
        is_active: false, is_graduated: true, server_unread_count: 0,
        members: [{ id: '130', name: '卒業 メンバー', path: '日向坂46/messages/70 卒業 メンバー/130 卒業 メンバー' }],
    },
];

beforeAll(async () => { await i18n.changeLanguage('en'); });

function serve() {
    server.use(
        http.get('/api/content/groups', () => HttpResponse.json({ groups, last_sync: {} })),
        http.post('/api/content/unread_counts', () => HttpResponse.json({ [PATH]: 120 })),
    );
}

describe('MemberList (D2a)', () => {
    it('selects with a white ring and the group glow, and caps the badge at 99+', async () => {
        serve();
        render(<MemberList activeService="hinatazaka46" selectedGroupDir={PATH} onSelectGroup={vi.fn()} />);
        expect(await screen.findByText('99+')).toHaveClass('bg-group-badge');
        const cell = screen.getByRole('button', { name: /石塚 瑶季/ });
        const avatar = cell.querySelector('.ring-2')!;
        expect(avatar).toHaveClass('ring-2', 'ring-surface', 'shadow-group-glow');
    });

    it('announces each member once: the avatar is decorative beside the visible name', async () => {
        serve();
        render(<MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} />);
        const cell = await screen.findByRole('button', { name: /石塚 瑶季/ });
        // The name is spoken once (the avatar adds nothing); the unread badge may follow it.
        expect(cell).not.toHaveAccessibleName(/石塚 瑶季.*石塚 瑶季/);
        expect(screen.queryByRole('img', { name: /石塚/ })).toBeNull();
    });

    it('uses sticky pill headings and a floating sync pill, with no divider lines or own gradient', async () => {
        serve();
        const onSyncNow = vi.fn();
        const { container } = render(<MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} onSyncNow={onSyncNow} />);
        const online = await screen.findByRole('heading', { name: 'Online' });
        expect(online).toHaveClass('rounded-pill', 'shadow-pill');
        expect(online.parentElement).toHaveClass('sticky');
        expect(screen.getByRole('heading', { name: 'Graduated' })).toBeInTheDocument();
        fireEvent.click(screen.getByTitle('Sync now'));
        expect(onSyncNow).toHaveBeenCalledOnce();
        expect(container.innerHTML).not.toMatch(/border-t|border-b/);
        expect(container.querySelector('[style*="gradient"]')).toBeNull();
    });
});
