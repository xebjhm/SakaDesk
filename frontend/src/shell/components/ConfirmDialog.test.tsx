import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { ConfirmDialog } from './ConfirmDialog';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';

beforeAll(async () => { await i18n.changeLanguage('en'); });

function renderDialog(over: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
    const props = {
        open: true, title: '確認 ✅', message: '本当に？\n二行目', confirmLabel: 'はい',
        onConfirm: vi.fn(), onCancel: vi.fn(), ...over,
    };
    render(<ConfirmDialog {...props} />);
    return props;
}

describe('ConfirmDialog', () => {
    it('renders nothing when closed', () => {
        renderDialog({ open: false });
        expect(screen.queryByText('確認 ✅')).toBeNull();
    });

    it('renders the plain header', () => {
        renderDialog();
        expect(screen.getByTestId('modal-header').className).not.toContain('bg-expressive-header');
        expect(screen.queryByTestId('modal-header-bar')).toBeNull();
    });

    it('shows title, message and the two buttons; confirm and cancel call back', async () => {
        const p = renderDialog();
        expect(screen.getByRole('heading', { name: '確認 ✅' })).toBeInTheDocument();
        expect(screen.getByText(/本当に？/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'はい' }));
        expect(p.onConfirm).toHaveBeenCalledTimes(1);
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(p.onCancel).toHaveBeenCalledTimes(1);
    });

    it('uses a custom cancel label', () => {
        renderDialog({ cancelLabel: '閉じる' });
        expect(screen.getByRole('button', { name: '閉じる' })).toBeInTheDocument();
    });

    it('is a dialog: Escape cancels, focus starts on Cancel', async () => {
        const p = renderDialog();
        expect(screen.getByRole('dialog', { name: '確認 ✅' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        expect(p.onCancel).toHaveBeenCalledTimes(1);
    });

    it('a danger confirm uses the danger button', () => {
        renderDialog({ variant: 'danger' });
        expect(screen.getByRole('button', { name: 'はい' })).toHaveClass('bg-status-danger');
    });

    it('Enter on the focused Cancel cancels, never confirms', async () => {
        const p = renderDialog();
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        expect(p.onCancel).toHaveBeenCalledTimes(1);
        expect(p.onConfirm).not.toHaveBeenCalled();
    });

    it('logs under "confirm" by default and under a given logId', () => {
        vi.mocked(clientLog).mockClear();
        renderDialog();
        expect(clientLog).toHaveBeenCalledWith('dialog', { surface: 'confirm', phase: 'open' });
        vi.mocked(clientLog).mockClear();
        renderDialog({ logId: 'reveal_all', title: '全部' });
        expect(clientLog).toHaveBeenCalledWith('dialog', { surface: 'reveal_all', phase: 'open' });
    });
});
