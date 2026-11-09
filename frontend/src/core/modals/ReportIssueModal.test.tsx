import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { ReportIssueModal } from './ReportIssueModal';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('ReportIssueModal', () => {
    it('is a brand dialog with the bug icon, and the chosen category uses the accent roles', async () => {
        render(<ReportIssueModal isOpen onClose={vi.fn()} currentScreen="Home" />);
        expect(screen.getByRole('dialog', { name: 'Report an Issue' })).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByTestId('modal-header-icon')).toBeInTheDocument();
        const sync = screen.getByRole('button', { name: /Sync \/ Data/ });
        await userEvent.click(sync);
        expect(sync).toHaveAttribute('aria-pressed', 'true');
        expect(sync).toHaveClass('border-accent', 'bg-accent-subtle');
        expect(screen.getByText('Sync / Data')).toHaveClass('text-accent-strong');
    });

    it('creating an issue needs a category', async () => {
        render(<ReportIssueModal isOpen onClose={vi.fn()} currentScreen="Home" />);
        const create = screen.getByRole('button', { name: /Create GitHub Issue/ });
        expect(create).toBeDisabled();
        const firstCategory = screen.getAllByRole('button').find((b) => b !== create && b.textContent && b.textContent.length > 0 && !/Cancel/.test(b.textContent))!;
        await userEvent.click(firstCategory);
        expect(create).toBeEnabled();
    });

    it('Cancel closes', async () => {
        const onClose = vi.fn();
        render(<ReportIssueModal isOpen onClose={onClose} currentScreen="Home" />);
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalled();
    });
});

describe('ReportIssueModal breadcrumbs', () => {
    const GITHUB = 'https://github.com/example/issues/new?title=secret';
    beforeEach(() => {
        vi.mocked(clientLog).mockClear();
        vi.spyOn(window, 'open').mockImplementation(() => null);
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    async function createIssue() {
        render(<ReportIssueModal isOpen onClose={vi.fn()} currentScreen="Home" crashError="TypeError: 石塚 secret" />);
        const create = screen.getByRole('button', { name: /Create GitHub Issue/ });
        const firstCategory = screen.getAllByRole('button').find((b) => b !== create && b.textContent && b.textContent.length > 0 && !/Cancel/.test(b.textContent))!;
        await userEvent.click(firstCategory);
        await userEvent.click(create);
    }

    it('logs a created report as ok, without the URL or the crash text', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ diagnostics: {}, github_url: GITHUB }) }));
        await createIssue();
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'report_issue', outcome: 'ok' }));
        const logged = JSON.stringify(vi.mocked(clientLog).mock.calls);
        expect(logged).not.toContain('github');
        expect(logged).not.toContain('secret');
    });

    it('logs a refused report as an error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
        await createIssue();
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'report_issue', outcome: 'error' }));
        expect(window.open).not.toHaveBeenCalled();
    });
});
