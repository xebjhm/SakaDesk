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
                onSelectLetter={onSelectLetter}
            />,
        );
        const dialog = await screen.findByRole('dialog', { name: 'Sent Letters' });
        const cards = within(dialog).getAllByRole('button');
        expect(cards[0]).toHaveTextContent('2025');
        expect(cards[0]).toHaveTextContent('ありがとう🌸');
        expect(cards[1].querySelector('img')).toHaveAttribute('src', '/l/1.jpg');
        await userEvent.click(cards[1]);
        expect(onClose).toHaveBeenCalledOnce();
        expect(onSelectLetter).toHaveBeenCalledWith(1);
    });

    it('says so when there are no letters', async () => {
        render(<SentLettersModal isOpen onClose={vi.fn()} letters={[]} onSelectLetter={vi.fn()} />);
        expect(await screen.findByText('No letters sent yet')).toBeInTheDocument();
    });
});
