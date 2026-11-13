import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { resetUpgradeStoreForTests } from '../../core/upgrade/upgradeStore';
import { SettingsModal } from './SettingsModal';
import type { AppSettings } from '../../features/messages/MessagesFeature';
import { useAppStore } from '../../store/appStore';
import { persisted } from '../../core/persistence/persisted';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import { clientLog } from '../../utils/clientLog';

// Locks every settings flow the D2c restyle touches: what each control saves, the in-app
// confirms, the sync-mode radio group's keyboard order and the load breadcrumbs.

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

const base: AppSettings = {
    output_dir: '/out', auto_sync_enabled: true, adaptive_sync_enabled: false, sync_interval_minutes: 10, is_configured: true,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    resetUpgradeStoreForTests();
    resetDialogStack();
    vi.mocked(clientLog).mockClear();
    fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    useAppStore.setState({ selectedServices: [], transcriptionEnabled: true, translationEnabled: false });
});

afterEach(async () => {
    vi.restoreAllMocks();
    if (i18n.language !== 'en') await i18n.changeLanguage('en');
});

function renderModal(appSettings: AppSettings = base, props: Partial<React.ComponentProps<typeof SettingsModal>> = {}) {
    const onSaveSettings = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    const onDeepResync = vi.fn();
    const onVerifyAndFix = vi.fn();
    const setOutputDirInput = vi.fn();
    render(
        <SettingsModal appSettings={appSettings} outputDirInput="/out" setOutputDirInput={setOutputDirInput}
            onSaveSettings={onSaveSettings} onClose={onClose} activeService="hinatazaka46"
            onVerifyAndFix={onVerifyAndFix} onDeepResync={onDeepResync} {...props} />,
    );
    return { onSaveSettings, onClose, onDeepResync, onVerifyAndFix, setOutputDirInput };
}

const openTab = (name: string) => fireEvent.click(screen.getByRole('button', { name, exact: true } as never));

describe('general tab saving', () => {
    it('language select switches the language and persists it', async () => {
        const setPref = vi.spyOn(persisted, 'setPref').mockImplementation(() => {});
        renderModal();
        const select = screen.getByDisplayValue('English');
        await act(async () => { fireEvent.change(select, { target: { value: 'ja' } }); });
        expect(i18n.language).toBe('ja');
        expect(setPref).toHaveBeenCalledWith('language', 'ja');
        // Back to English while the dialog is still mounted, inside act.
        await act(async () => { await i18n.changeLanguage('en'); });
    });

    it('output folder: the field is read-only, Browse fills it from the picker, Save posts output_dir', async () => {
        fetchMock.mockImplementation(async (url: string) => (url === '/api/settings/select-folder'
            ? { ok: true, json: async () => ({ path: 'D:\\データ' }) }
            : { ok: false, json: async () => ({}) }));
        const { onSaveSettings, setOutputDirInput } = renderModal();
        expect(screen.getByDisplayValue('/out')).toHaveAttribute('readonly');
        fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
        await waitFor(() => expect(setOutputDirInput).toHaveBeenCalledWith('D:\\データ'));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSaveSettings).toHaveBeenCalledWith({ output_dir: '/out' });
    });

    it('output folder: a refused pick says why on the row', async () => {
        fetchMock.mockImplementation(async (url: string) => (url === '/api/settings/select-folder'
            ? { ok: true, json: async () => ({ path: null, error: 'network' }) }
            : { ok: false, json: async () => ({}) }));
        const { setOutputDirInput } = renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
        expect(await screen.findByText(i18n.t('settings.outputDirError.network'))).toBeInTheDocument();
        expect(setOutputDirInput).not.toHaveBeenCalled();
    });
});

