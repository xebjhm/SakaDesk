import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { SentLettersModal } from './SentLettersModal';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import type { Letter } from '../../features/messages/letters';

const letter = (id: number, created_at: string, image_url: string | null, text = ''): Letter =>
    ({ id, text, created_at, image_url, width: 341, height: 512 });

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('SentLettersModal', () => {
    it('lists the letters newest first and opens the chosen one in the letter viewer', async () => {
        const onClose = vi.fn();
        const onSelectLetter = vi.fn();
        render(
            <SentLettersModal
                isOpen
                onClose={onClose}
                letters={[letter(1, '2023-06-01T14:00:00Z', '/l/1.jpg', '一通目'), letter(2, '2025-05-05T14:00:00Z', null, 'ありがとう🌸')]}
                status="ready"
                onSelectLetter={onSelectLetter}
            />,
        );
        const dialog = await screen.findByRole('dialog', { name: 'Sent Letters' });
        const cards = within(dialog).getAllByRole('button', { name: /^Letter sent/ });
        expect(cards[0]).toHaveTextContent('2025');
        expect(cards[0]).toHaveTextContent('ありがとう🌸');
        expect(cards[1].querySelector('img')).toHaveAttribute('src', '/l/1.jpg');
        await userEvent.click(cards[1]);
        // No jump yet: the viewer opens on top of the overview.
        expect(onClose).not.toHaveBeenCalled();
        expect(onSelectLetter).not.toHaveBeenCalled();
        const viewer = await screen.findByRole('dialog', { name: 'Sent letter' });
        expect(viewer.querySelector('img')).toHaveAttribute('src', '/l/1.jpg');
        expect(within(viewer).getByRole('region', { name: 'Letter text' })).toHaveTextContent('一通目');
        expect(screen.getByRole('dialog', { name: 'Sent Letters' })).toBeInTheDocument();
    });

    it('walks the viewer newest first, as the grid reads (→ is older)', async () => {
        render(
            <SentLettersModal isOpen onClose={vi.fn()} status="ready" onSelectLetter={vi.fn()}
                letters={[letter(1, '2023-06-01T14:00:00Z', null, '古い'), letter(2, '2025-05-05T14:00:00Z', null, '新しい')]} />,
        );
        const dialog = await screen.findByRole('dialog', { name: 'Sent Letters' });
        await userEvent.click(within(dialog).getAllByRole('button', { name: /^Letter sent/ })[0]);
        const viewer = await screen.findByRole('dialog', { name: 'Sent letter' });
        expect(within(viewer).getByRole('region', { name: 'Letter text' })).toHaveTextContent('新しい');
        fireEvent.keyDown(viewer, { key: 'ArrowRight' });
        expect(within(screen.getByRole('dialog', { name: 'Sent letter' })).getByRole('region', { name: 'Letter text' })).toHaveTextContent('古い');
        await userEvent.click(within(screen.getByRole('dialog', { name: 'Sent letter' })).getByRole('button', { name: 'Previous letter' }));
        expect(within(screen.getByRole('dialog', { name: 'Sent letter' })).getByRole('region', { name: 'Letter text' })).toHaveTextContent('新しい');
    });

    it("closes the viewer and the overview from the viewer's date link, then jumps", async () => {
        const onClose = vi.fn();
        const onSelectLetter = vi.fn();
        render(
            <SentLettersModal isOpen onClose={onClose} status="ready" onSelectLetter={onSelectLetter}
                letters={[letter(4, '2024-02-02T03:00:00Z', null, '🌸'), letter(5, '2024-03-03T03:00:00Z', null, '💌')]} />,
        );
        const dialog = await screen.findByRole('dialog', { name: 'Sent Letters' });
        await userEvent.click(within(dialog).getAllByRole('button', { name: /^Letter sent/ })[1]);
        const viewer = await screen.findByRole('dialog', { name: 'Sent letter' });
        await userEvent.click(within(viewer).getByRole('button', { name: /^Show letter sent .* in the chat$/ }));
        expect(screen.queryByRole('dialog', { name: 'Sent letter' })).toBeNull();
        expect(onClose).toHaveBeenCalledOnce();
        expect(onSelectLetter).toHaveBeenCalledWith(4);
        // The dialogs close first, then the chat jumps.
        expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onSelectLetter.mock.invocationCallOrder[0]);
    });

    it('closing the viewer returns to the overview without jumping', async () => {
        const onClose = vi.fn();
        const onSelectLetter = vi.fn();
        render(
            <SentLettersModal isOpen onClose={onClose} status="ready" onSelectLetter={onSelectLetter}
                letters={[letter(4, '2024-02-02T03:00:00Z', null, '🌸')]} />,
        );
        const dialog = await screen.findByRole('dialog', { name: 'Sent Letters' });
        await userEvent.click(within(dialog).getByRole('button', { name: /^Letter sent/ }));
        const viewer = await screen.findByRole('dialog', { name: 'Sent letter' });
        await userEvent.click(within(viewer).getByRole('button', { name: 'Close' }));
        expect(screen.queryByRole('dialog', { name: 'Sent letter' })).toBeNull();
        expect(screen.getByRole('dialog', { name: 'Sent Letters' })).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        expect(onSelectLetter).not.toHaveBeenCalled();
    });

    it('opens a letter from the keyboard', async () => {
        render(
            <SentLettersModal isOpen onClose={vi.fn()} status="ready" onSelectLetter={vi.fn()}
                letters={[letter(4, '2024-02-02T03:00:00Z', null, '🌸'), letter(5, '2024-03-03T03:00:00Z', null, '💌')]} />,
        );
        const dialog = await screen.findByRole('dialog');
        const [, older] = within(dialog).getAllByRole('button', { name: /^Letter sent/ });
        older.focus();
        await userEvent.keyboard('{Enter}');
        const viewer = await screen.findByRole('dialog', { name: 'Sent letter' });
        expect(within(viewer).getByRole('region', { name: 'Letter text' })).toHaveTextContent('🌸');
    });

    it('names each letter by its send date and time, so same-day letters differ', async () => {
        render(
            <SentLettersModal isOpen onClose={vi.fn()} status="ready" onSelectLetter={vi.fn()}
                letters={[letter(1, '2024-02-02T01:00:00Z', null), letter(2, '2024-02-02T09:30:00Z', null)]} />,
        );
        const dialog = await screen.findByRole('dialog');
        const names = within(dialog).getAllByRole('button', { name: /^Letter sent/ }).map((b) => b.getAttribute('aria-label'));
        expect(names[0]).not.toBe(names[1]);
        expect(names.every((n) => n?.includes('2024'))).toBe(true);
    });

    it('never throws on an unparseable created_at: such a letter is not listed', async () => {
        render(
            <SentLettersModal isOpen onClose={vi.fn()} status="ready" onSelectLetter={vi.fn()}
                letters={[letter(1, 'not a date', null, 'x'), letter(2, '2024-02-02T09:30:00Z', null, 'y')]} />,
        );
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getAllByRole('button', { name: /^Letter sent/ })).toHaveLength(1);
    });

    it('says so when there are no letters', async () => {
        render(<SentLettersModal isOpen onClose={vi.fn()} letters={[]} status="ready" onSelectLetter={vi.fn()} />);
        expect(await screen.findByText('No letters sent yet')).toBeInTheDocument();
    });

    it('shows a loading state, not "no letters", while the letters load', async () => {
        render(<SentLettersModal isOpen onClose={vi.fn()} letters={[]} status="loading" onSelectLetter={vi.fn()} />);
        expect(await screen.findByText('Loading letters…')).toBeInTheDocument();
        expect(screen.queryByText('No letters sent yet')).toBeNull();
    });

    it('shows an unavailable state after a failure', async () => {
        render(<SentLettersModal isOpen onClose={vi.fn()} letters={[]} status="unavailable" onSelectLetter={vi.fn()} />);
        expect(await screen.findByText('Letters are unavailable right now')).toBeInTheDocument();
        expect(screen.queryByText('No letters sent yet')).toBeNull();
    });
});
