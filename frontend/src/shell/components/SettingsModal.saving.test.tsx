import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
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
    it('language select switches the language and persists it', () => {
        const setPref = vi.spyOn(persisted, 'setPref').mockImplementation(() => {});
        renderModal();
        const select = screen.getByDisplayValue('English');
        fireEvent.change(select, { target: { value: 'ja' } });
        expect(i18n.language).toBe('ja');
        expect(setPref).toHaveBeenCalledWith('language', 'ja');
    });

    it('output folder: typing updates the input, Save posts output_dir', () => {
        const { onSaveSettings, setOutputDirInput } = renderModal();
        const input = screen.getByDisplayValue('/out');
        fireEvent.change(input, { target: { value: '/new' } });
        expect(setOutputDirInput).toHaveBeenCalledWith('/new');
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSaveSettings).toHaveBeenCalledWith({ output_dir: '/out' });
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

    it('fixed interval radio saves, and the interval select posts a number', () => {
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

    it('logs a failed backup status read as an error', async () => {
        useAppStore.setState({ selectedServices: ['hinatazaka46'] });
        fetchMock.mockRejectedValue(new Error('offline'));
        renderModal({ ...base, blogs_full_backup: true });
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_backup', outcome: 'error' }));
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_blog_cache', outcome: 'error' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'Check Now' }));
        expect(await screen.findByRole('status')).toHaveTextContent(i18n.t('settings.upToDate'));
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_update_check', outcome: 'ok' });
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
        expect(await screen.findByRole('status')).toHaveTextContent(i18n.t('settings.updateCheckFailed'));
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_update_check', outcome: 'error' });
        expect(consoleError).not.toHaveBeenCalled();
    });
});

describe('AI tab', () => {
    it('transcription and translation switches drive the store', () => {
        renderModal();
        openTab('AI');
        fireEvent.click(screen.getByRole('switch', { name: 'Transcription' }));
        expect(useAppStore.getState().transcriptionEnabled).toBe(false);
        fireEvent.click(screen.getByRole('switch', { name: 'Translation' }));
        expect(useAppStore.getState().translationEnabled).toBe(true);
    });

    it('clear API key asks in-app, then clears the stored key', async () => {
        fetchMock.mockImplementation(async (url: string) => {
            if (url === '/api/translation/config') {
                return { ok: true, json: async () => ({ provider: 'gemini', model: 'm', has_api_key: true, api_key_masked: 'AIza...xQ', target_language: null }) };
            }
            if (url === '/api/translation/models') return { ok: true, json: async () => ({ gemini: [{ id: 'm', label: 'M' }] }) };
            return { ok: true, json: async () => ({}) };
        });
        renderModal();
        openTab('AI');
        fireEvent.click(await screen.findByRole('button', { name: 'Clear API key' }));
        const confirm = await screen.findByRole('dialog', { name: 'Clear API key' });
        expect(fetchMock).not.toHaveBeenCalledWith('/api/translation/clear-api-key', expect.anything());
        fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/translation/clear-api-key', { method: 'POST' }));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear API key' })).toBeNull());
    });
});