describe('sync tab saving', () => {
    it('the three sync mode radios save their payloads', () => {
        const { onSaveSettings } = renderModal();
        openTab('Sync');
        fireEvent.click(screen.getByRole('radio', { name: /^Off/ }));
        expect(onSaveSettings).toHaveBeenCalledWith({ auto_sync_enabled: false, adaptive_sync_enabled: false });
        fireEvent.click(screen.getByRole('radio', { name: /^Smart Timing/ }));
        expect(onSaveSettings).toHaveBeenCalledWith({ auto_sync_enabled: true, adaptive_sync_enabled: true });
    });

    it('the fixed interval radio saves auto sync on, adaptive off', () => {
        const { onSaveSettings } = renderModal({ ...base, auto_sync_enabled: false });
        openTab('Sync');
        fireEvent.click(screen.getByRole('radio', { name: /^Fixed Interval/ }));
        expect(onSaveSettings).toHaveBeenCalledWith({ auto_sync_enabled: true, adaptive_sync_enabled: false });
    });

    it('the interval select posts the minutes as a number', () => {
        const { onSaveSettings } = renderModal();
        openTab('Sync');
        expect(screen.getByRole('radio', { name: /^Fixed Interval/ })).toBeChecked();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '30' } });
        expect(onSaveSettings).toHaveBeenCalledWith({ sync_interval_minutes: 30 });
    });

    it('Tab from the checked sync radio leaves the group; Shift+Tab comes back to it', async () => {
        renderModal();
        openTab('Sync');
        const fixed = screen.getByRole('radio', { name: /^Fixed Interval/ });
        fixed.focus();
        await userEvent.tab();
        // The next stop is the interval select (shown under the fixed radio), not another radio.
        expect(document.activeElement).toBe(screen.getByRole('combobox'));
        await userEvent.tab({ shift: true });
        expect(document.activeElement).toBe(fixed);
        await userEvent.tab({ shift: true });
        expect(document.activeElement).not.toHaveAttribute('type', 'radio');
    });

    it('blog full backup, sync read to phone switches save', () => {
        const { onSaveSettings } = renderModal();
        openTab('Sync');
        fireEvent.click(screen.getByRole('switch', { name: 'Blog Full Backup' }));
        expect(onSaveSettings).toHaveBeenCalledWith({ blogs_full_backup: true });
        fireEvent.click(screen.getByRole('switch', { name: 'Sync read status to phone' }));
        expect(onSaveSettings).toHaveBeenCalledWith({ sync_read_to_phone: true });
    });

    it('verify now runs verify for the active service and closes', () => {
        const { onVerifyAndFix, onClose } = renderModal();
        openTab('Sync');
        fireEvent.click(screen.getByRole('button', { name: 'Verify now' }));
        expect(onVerifyAndFix).toHaveBeenCalledWith('hinatazaka46');
        expect(onClose).toHaveBeenCalled();
    });

    it('deep re-sync asks in-app first; confirm runs it and closes, cancel does not', async () => {
        const { onDeepResync, onClose } = renderModal();
        openTab('Sync');
        fireEvent.click(screen.getByRole('button', { name: 'Re-sync all' }));
        let confirm = await screen.findByRole('dialog', { name: 'Deep re-verify (full re-sync)' });
        fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Deep re-verify (full re-sync)' })).toBeNull());
        expect(onDeepResync).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Re-sync all' }));
        confirm = await screen.findByRole('dialog', { name: 'Deep re-verify (full re-sync)' });
        fireEvent.click(within(confirm).getByRole('button', { name: 'Re-sync all' }));
        expect(onDeepResync).toHaveBeenCalledWith('hinatazaka46');
        expect(onClose).toHaveBeenCalled();
    });

    it('Escape with a confirm open closes only the confirm and returns focus to its opener', async () => {
        const { onClose, onDeepResync } = renderModal();
        openTab('Sync');
        const opener = screen.getByRole('button', { name: 'Re-sync all' });
        await userEvent.click(opener);
        await screen.findByRole('dialog', { name: 'Deep re-verify (full re-sync)' });
        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Deep re-verify (full re-sync)' })).toBeNull());
        expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
        await waitFor(() => expect(opener).toHaveFocus());
        expect(onClose).not.toHaveBeenCalled();
        expect(onDeepResync).not.toHaveBeenCalled();
    });

    it('delete backup asks twice in-app, then deletes each service cache', async () => {
        useAppStore.setState({ selectedServices: ['hinatazaka46'] });
        fetchMock.mockImplementation(async (url: string) => {
            if (url.startsWith('/api/blogs/cache-size')) return { ok: true, json: async () => ({ size_bytes: 2048 }) };
            if (url === '/api/blogs/backup/status') return { ok: true, json: async () => ({ running: {} }) };
            return { ok: true, json: async () => ({}) };
        });
        renderModal({ ...base, blogs_full_backup: true });
        openTab('Sync');
        fireEvent.click(screen.getByRole('button', { name: 'Delete backup' }));
        const first = await screen.findByRole('dialog', { name: 'Delete backup' });
        expect(within(first).getByText(/Delete all backed-up blog data/)).toBeInTheDocument();
        fireEvent.click(within(first).getByRole('button', { name: 'Confirm' }));
        const second = await screen.findByText('Are you sure? This cannot be undone.');
        const secondDialog = second.closest('[role="dialog"]') as HTMLElement;
        expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/blogs/cache?'), expect.anything());
        fireEvent.click(within(secondDialog).getByRole('button', { name: 'Confirm' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/blogs/cache?service=hinatazaka46', { method: 'DELETE' }));
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_clean', outcome: 'ok' }));
    });

    it('delete backup: cancelling the second confirm deletes nothing', async () => {
        useAppStore.setState({ selectedServices: ['hinatazaka46'] });
        renderModal({ ...base, blogs_full_backup: true });
        openTab('Sync');
        await userEvent.click(screen.getByRole('button', { name: 'Delete backup' })); // a real click focuses the opener
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'Delete backup' })).getByRole('button', { name: 'Confirm' }));
        const second = (await screen.findByText('Are you sure? This cannot be undone.')).closest('[role="dialog"]') as HTMLElement;
        // The second step is a fresh dialog: focus starts on its Cancel, not on the Confirm just pressed.
        await waitFor(() => expect(within(second).getByRole('button', { name: 'Cancel' })).toHaveFocus());
        fireEvent.click(within(second).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete backup' })).toBeNull());
        await waitFor(() => expect(screen.getByRole('button', { name: 'Delete backup' })).toHaveFocus());
        expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/blogs/cache?'), expect.anything());
    });

    it('logs the blog cache size and backup status loads', async () => {
        useAppStore.setState({ selectedServices: ['hinatazaka46'] });
        fetchMock.mockImplementation(async (url: string) => {
            if (url.startsWith('/api/blogs/cache-size')) return { ok: true, json: async () => ({ size_bytes: 2048 }) };
            if (url === '/api/blogs/backup/status') return { ok: true, json: async () => ({ running: {} }) };
            return { ok: false, json: async () => ({}) };
        });
        renderModal({ ...base, blogs_full_backup: true });
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_cache', outcome: 'ok' }));
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_backup', outcome: 'ok' }));
    });

    it('stops polling the backup status once the dialog closes', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            useAppStore.setState({ selectedServices: ['hinatazaka46'] });
            fetchMock.mockImplementation(async (url: string) => {
                if (url === '/api/blogs/backup/status') return { ok: true, json: async () => ({ running: { hinatazaka46: true } }) };
                return { ok: false, json: async () => ({}) };
            });
            const statusReads = () => fetchMock.mock.calls.filter(([url]) => url === '/api/blogs/backup/status').length;
            const { unmount } = render(
                <SettingsModal appSettings={{ ...base, blogs_full_backup: true }} outputDirInput="/out" setOutputDirInput={vi.fn()}
                    onSaveSettings={vi.fn()} onClose={vi.fn()} activeService="hinatazaka46" onVerifyAndFix={vi.fn()} onDeepResync={vi.fn()} />,
            );
            await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_backup', outcome: 'ok' }));
            const before = statusReads();
            unmount();
            await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
            expect(statusReads()).toBe(before);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not start a second stats read while the previous one is pending, and aborts it on close', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            useAppStore.setState({ selectedServices: ['hinatazaka46'] });
            const signals: AbortSignal[] = [];
            fetchMock.mockImplementation((url: string, init?: RequestInit) => {
                if (url === '/api/blogs/backup/status') return Promise.resolve({ ok: true, json: async () => ({ running: { hinatazaka46: true } }) });
                if (url.startsWith('/api/blogs/cache-stats')) {
                    signals.push(init!.signal!);
                    expect(init?.cache).toBe('no-store');
                    return new Promise(() => {}); // a slow scan: never answers within the test
                }
                return Promise.resolve({ ok: false, json: async () => ({}) });
            });
            const statusReads = () => fetchMock.mock.calls.filter(([url]) => url === '/api/blogs/backup/status').length;
            const { unmount } = render(
                <SettingsModal appSettings={{ ...base, blogs_full_backup: true }} outputDirInput="/out" setOutputDirInput={vi.fn()}
                    onSaveSettings={vi.fn()} onClose={vi.fn()} activeService="hinatazaka46" onVerifyAndFix={vi.fn()} onDeepResync={vi.fn()} />,
            );
            await waitFor(() => expect(signals).toHaveLength(1));
            await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
            expect(statusReads()).toBeGreaterThanOrEqual(2);
            expect(signals).toHaveLength(1);
            unmount();
            expect(signals[0].aborted).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('logs a failed backup status read as an error', async () => {
        useAppStore.setState({ selectedServices: ['hinatazaka46'] });
        fetchMock.mockRejectedValue(new Error('offline'));
        renderModal({ ...base, blogs_full_backup: true });
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_backup', outcome: 'error' }));
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_cache', outcome: 'error' }));
    });

    async function confirmDeleteBackup() {
        openTab('Sync');
        fireEvent.click(screen.getByRole('button', { name: 'Delete backup' }));
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'Delete backup' })).getByRole('button', { name: 'Confirm' }));
        const second = (await screen.findByText('Are you sure? This cannot be undone.')).closest('[role="dialog"]') as HTMLElement;
        fireEvent.click(within(second).getByRole('button', { name: 'Confirm' }));
    }

    it('a refused DELETE logs the clean as an error, not ok', async () => {
        useAppStore.setState({ selectedServices: ['hinatazaka46', 'sakurazaka46'] });
        fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
            if (init?.method === 'DELETE') return { ok: false, json: async () => ({}) };
            if (url.startsWith('/api/blogs/cache-size')) return { ok: true, json: async () => ({ size_bytes: 2048 }) };
            if (url === '/api/blogs/backup/status') return { ok: true, json: async () => ({ running: {} }) };
            return { ok: true, json: async () => ({}) };
        });
        renderModal({ ...base, blogs_full_backup: true });
        await confirmDeleteBackup();
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_clean', outcome: 'error' }));
        expect(clientLog).not.toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_clean', outcome: 'ok' });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Delete backup' })).toBeEnabled());
    });

    it('one refused DELETE out of two logs the clean as partial with the failure count', async () => {
        useAppStore.setState({ selectedServices: ['hinatazaka46', 'sakurazaka46'] });
        fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
            if (init?.method === 'DELETE') return { ok: url.includes('hinatazaka46'), json: async () => ({}) };
            if (url.startsWith('/api/blogs/cache-size')) return { ok: true, json: async () => ({ size_bytes: 2048 }) };
            if (url === '/api/blogs/backup/status') return { ok: true, json: async () => ({ running: {} }) };
            return { ok: true, json: async () => ({}) };
        });
        renderModal({ ...base, blogs_full_backup: true });
        await confirmDeleteBackup();
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_clean', outcome: 'partial', count: 1 }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Delete backup' })).toBeEnabled());
    });

    it('a refused cache-size read and a refused backup status log partial / error, never ok', async () => {
        useAppStore.setState({ selectedServices: ['hinatazaka46', 'sakurazaka46'] });
        fetchMock.mockImplementation(async (url: string) => {
            if (url.startsWith('/api/blogs/cache-size')) return { ok: !url.includes('sakurazaka46'), json: async () => ({ size_bytes: 2048 }) };
            if (url === '/api/blogs/backup/status') return { ok: false, json: async () => ({ detail: 'x' }) };
            return { ok: false, json: async () => ({}) };
        });
        renderModal({ ...base, blogs_full_backup: true });
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_cache', outcome: 'partial', count: 1 }));
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_backup', outcome: 'error' }));
        expect(clientLog).not.toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_backup', outcome: 'ok' });
    });

    it('failed cache-stats reads are logged with the failure count', async () => {
        useAppStore.setState({ selectedServices: ['hinatazaka46', 'sakurazaka46'] });
        fetchMock.mockImplementation(async (url: string) => {
            if (url.startsWith('/api/blogs/cache-size')) return { ok: true, json: async () => ({ size_bytes: 2048 }) };
            if (url === '/api/blogs/backup/status') return { ok: true, json: async () => ({ running: {} }) };
            if (url.startsWith('/api/blogs/cache-stats')) {
                if (url.includes('sakurazaka46')) throw new Error('offline');
                return { ok: true, json: async () => ({ cached_blogs: 1, available_blogs: 2 }) };
            }
            return { ok: false, json: async () => ({}) };
        });
        renderModal({ ...base, blogs_full_backup: true });
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_stats', outcome: 'partial', count: 1 }));
    });
});

