import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, postCapsule: vi.fn(), putCapsule: vi.fn(), deleteCapsule: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { deleteCapsule, MemoriesFetchError, MemoriesTimeoutError, postCapsule, putCapsule } from '../api';
import type { CapsuleAnchorInput, CapsuleNote } from '../types';
import { CapsuleEditor } from './CapsuleEditor';
import { capsuleNote } from './__fixtures__';

const DAY: CapsuleAnchorInput = { kind: 'day', date: '2024-09-14' };
const SECRET = '誰にも言えない秘密のメモ🌙';

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(postCapsule).mockReset();
    vi.mocked(putCapsule).mockReset();
    vi.mocked(deleteCapsule).mockReset();
});

function renderEditor(note: CapsuleNote | null = null) {
    const onClose = vi.fn();
    const onRefetch = vi.fn();
    render(<CapsuleEditor service="hinatazaka46" anchor={DAY} note={note} onClose={onClose} onRefetch={onRefetch} />);
    return { onClose, onRefetch };
}

const textarea = () => screen.getByPlaceholderText('この日のこと、あなたの言葉で。') as HTMLTextAreaElement;
const capsuleLogs = () => vi.mocked(clientLog).mock.calls.filter(([event]) => event === 'memories_capsule');
const allLogArgs = () => JSON.stringify(vi.mocked(clientLog).mock.calls);

describe('CapsuleEditor', () => {
    it('saves a new note with the anchor and logs `save` without the body', async () => {
        vi.mocked(postCapsule).mockResolvedValue(capsuleNote({ body: SECRET }));
        const { onClose, onRefetch } = renderEditor();
        expect(screen.getByText('このメモはこのパソコンにだけ保存されます')).toBeInTheDocument();
        await userEvent.type(textarea(), SECRET);
        await userEvent.click(screen.getByRole('button', { name: 'しまう' }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(onRefetch).toHaveBeenCalled();
        expect(postCapsule).toHaveBeenCalledWith('hinatazaka46', { anchor: DAY, body: SECRET }, expect.any(AbortSignal));
        expect(capsuleLogs()).toEqual([['memories_capsule', { phase: 'save', kind: 'day', outcome: 'created' }]]);
        expect(allLogArgs()).not.toContain('秘密');
    });

    it('edits an existing note with PUT', async () => {
        vi.mocked(putCapsule).mockResolvedValue(capsuleNote({ body: 'あたらしい' }));
        const { onClose } = renderEditor(capsuleNote());
        expect(screen.getByText('メモを書きなおす')).toBeInTheDocument();
        expect(textarea().value).toBe(capsuleNote().body);
        fireEvent.change(textarea(), { target: { value: 'あたらしい' } });
        await userEvent.click(screen.getByRole('button', { name: 'しまう' }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(putCapsule).toHaveBeenCalledWith('hinatazaka46', 7, 'あたらしい', expect.any(AbortSignal));
        expect(capsuleLogs()).toEqual([['memories_capsule', { phase: 'save', kind: 'day', outcome: 'updated' }]]);
    });

    it('shows the remaining count only past 1800 characters, never 0', () => {
        renderEditor();
        fireEvent.change(textarea(), { target: { value: 'あ'.repeat(1800) } });
        expect(screen.queryByTestId('capsule-limit')).toBeNull();
        fireEvent.change(textarea(), { target: { value: 'あ'.repeat(1801) } });
        expect(screen.getByTestId('capsule-limit')).toHaveTextContent('あと 199 文字');
        fireEvent.change(textarea(), { target: { value: '🌸'.repeat(2005) } });
        // Counted in characters (code points), cut at 2000, and the counter never says 0.
        expect(Array.from(textarea().value)).toHaveLength(2000);
        expect(screen.getByTestId('capsule-limit')).not.toHaveTextContent(/\b0\b|あと 0/);
    });

    it('blocks an empty body without sending it', async () => {
        const { onClose } = renderEditor();
        fireEvent.change(textarea(), { target: { value: '  \n ' } });
        await userEvent.click(screen.getByRole('button', { name: 'しまう' }));
        expect(postCapsule).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(textarea()).toHaveAttribute('aria-invalid', 'true');
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_skip', { target: 'capsule', reason: 'note_empty' });
    });

    it('keeps the draft and shows the error when the save fails', async () => {
        vi.mocked(postCapsule).mockRejectedValue(new MemoriesFetchError(503, 'store_unavailable'));
        const { onClose, onRefetch } = renderEditor();
        await userEvent.type(textarea(), SECRET);
        await userEvent.click(screen.getByRole('button', { name: 'しまう' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('メモを保存できませんでした');
        expect(textarea().value).toBe(SECRET);
        expect(onClose).not.toHaveBeenCalled();
        expect(onRefetch).not.toHaveBeenCalled();
        expect(capsuleLogs()).toEqual([['memories_capsule', { phase: 'failed', kind: 'day', error_code: 'store_unavailable' }]]);
        expect(allLogArgs()).not.toContain('秘密');
    });

    it('refetches instead of retrying when a save timed out (it may be committed)', async () => {
        vi.mocked(postCapsule).mockRejectedValue(new MemoriesTimeoutError());
        const { onClose, onRefetch } = renderEditor();
        await userEvent.type(textarea(), SECRET);
        await userEvent.click(screen.getByRole('button', { name: 'しまう' }));
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(onRefetch).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
        expect(postCapsule).toHaveBeenCalledTimes(1);
        expect(capsuleLogs()).toEqual([['memories_capsule', { phase: 'failed', kind: 'day', error_code: 'timeout' }]]);
    });

    it('maps a 404 to `not_found`', async () => {
        vi.mocked(putCapsule).mockRejectedValue(new MemoriesFetchError(404));
        renderEditor(capsuleNote());
        await userEvent.click(screen.getByRole('button', { name: 'しまう' }));
        await screen.findByRole('alert');
        expect(capsuleLogs()).toEqual([['memories_capsule', { phase: 'failed', kind: 'day', error_code: 'not_found' }]]);
    });

    it('deletes after a confirm and logs `delete`', async () => {
        vi.mocked(deleteCapsule).mockResolvedValue(undefined);
        const { onClose, onRefetch } = renderEditor(capsuleNote());
        await userEvent.click(screen.getByRole('button', { name: 'はがす' }));
        expect(deleteCapsule).not.toHaveBeenCalled();
        expect(screen.getByText('このメモをはがしますか？')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'はがす' }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(onRefetch).toHaveBeenCalled();
        expect(deleteCapsule).toHaveBeenCalledWith('hinatazaka46', 7, expect.any(AbortSignal));
        expect(capsuleLogs()).toEqual([['memories_capsule', { phase: 'delete', kind: 'day' }]]);
    });

    it('backs out of the delete confirm with やめる', async () => {
        renderEditor(capsuleNote());
        await userEvent.click(screen.getByRole('button', { name: 'はがす' }));
        await userEvent.click(screen.getByRole('button', { name: 'やめる' }));
        expect(screen.queryByText('このメモをはがしますか？')).toBeNull();
        expect(deleteCapsule).not.toHaveBeenCalled();
    });

    it('offers no delete for a new note', () => {
        renderEditor();
        expect(screen.queryByRole('button', { name: 'はがす' })).toBeNull();
    });
});
