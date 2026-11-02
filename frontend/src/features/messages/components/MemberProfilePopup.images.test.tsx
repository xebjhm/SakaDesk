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

    it('Escape pressed inside the viewer closes only the viewer; a second Escape closes the popup', async () => {
        mockImages();
        const onClose = vi.fn();
        render(<MemberProfilePopup isOpen onClose={onClose} memberName="石塚 瑶季" memberPath={MEMBER_PATH} />);

        fireEvent.click(await screen.findByRole('button', { name: /Chat icon/ }));
        await screen.findByRole('tablist');

        fireEvent.keyDown(document.querySelector('[tabindex="-1"]')!, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('tablist')).toBeNull());
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('ignores an Escape whose default was already prevented by an inner handler', async () => {
        mockImages();
        const onClose = vi.fn();
        render(<MemberProfilePopup isOpen onClose={onClose} memberName="石塚 瑶季" memberPath={MEMBER_PATH} />);
        await screen.findByRole('button', { name: /Chat icon/ });
        const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        ev.preventDefault();
        document.dispatchEvent(ev);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('clears the previous member\'s images when memberPath changes, before the new fetch resolves', async () => {
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        server.use(
            http.get('/api/content/profile_images', async ({ request }) => {
                const path = new URL(request.url).searchParams.get('path');
                if (path === 'B') {
                    await gate;
                    return HttpResponse.json({ kinds: { phone_image: [{ url: '/b.jpg', first_seen: null, current: true }] } });
                }
                return HttpResponse.json({ kinds: { thumbnail: [{ url: '/a.jpg', first_seen: null, current: true }] } });
            }),
        );
        const { rerender } = render(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="A" memberPath="A" />);
        await screen.findByRole('button', { name: /Chat icon/ });
        rerender(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="B" memberPath="B" />);
        expect(screen.queryByRole('button', { name: /Chat icon/ })).toBeNull();
        release();
        expect(await screen.findByRole('button', { name: /Call screen/ })).toBeInTheDocument();
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
        fireEvent.click(screen.getByRole('button', { name: '石塚 瑶季' }));
        expect(await screen.findByRole('tablist')).toBeInTheDocument();
    });

    it('shows no pills without a memberPath (group chats)', async () => {
        const requested = vi.fn();
        server.use(http.get('/api/content/profile_images', () => { requested(); return HttpResponse.json({ kinds: {} }); }));
        render(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="Group" />);
        await waitFor(() => expect(screen.getByText('Group')).toBeInTheDocument());
        expect(screen.queryByTitle('Avatar shown next to messages in the chat')).toBeNull();
        expect(screen.getByRole('button', { name: 'Group' })).toBeDisabled();
        expect(requested).not.toHaveBeenCalled();
    });
});
