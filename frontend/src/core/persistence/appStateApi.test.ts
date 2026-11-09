import { describe, it, expect, vi, afterEach } from 'vitest';
import * as api from './appStateApi';

const res = (status: number, body: unknown = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
});

afterEach(() => vi.unstubAllGlobals());

describe('appStateApi non-2xx handling', () => {
    it('rejects a non-2xx read instead of returning the error body as data', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(500, { detail: 'db locked' })));
        const err = await api.getAllConversations().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(api.AppStateHttpError);
        expect((err as api.AppStateHttpError).status).toBe(500);
    });

    it.each([
        ['getPrefs', () => api.getPrefs()],
        ['getConversation', () => api.getConversation('日向坂46/messages/34 金村')],
        ['getMigrated', () => api.getMigrated()],
    ])('%s rejects on non-2xx', async (_name, call) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(422, { detail: [] })));
        await expect(call()).rejects.toBeInstanceOf(api.AppStateHttpError);
    });

    it('resolves the parsed body on 2xx', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { read_state_a: { value: '1' } })));
        await expect(api.getAllConversations()).resolves.toEqual({ read_state_a: { value: '1' } });
    });

    it('patchConversation rejects on non-2xx and resolves on 2xx', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(res(500)).mockResolvedValueOnce(res(204));
        vi.stubGlobal('fetch', fetchMock);
        await expect(api.patchConversation('k', { value: '1' })).rejects.toMatchObject({ status: 500 });
        await expect(api.patchConversation('k', { value: '1' })).resolves.toBeUndefined();
    });

    it('the error message carries the status only, never the request path', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(500)));
        const err = await api.getConversation('日向坂46/messages/34 金村').catch((e: Error) => e);
        expect(err.message).not.toMatch(/金村|messages/);
        expect(err.name).toBe('AppStateHttpError');
    });
});
