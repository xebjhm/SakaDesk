import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { SentLettersModal } from './SentLettersModal';
import type { Letter } from '../../features/messages/letters';

const letter = (id: number, created_at: string, image_url: string | null, text = ''): Letter =>
    ({ id, text, created_at, image_url, width: 341, height: 512 });

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('SentLettersModal', () => {
    it('lists the letters newest first and jumps to the chosen one after closing', async () => {
        const onClose = vi.fn();
        const onSelectLetter = vi.fn();
        render(
            <SentLettersModal
                isOpen
                onClose={onClose}
                letters={[letter(1, '2023-06-01T14:00:00Z', '/l/1.jpg'), letter(2, '2025-05-05T14:00:00Z', null, 'ありがとう🌸')]}
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
        expect(onClose).toHaveBeenCalledOnce();
        expect(onSelectLetter).toHaveBeenCalledWith(1);
        // The dialog closes first, then the chat jumps.
        expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onSelectLetter.mock.invocationCallOrder[0]);
    });

    it('opens a letter from the keyboard', async () => {
        const onClose = vi.fn();
        const onSelectLetter = vi.fn();
        render(
            <SentLettersModal isOpen onClose={onClose} status="ready" onSelectLetter={onSelectLetter}
                letters={[letter(4, '2024-02-02T03:00:00Z', null, '🌸'), letter(5, '2024-03-03T03:00:00Z', null, '💌')]} />,
        );
        const dialog = await screen.findByRole('dialog');
        const [newest, older] = within(dialog).getAllByRole('button', { name: /^Letter sent/ });
        older.focus();
        await userEvent.keyboard('{Enter}');
        expect(onSelectLetter).toHaveBeenLastCalledWith(4);
        newest.focus();
        await userEvent.keyboard(' ');
        expect(onSelectLetter).toHaveBeenLastCalledWith(5);
        expect(onClose).toHaveBeenCalledTimes(2);
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
