import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../../messages/letters', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../messages/letters')>();
    return { ...real, fetchLocalLetters: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { openChat } from '../../../shell/openChat';
import { fetchLocalLetters, type Letter } from '../../messages/letters';
import { MEMBER_PATH } from '../__fixtures__/memories';
import { SentLetter } from './SentLetter';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const letter = (id: number, created_at: string, text: string): Letter =>
    ({ id, text, created_at, image_url: null, width: null, height: null });
const LETTERS = [
    letter(2, '2025-03-01T03:00:00Z', 'ふたつめの手紙💌'),
    letter(1, '2024-08-01T03:00:00Z', 'はじめての手紙です🌸'),
];

beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(openChat).mockClear();
    vi.mocked(fetchLocalLetters).mockReset().mockResolvedValue(LETTERS);
});

const renderLetter = (id = 1, onClose = vi.fn()) => {
    render(<SentLetter service="hinatazaka46" name="金村 美玖" letter={{ member_path: MEMBER_PATH, id }} onClose={onClose} />);
    return onClose;
};

describe('SentLetter', () => {
    it('reads her room\'s letters and opens the card\'s letter in the viewer', async () => {
        renderLetter(1);
        expect(vi.mocked(fetchLocalLetters).mock.calls[0]?.slice(0, 2)).toEqual(['hinatazaka46', MEMBER_PATH]);
        // the loading dialog gives way to the viewer
        expect(await screen.findByText('はじめての手紙です🌸')).toBeInTheDocument();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.queryByText('ふたつめの手紙💌')).toBeNull();
        await waitFor(() => expect(vi.mocked(clientLog)).toHaveBeenCalledWith('letter_viewer', expect.objectContaining({ phase: 'open', surface: 'memories' })));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_load', expect.objectContaining({ target: 'letters', outcome: 'ok' }));
    });

    it('steps to the newer letter with →', async () => {
        renderLetter(1);
        await screen.findByText('はじめての手紙です🌸');
        await userEvent.keyboard('{ArrowRight}');
        expect(await screen.findByText('ふたつめの手紙💌')).toBeInTheDocument();
    });

    it('a failed read shows the retry inside a dialog, then the letter', async () => {
        vi.mocked(fetchLocalLetters).mockRejectedValueOnce(new Error('boom'));
        renderLetter(2);
        const retry = await screen.findByRole('button', { name: 'もう一度' });
        await userEvent.click(retry);
        expect(await screen.findByText('ふたつめの手紙💌')).toBeInTheDocument();
    });

    it('closing calls onClose', async () => {
        const onClose = renderLetter(1);
        await screen.findByText('はじめての手紙です🌸');
        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
});
