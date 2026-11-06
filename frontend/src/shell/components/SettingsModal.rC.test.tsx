import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { SettingsModal } from './SettingsModal';
import { groupRoles } from '../../design/tokens';
import { resetDialogStack } from '../../design/dialog/dialogStack';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    resetDialogStack();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
});

const settings = { output_dir: '/out', auto_sync_enabled: true, sync_interval_minutes: 15, is_configured: true };

function renderModal(activeService = 'sakurazaka46') {
    render(
        <SettingsModal appSettings={settings} outputDirInput="/out" setOutputDirInput={() => {}} onSaveSettings={vi.fn().mockResolvedValue(true)}
            onClose={vi.fn()} activeService={activeService} onVerifyAndFix={() => {}} onDeepResync={() => {}} />,
    );
}

describe('SettingsModal (R-c)', () => {
    it('is a brand dialog: aurora header, ink selection in the section nav', () => {
        renderModal();
        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        expect(dialog).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByTestId('modal-header')).toHaveClass('bg-expressive-header');
        const nav = within(dialog).getByRole('navigation', { name: 'Settings sections' });
        const current = within(nav).getByRole('button', { name: 'General' });
        expect(current).toHaveClass('bg-accent-subtle', 'text-accent-strong', 'font-semibold', 'focus-visible:ring-accent');
        expect(within(nav).getByRole('button', { name: 'Sync' })).not.toHaveClass('bg-accent-subtle');
    });

    it('marks the per-group sync rows with the active group (D5) and keeps re-sync in the warning colour (D6)', async () => {
        renderModal('sakurazaka46');
        await userEvent.click(screen.getByRole('button', { name: 'Sync' }));
        const rows = screen.getByTestId('settings-group-rows');
        expect(rows.style.getPropertyValue('--ds-group-accent')).toBe(groupRoles('sakurazaka').action);
        const chips = within(rows).getAllByTestId('settings-group-chip');
        expect(chips).toHaveLength(2);
        expect(chips[0]).toHaveTextContent('櫻坂46');
        expect(chips[0]).toHaveAttribute('lang', 'ja');
        expect(within(rows).getByRole('button', { name: 'Verify now' })).toHaveClass('text-accent-strong');
        expect(within(rows).getByRole('button', { name: 'Re-sync all' })).toHaveClass('text-semantic-warning');
        for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveClass('accent-accent');
    });

    it('draws Check Now as a quiet accent wash', async () => {
        renderModal();
        await userEvent.click(screen.getByRole('button', { name: 'Updates' }));
        expect(screen.getByRole('button', { name: 'Check Now' })).toHaveClass('bg-accent-wash', 'border-accent-wash', 'text-accent-strong');
    });
});