describe('app settings save failures', () => {
    it('a refused save shows the failure inline on its row and logs settings_app_save error', async () => {
        const onSaveSettings = vi.fn().mockResolvedValue(false);
        renderModal(base, { onSaveSettings });
        const row = screen.getByRole('switch', { name: i18n.t('settings.closeToTray') }).closest('section')!;
        await act(async () => { fireEvent.click(within(row as HTMLElement).getByRole('switch')); });
        expect(within(row as HTMLElement).getByRole('status')).toHaveTextContent(i18n.t('settings.saveFailed'));
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_app_save', outcome: 'error' });
        // Only the failed row shows it.
        expect(screen.getAllByText(i18n.t('settings.saveFailed'))).toHaveLength(1);
    });

    it('a later successful save on the row clears the failure and logs ok', async () => {
        const onSaveSettings = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
        renderModal(base, { onSaveSettings });
        const row = screen.getByRole('switch', { name: i18n.t('settings.autostart') }).closest('section') as HTMLElement;
        await act(async () => { fireEvent.click(within(row).getByRole('switch')); });
        expect(within(row).getByRole('status')).toHaveTextContent(i18n.t('settings.saveFailed'));
        await act(async () => { fireEvent.click(within(row).getByRole('switch')); });
        expect(screen.queryByText(i18n.t('settings.saveFailed'))).toBeNull();
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_app_save', outcome: 'ok' });
    });

    it('a refused sync mode save shows the failure under the sync mode row', async () => {
        const onSaveSettings = vi.fn().mockResolvedValue(false);
        renderModal(base, { onSaveSettings });
        openTab('Sync');
        await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /^Off/ })); });
        const group = screen.getByRole('radiogroup');
        expect(within(group.closest('section') as HTMLElement).getByRole('status')).toHaveTextContent(i18n.t('settings.saveFailed'));
    });
});

