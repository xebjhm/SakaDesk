import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { SettingsModal } from './SettingsModal';
import { resetDialogStack } from '../../design/dialog/dialogStack';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    resetDialogStack();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
});

const settings = { output_dir: '/out', auto_sync_enabled: true, sync_interval_minutes: 15, is_configured: true };

function renderModal(onClose = vi.fn(), onSaveSettings = vi.fn().mockResolvedValue(true)) {
    render(
        <SettingsModal appSettings={settings} outputDirInput="/out" setOutputDirInput={() => {}} onSaveSettings={onSaveSettings}
            onClose={onClose} activeService="hinatazaka46" onVerifyAndFix={() => {}} onDeepResync={() => {}} />,
    );
    return { onClose, onSaveSettings };
}

describe('SettingsModal layout', () => {
    it('is a named dialog with a section nav that marks the current tab', async () => {
        renderModal();
        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        const nav = within(dialog).getByRole('navigation', { name: 'Settings sections' });
        expect(within(nav).getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'true');
        await userEvent.click(within(nav).getByRole('button', { name: 'Sync' }));
        expect(within(nav).getByRole('button', { name: 'Sync' })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByText('Sync Mode')).toBeInTheDocument();
    });

    it('has one primary button (Save) and the close button closes', async () => {
        const { onClose } = renderModal();
        const primaries = screen.getAllByRole('button').filter((b) => b.className.includes('bg-group-accent') && !b.getAttribute('role'));
        expect(primaries.map((b) => b.textContent)).toEqual(['Save']);
        await userEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalled();
    });

    it('the blog backup toggle is a named switch', async () => {
        renderModal();
        await userEvent.click(screen.getByRole('button', { name: 'Sync' }));
        expect(screen.getByRole('switch', { name: /backup/i })).toBeInTheDocument();
    });
});
