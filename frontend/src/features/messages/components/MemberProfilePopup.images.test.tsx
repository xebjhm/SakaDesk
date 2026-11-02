import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { MemberProfilePopup } from './MemberProfilePopup';

const MEMBER_PATH = '日向坂46/messages/66 石塚 瑶季/120 石塚 瑶季';

function mockImages() {
    server.use(
        http.get('/api/content/profile_images', () =>
            HttpResponse.json({
                kinds: {
                    thumbnail: [
                        { url: '/t-new.jpg', first_seen: null, current: true },
                        { url: '/t-old.jpg', first_seen: null, current: false },
                    ],
                },
            }),
        ),
    );
}

describe('MemberProfilePopup — member images', () => {
    it('shows pills, opens the viewer, and Escape closes only the viewer', async () => {
        mockImages();
        const onClose = vi.fn();
        render(<MemberProfilePopup isOpen onClose={onClose} memberName="石塚 瑶季" memberPath={MEMBER_PATH} />);

        fireEvent.click(await screen.findByRole('button', { name: /Chat icon/ }));
        expect(await screen.findByRole('tablist')).toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes the popup on Escape when the viewer is not open', async () => {
        mockImages();
        const onClose = vi.fn();
        render(<MemberProfilePopup isOpen onClose={onClose} memberName="石塚 瑶季" memberPath={MEMBER_PATH} />);
        await screen.findByRole('button', { name: /Chat icon/ });
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('opens the viewer from the large avatar', async () => {
        mockImages();
        render(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="石塚 瑶季" memberPath={MEMBER_PATH} />);
        await screen.findByRole('button', { name: /Chat icon/ });
        const avatar = screen.getAllByRole('button', { name: 'Chat icon' }).find(b => b.className.includes('w-48'))!;
        fireEvent.click(avatar);
        expect(await screen.findByRole('tablist')).toBeInTheDocument();
    });

    it('shows no pills without a memberPath (group chats)', async () => {
        const requested = vi.fn();
        server.use(http.get('/api/content/profile_images', () => { requested(); return HttpResponse.json({ kinds: {} }); }));
        render(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="Group" />);
        await waitFor(() => expect(screen.getByText('Group')).toBeInTheDocument());
        expect(screen.queryByTitle('Avatar shown next to messages in the chat')).toBeNull();
        expect(screen.getByRole('button', { name: 'Chat icon' })).toBeDisabled();
        expect(requested).not.toHaveBeenCalled();
    });
});
