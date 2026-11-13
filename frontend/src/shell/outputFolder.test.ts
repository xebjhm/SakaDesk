import { describe, it, expect, vi, afterEach } from 'vitest';
import { clientLog } from '../utils/clientLog';
import { OUTPUT_DIR_ERROR_CODES, outputDirErrorKey, pickOutputFolder, saveErrorKey } from './outputFolder';

vi.mock('../utils/clientLog', async (orig) => ({ ...(await orig<typeof import('../utils/clientLog')>()), clientLog: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(clientLog).mockClear(); });

const reply = (ok: boolean, body: unknown) => vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body });

describe('outputDirErrorKey', () => {
    it.each(OUTPUT_DIR_ERROR_CODES)('maps %s to its string', (code) => {
        expect(outputDirErrorKey(code)).toBe(`settings.outputDirError.${code}`);
    });

    it.each([undefined, null, 5, 'C:\\Users\\x', 'toString'])('maps anything else (%s) to the generic failure', (code) => {
        expect(outputDirErrorKey(code)).toBe('settings.outputDirError.failed');
    });
});

describe('pickOutputFolder', () => {
    it('returns the folder the picker chose', async () => {
        const fetchMock = reply(true, { path: 'D:\\データ' });
        vi.stubGlobal('fetch', fetchMock);
        await expect(pickOutputFolder()).resolves.toEqual({ path: 'D:\\データ', errorKey: null });
        expect(fetchMock).toHaveBeenCalledWith('/api/settings/select-folder', { method: 'POST' });
    });

    it('a cancel is neither a folder nor an error', async () => {
        vi.stubGlobal('fetch', reply(true, { path: null }));
        await expect(pickOutputFolder()).resolves.toEqual({ path: null, errorKey: null });
    });

    it('a refused folder gives its reason', async () => {
        vi.stubGlobal('fetch', reply(true, { path: null, error: 'network' }));
        await expect(pickOutputFolder()).resolves.toEqual({ path: null, errorKey: 'settings.outputDirError.network' });
    });

    it('a failed request or a network error is the generic failure', async () => {
        vi.stubGlobal('fetch', reply(false, { detail: 'nope' }));
        await expect(pickOutputFolder()).resolves.toEqual({ path: null, errorKey: 'settings.outputDirError.failed' });
        expect(clientLog).toHaveBeenLastCalledWith('output_folder_pick_failed', { reason: 'http_500' });
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
        await expect(pickOutputFolder()).resolves.toEqual({ path: null, errorKey: 'settings.outputDirError.failed' });
        expect(clientLog).toHaveBeenLastCalledWith('output_folder_pick_failed', { error_type: 'typeerror' });
    });
});

describe('saveErrorKey', () => {
    it('names the reason the backend refused the folder', async () => {
        const res = { json: async () => ({ detail: { code: 'output_dir_rejected', reason: 'not_picked' } }) };
        await expect(saveErrorKey(res)).resolves.toBe('settings.outputDirError.not_picked');
    });

    it('is the generic save failure for anything else', async () => {
        await expect(saveErrorKey({ json: async () => ({ detail: 'pinned failure' }) })).resolves.toBe('settings.saveFailed');
        await expect(saveErrorKey({ json: async () => { throw new SyntaxError('not json'); } })).resolves.toBe('settings.saveFailed');
    });
});
