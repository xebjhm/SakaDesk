import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import i18n from '../../i18n';
import { resetUpgradeStoreForTests } from '../../core/upgrade/upgradeStore';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import { useAppStore } from '../../store/appStore';
import { useSettings } from '../hooks/useSettings';
import { SettingsModal } from './SettingsModal';
import { SetupWizard } from './SetupWizard';

// The output folder end to end inside the real hook: Browse fills the field, Save posts what
// the field shows, and a refused save says why next to the field (the App toast sits outside
// the dialog's focus trap). Security audit 2026-11-13.

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn(), breadcrumbCode: () => 'unknown' }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

const SAVED = { output_dir: '/out', auto_sync_enabled: false, adaptive_sync_enabled: false, sync_interval_minutes: 15, is_configured: true };
let posts: Record<string, unknown>[];
let saveReply: () => { ok: boolean; json: () => Promise<unknown> };

beforeEach(() => {
    resetUpgradeStoreForTests();
    resetDialogStack();
    useAppStore.setState({ selectedServices: [] });
    posts = [];
    saveReply = () => ({ ok: true, json: async () => ({ ...SAVED, ...posts[posts.length - 1] }) });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/settings/select-folder') return { ok: true, json: async () => ({ path: 'D:\\データ' }) };
        if (url === '/api/settings' && init?.method === 'POST') {
            posts.push(JSON.parse(String(init.body)));
            return saveReply();
        }
        if (url === '/api/settings') return { ok: true, json: async () => SAVED };
        return { ok: false, json: async () => ({}) };
    }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const refusal = (reason: string) => () => ({
    ok: false, json: async () => ({ detail: { code: 'output_dir_rejected', reason } }),
});

function SettingsHarness() {
    const s = useSettings(true);
    if (!s.appSettings) return null;
    return (
        <SettingsModal appSettings={s.appSettings} outputDirInput={s.outputDirInput}
            onSelectFolder={s.handleSelectFolder} folderErrorKey={s.folderErrorKey}
            onSaveSettings={s.saveSettings} onClose={() => {}} activeService="hinatazaka46"
            onVerifyAndFix={() => {}} onDeepResync={() => {}} />
    );
}

function WizardHarness() {
    const s = useSettings(true);
    return (
        <SetupWizard outputDirInput={s.outputDirInput} setupBlogFullBackup={false} setSetupBlogFullBackup={() => {}}
            onSelectFolder={s.handleSelectFolder} isValid={!!s.outputDirInput.trim()}
            folderErrorKey={s.folderErrorKey}
            onComplete={() => { void s.saveSettings({ output_dir: s.outputDirInput.trim() }); }} />
    );
}

describe('Settings output folder', () => {
    it('Save posts the folder picked with Browse', async () => {
        render(<SettingsHarness />);
        await screen.findByDisplayValue('/out');
        fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
        await screen.findByDisplayValue('D:\\データ');
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(posts).toEqual([{ output_dir: 'D:\\データ' }]));
    });

    it('a refused save says why on the row, tied to the field; a new pick replaces it', async () => {
        saveReply = refusal('not_picked');
        render(<SettingsHarness />);
        await screen.findByDisplayValue('/out');
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        const msg = await screen.findByText(i18n.t('settings.outputDirError.not_picked'));
        const field = screen.getByRole('textbox', { name: 'Output Folder' });
        expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(msg.id);
        expect(field).toHaveAttribute('aria-invalid', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
        await screen.findByDisplayValue('D:\\データ');
        expect(screen.queryByText(i18n.t('settings.outputDirError.not_picked'))).toBeNull();
        expect(field).not.toHaveAttribute('aria-invalid');
    });
});

describe('Setup wizard output folder', () => {
    it('a refused save says why inside the wizard', async () => {
        saveReply = refusal('app_data');
        render(<WizardHarness />);
        fireEvent.click(await screen.findByRole('button', { name: 'Browse' }));
        await screen.findByDisplayValue('D:\\データ');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start Using SakaDesk' })); });
        const alert = await screen.findByText(i18n.t('settings.outputDirError.app_data'));
        expect(alert).toHaveAttribute('role', 'alert');
        expect(screen.getByLabelText('Output Folder Path')).toHaveAttribute('aria-invalid', 'true');
    });
});
