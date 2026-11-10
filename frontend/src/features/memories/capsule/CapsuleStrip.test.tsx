import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchCapsule: vi.fn(), postCapsule: vi.fn(), putCapsule: vi.fn(), deleteCapsule: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { deleteCapsule, fetchCapsule, postCapsule, putCapsule } from '../api';
import { MEMBER_PATH } from '../__fixtures__/memories';
import type { CapsuleNote } from '../types';
import { CapsuleStrip } from './CapsuleStrip';
import { capsuleNote } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

let stored: CapsuleNote[];
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    stored = [capsuleNote()];
    vi.mocked(fetchCapsule).mockReset().mockImplementation(async () => ({ notes: [...stored] }));
    vi.mocked(postCapsule).mockReset().mockImplementation(async (_s, body) => {
        const note = capsuleNote({ id: 8, body: body.body });
        stored.push(note);
        return note;
    });
    vi.mocked(putCapsule).mockReset().mockImplementation(async (_s, id, body) => {
        stored = stored.map((n) => (n.id === id ? { ...n, body } : n));
        return stored.find((n) => n.id === id)!;
    });
    vi.mocked(deleteCapsule).mockReset().mockImplementation(async (_s, id) => {
        stored = stored.filter((n) => n.id !== id);
    });
});

describe('CapsuleStrip', () => {
    it('lists the notes of a day without lang="ja" (the fan\'s own words)', async () => {
        render(<CapsuleStrip service="hinatazaka46" anchor={{ kind: 'day', date: '2024-09-14' }} />);
        const note = await screen.findByTestId('capsule-note-7');
        expect(note).toHaveTextContent('はじめての握手会🌸');
        expect(note).toHaveTextContent('に書いたメモ');
        expect(note.querySelector('[lang]')).toBeNull();
        expect(within(note).getByTestId('capsule-washi')).toHaveClass('bg-memories-washi');
        expect(fetchCapsule).toHaveBeenCalledWith('hinatazaka46', { date: '2024-09-14' }, expect.any(AbortSignal));
    });

    it('adds a note and refetches', async () => {
        render(<CapsuleStrip service="hinatazaka46" anchor={{ kind: 'day', date: '2024-09-14' }} />);
        await screen.findByTestId('capsule-note-7');
        await userEvent.click(screen.getByRole('button', { name: 'メモを貼る' }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_capsule', { phase: 'open', kind: 'day', count: 1 });
        await userEvent.type(screen.getByPlaceholderText('この日のこと、あなたの言葉で。'), 'また会いたい');
        await userEvent.click(screen.getByRole('button', { name: 'しまう' }));
        expect(await screen.findByTestId('capsule-note-8')).toHaveTextContent('また会いたい');
        expect(postCapsule).toHaveBeenCalledWith(
            'hinatazaka46', { anchor: { kind: 'day', date: '2024-09-14' }, body: 'また会いたい' }, expect.any(AbortSignal),
        );
        expect(fetchCapsule).toHaveBeenCalledTimes(2);
        // The list stays on screen while it reloads.
        expect(screen.getByTestId('capsule-note-7')).toBeInTheDocument();
    });

    it('edits a note it opens and refetches', async () => {
        render(<CapsuleStrip service="hinatazaka46" anchor={{ kind: 'day', date: '2024-09-14' }} />);
        await userEvent.click(await screen.findByRole('button', { name: /はじめての握手会/ }));
        const field = screen.getByPlaceholderText('この日のこと、あなたの言葉で。');
        await userEvent.clear(field);
        await userEvent.type(field, '書きなおした');
        await userEvent.click(screen.getByRole('button', { name: 'しまう' }));
        await waitFor(() => expect(screen.getByTestId('capsule-note-7')).toHaveTextContent('書きなおした'));
        expect(fetchCapsule).toHaveBeenCalledTimes(2);
    });

    it('deletes a note and refetches', async () => {
        render(<CapsuleStrip service="hinatazaka46" anchor={{ kind: 'day', date: '2024-09-14' }} />);
        await userEvent.click(await screen.findByRole('button', { name: /はじめての握手会/ }));
        await userEvent.click(screen.getByRole('button', { name: 'はがす' }));
        await userEvent.click(screen.getByRole('button', { name: 'はがす' }));
        await waitFor(() => expect(screen.queryByTestId('capsule-note-7')).toBeNull());
        expect(fetchCapsule).toHaveBeenCalledTimes(2);
    });

    it('queries and writes a card anchor with her chat path and the card key', async () => {
        stored = [];
        render(
            <CapsuleStrip
                service="hinatazaka46"
                anchor={{ kind: 'card', memberPath: MEMBER_PATH, cardKey: 'anniv.y1', date: '2024-09-14' }}
            />,
        );
        await waitFor(() => expect(fetchCapsule).toHaveBeenCalledWith(
            'hinatazaka46', { member: MEMBER_PATH, card: 'anniv.y1' }, expect.any(AbortSignal),
        ));
        await userEvent.click(await screen.findByRole('button', { name: 'メモを貼る' }));
        await userEvent.type(screen.getByPlaceholderText('この日のこと、あなたの言葉で。'), 'カード');
        await userEvent.click(screen.getByRole('button', { name: 'しまう' }));
        await waitFor(() => expect(postCapsule).toHaveBeenCalledWith(
            'hinatazaka46',
            { anchor: { kind: 'card', member: MEMBER_PATH, card_key: 'anniv.y1', date: '2024-09-14' }, body: 'カード' },
            expect.any(AbortSignal),
        ));
    });

    it('offers a retry when the notes cannot load', async () => {
        vi.mocked(fetchCapsule).mockRejectedValueOnce(new Error('down'));
        render(<CapsuleStrip service="hinatazaka46" anchor={{ kind: 'day', date: '2024-09-14' }} />);
        await userEvent.click(await screen.findByRole('button', { name: 'もう一度' }));
        expect(await screen.findByTestId('capsule-note-7')).toBeInTheDocument();
    });
});