describe('updates tab', () => {
    it('auto-download switch saves', () => {
        const { onSaveSettings } = renderModal();
        openTab('Updates');
        fireEvent.click(screen.getByRole('switch', { name: 'Auto-Download Updates' }));
        expect(onSaveSettings).toHaveBeenCalledWith({ auto_download_updates: true });
    });

    it('check now shows the result as a status and logs the outcome', async () => {
        fetchMock.mockImplementation(async (url: string) =>
            url === '/api/version?force=true' ? { ok: true, json: async () => ({ update_available: false }) } : { ok: false, json: async () => ({}) });
        renderModal();
        openTab('Updates');
        // The live region is in place (empty) before the check, so the result is announced.
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
        fireEvent.click(screen.getByRole('button', { name: 'Check Now' }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(i18n.t('settings.upToDate')));
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_update_check', outcome: 'ok' });
    });

    it('a check that finds an update shows the Download button (shared upgrade store)', async () => {
        fetchMock.mockImplementation(async (url: string) =>
            url === '/api/version?force=true'
                ? { ok: true, json: async () => ({ current_version: '0.4.1', latest_version: '0.4.2', update_available: true, upgrade_supported: true, release_url: null, release_notes: null, error: null }) }
                : { ok: false, json: async () => ({}) });
        renderModal();
        openTab('Updates');
        fireEvent.click(screen.getByRole('button', { name: 'Check Now' }));
        expect(await screen.findByRole('button', { name: 'Download update' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('a failed check logs an error without the error text', async () => {
        fetchMock.mockImplementation(async (url: string) => {
            if (url === '/api/version?force=true') throw new Error('secret detail');
            return { ok: false, json: async () => ({}) };
        });
        const consoleError = vi.spyOn(console, 'error');
        renderModal();
        openTab('Updates');
        fireEvent.click(screen.getByRole('button', { name: 'Check Now' }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(i18n.t('settings.updateCheckFailed')));
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_update_check', outcome: 'error' });
        expect(consoleError).not.toHaveBeenCalled();
    });
});

describe('AI tab', () => {
    const KEY = 'AIzaSECRETkey123';
    const MASKED = 'AIza...xQ';
    type Outcome = 'ok' | 'refused' | 'reject';

    /** Fake translation API: config, models, configure and clear-api-key, each ok / refused / rejected. */
    function mockAi({ config = 'ok', models = 'ok', configure = 'ok', clear = 'ok', cacheClear = 'ok', test = { ok: true } as Record<string, unknown> | 'reject', hasKey = true, provider = 'gemini' as string | null }: {
        config?: Outcome; models?: Outcome; configure?: Outcome; clear?: Outcome; cacheClear?: Outcome;
        test?: Record<string, unknown> | 'reject'; hasKey?: boolean; provider?: string | null;
    } = {}) {
        const reply = (outcome: Outcome, body: unknown) => {
            if (outcome === 'reject') throw new Error(`offline ${KEY}`);
            return { ok: outcome === 'ok', json: async () => (outcome === 'ok' ? body : { detail: `bad ${KEY}` }) };
        };
        fetchMock.mockImplementation(async (url: string) => {
            if (url === '/api/translation/config') {
                return reply(config, { provider, model: provider ? 'm1' : null, has_api_key: hasKey, api_key_masked: hasKey ? MASKED : null, target_language: null });
            }
            if (url === '/api/translation/models') return reply(models, { gemini: [{ id: 'm1', label: 'Model 1' }, { id: 'm2', label: 'Model 2' }] });
            if (url === '/api/translation/configure') return reply(configure, { ok: true });
            if (url === '/api/translation/clear-api-key') return reply(clear, { ok: true });
            if (url === '/api/app-state/translations/clear') return reply(cacheClear, {});
            if (url === '/api/translation/test-connection') {
                if (test === 'reject') throw new Error(`offline ${KEY}`);
                return { ok: true, json: async () => test };
            }
            return { ok: false, json: async () => ({}) };
        });
    }

    /** Open the AI tab and let both of its loads settle (no state update after the test). */
    async function openAi() {
        openTab('AI');
        await waitFor(() => expect(vi.mocked(clientLog).mock.calls.some(([, f]) => f?.surface === 'settings_ai_config')).toBe(true));
        await waitFor(() => expect(vi.mocked(clientLog).mock.calls.some(([, f]) => f?.surface === 'settings_ai_models')).toBe(true));
    }

    const configureBodies = () => fetchMock.mock.calls
        .filter(([url]) => url === '/api/translation/configure')
        .map(([, init]) => JSON.parse((init as RequestInit).body as string));

    it('transcription and translation switches drive the store', async () => {
        mockAi();
        renderModal();
        await openAi();
        fireEvent.click(screen.getByRole('switch', { name: 'Transcription' }));
        expect(useAppStore.getState().transcriptionEnabled).toBe(false);
        fireEvent.click(screen.getByRole('switch', { name: 'Translation' }));
        expect(useAppStore.getState().translationEnabled).toBe(true);
    });

    it('logs the config and models loads', async () => {
        mockAi();
        renderModal();
        await openAi();
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_ai_config', outcome: 'ok' });
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_ai_models', outcome: 'ok' });
    });

    it.each([['refused'], ['reject']] as const)('a %s config or models load logs an error', async (outcome) => {
        mockAi({ config: outcome, models: outcome });
        renderModal();
        await openAi();
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_ai_config', outcome: 'error' });
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_ai_models', outcome: 'error' });
    });

    it('target language, provider, model and key (on blur) save to /configure', async () => {
        useAppStore.setState({ translationEnabled: true });
        mockAi({ hasKey: false });
        renderModal();
        await openAi();
        fireEvent.change(screen.getByLabelText('Target Language'), { target: { value: 'zh-TW' } });
        await waitFor(() => expect(configureBodies()).toContainEqual({ provider: 'gemini', model: 'm1', api_key: null, target_language: 'zh-TW' }));
        expect(useAppStore.getState().translationTargetLanguage).toBe('zh-TW');

        fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'm2' } });
        await waitFor(() => expect(configureBodies()).toContainEqual({ provider: 'gemini', model: 'm2', api_key: null, target_language: 'zh-TW' }));

        fireEvent.change(screen.getByLabelText('Provider'), { target: { value: '' } });
        await waitFor(() => expect(configureBodies()).toContainEqual({ provider: null, model: null, api_key: null, target_language: 'zh-TW' }));
        fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'gemini' } });
        await waitFor(() => expect(configureBodies()).toContainEqual({ provider: 'gemini', model: 'm1', api_key: null, target_language: 'zh-TW' }));

        const key = screen.getByLabelText('API Key');
        fireEvent.change(key, { target: { value: KEY } });
        fireEvent.blur(key);
        await waitFor(() => expect(configureBodies()).toContainEqual({ provider: 'gemini', model: 'm1', api_key: KEY, target_language: 'zh-TW' }));
        await waitFor(() => expect(vi.mocked(clientLog).mock.calls.filter(([, f]) => f?.surface === 'settings_ai_save' && f.outcome === 'ok')).toHaveLength(5));

        // The saved key reads as stored once the field is cleared.
        fireEvent.change(key, { target: { value: '' } });
        expect(screen.getByText('Saved securely in credential manager')).toBeInTheDocument();
    });

    it.each([['refused'], ['reject']] as const)('a %s key save shows an error, logs it, and never claims the key is saved', async (outcome) => {
        useAppStore.setState({ translationEnabled: false });
        mockAi({ hasKey: false, configure: outcome });
        renderModal();
        await openAi();
        const key = screen.getByLabelText('API Key');
        fireEvent.change(key, { target: { value: KEY } });
        fireEvent.blur(key);
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_ai_save', outcome: 'error' }));
        expect(screen.getByRole('status')).toHaveTextContent(i18n.t('translation.settings.saveFailed'));
        fireEvent.change(key, { target: { value: '' } });
        expect(screen.queryByText('Saved securely in credential manager')).toBeNull();
        expect(screen.getByText(i18n.t('translation.settings.keyMissing'))).toBeInTheDocument();
    });

    it('clear API key asks in-app, then clears the stored key and logs ok', async () => {
        mockAi();
        renderModal();
        await openAi();
        fireEvent.click(await screen.findByRole('button', { name: 'Clear API key' }));
        const confirm = await screen.findByRole('dialog', { name: 'Clear API key' });
        expect(fetchMock).not.toHaveBeenCalledWith('/api/translation/clear-api-key', expect.anything());
        fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/translation/clear-api-key', { method: 'POST' }));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear API key' })).toBeNull());
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_ai_key_clear', outcome: 'ok' });
    });

    it.each([['refused'], ['reject']] as const)('a %s clear keeps the key shown as saved and says it failed', async (outcome) => {
        mockAi({ clear: outcome });
        renderModal();
        await openAi();
        fireEvent.click(await screen.findByRole('button', { name: 'Clear API key' }));
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'Clear API key' })).getByRole('button', { name: 'Confirm' }));
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_ai_key_clear', outcome: 'error' }));
        expect(screen.getByRole('status')).toHaveTextContent(i18n.t('translation.settings.clearApiKeyFailed'));
        expect(screen.getByText('Saved securely in credential manager')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Clear API key' })).toBeInTheDocument();
    });

    it('clear translation cache says cleared and logs ok', async () => {
        useAppStore.setState({ translationEnabled: true });
        mockAi();
        renderModal();
        await openAi();
        fireEvent.click(screen.getByRole('button', { name: 'Clear Translation Cache' }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(i18n.t('translation.settings.cacheClearedMsg')));
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_ai_cache_clear', outcome: 'ok' });
    });

    it.each([['refused'], ['reject']] as const)('a %s cache clear says it failed and logs an error', async (outcome) => {
        useAppStore.setState({ translationEnabled: true });
        mockAi({ cacheClear: outcome });
        renderModal();
        await openAi();
        fireEvent.click(screen.getByRole('button', { name: 'Clear Translation Cache' }));
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_ai_cache_clear', outcome: 'error' }));
        expect(screen.getByRole('status')).toHaveTextContent(i18n.t('translation.settings.cacheClearFailed'));
        expect(screen.queryByText(i18n.t('translation.settings.cacheClearedMsg'))).toBeNull();
    });

    it.each([
        [{ ok: true }, 'testSuccess', { outcome: 'ok' }],
        [{ ok: false, code: 'auth', detail: 'bad key' }, 'testErrorAuth', { outcome: 'error', reason: 'auth' }],
        [{ ok: false, code: 'unreachable' }, 'testErrorUnreachable', { outcome: 'error', reason: 'unreachable' }],
        [{ ok: false, code: 'no_key' }, 'testErrorNoKey', { outcome: 'error', reason: 'no_key' }],
        [{ ok: false, code: 'something new', detail: 'x' }, 'testFailed', { outcome: 'error', reason: 'failed' }],
        ['reject', 'testErrorUnreachable', { outcome: 'error', reason: 'unreachable' }],
    ] as const)('test connection %j shows %s and logs only a code', async (test, messageKey, fields) => {
        mockAi({ test: test as Record<string, unknown> | 'reject' });
        renderModal();
        await openAi();
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(i18n.t(`translation.settings.${messageKey}`)));
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_ai_test', ...fields });
    });

    it('never logs the API key or its masked form', async () => {
        mockAi({ configure: 'refused', clear: 'reject' });
        renderModal();
        await openAi();
        const key = screen.getByLabelText('API Key');
        fireEvent.change(key, { target: { value: KEY } });
        fireEvent.blur(key);
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_ai_save', outcome: 'error' }));
        fireEvent.change(key, { target: { value: '' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Clear API key' }));
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'Clear API key' })).getByRole('button', { name: 'Confirm' }));
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_ai_key_clear', outcome: 'error' }));

        // clientLog is mocked, so its calls are exactly what would be posted to /api/client-log.
        const logged = JSON.stringify(vi.mocked(clientLog).mock.calls);
        for (const secret of [KEY, MASKED, 'SECRET']) {
            expect(logged).not.toContain(secret);
        }
    });
});
