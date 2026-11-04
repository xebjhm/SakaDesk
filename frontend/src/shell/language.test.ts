import { describe, it, expect, vi, afterEach } from 'vitest';
import i18n from '../i18n';
import { persisted } from '../core/persistence/persisted';
import { applyStartupLanguage } from './language';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('applyStartupLanguage', () => {
    it('uses the persisted language and does not fetch settings', async () => {
        vi.spyOn(persisted, 'getPref').mockReturnValue('ja' as never);
        const change = vi.spyOn(i18n, 'changeLanguage').mockResolvedValue((() => '') as never);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await applyStartupLanguage();
        expect(change).toHaveBeenCalledWith('ja');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falls back to the settings language when nothing is persisted', async () => {
        vi.spyOn(persisted, 'getPref').mockReturnValue(null as never);
        const change = vi.spyOn(i18n, 'changeLanguage').mockResolvedValue((() => '') as never);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: () => Promise.resolve({ language: 'zh-TW' }) }));
        await applyStartupLanguage();
        expect(change).toHaveBeenCalledWith('zh-TW');
    });

    it('keeps the default when nothing is persisted and the settings fetch fails', async () => {
        vi.spyOn(persisted, 'getPref').mockReturnValue(null as never);
        const change = vi.spyOn(i18n, 'changeLanguage').mockResolvedValue((() => '') as never);
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
        await applyStartupLanguage();
        expect(change).not.toHaveBeenCalled();
    });
});
