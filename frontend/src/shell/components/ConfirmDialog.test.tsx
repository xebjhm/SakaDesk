import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { ConfirmDialog } from './ConfirmDialog';
import { BrandScope } from '../../design/brandScope';

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

    it('renders the expressive header of its context with a semantic icon tile (D3)', () => {
        renderDialog({ variant: 'warning' });
        expect(screen.getByTestId('modal-header')).toHaveClass('bg-expressive-header');
        expect(screen.getByTestId('modal-header-bar')).toBeInTheDocument();
        expect(screen.getByTestId('modal-header-icon').firstElementChild).toHaveClass('bg-semantic-warning-icon', 'border-semantic-warning', 'text-semantic-warning');
    });

    it('uses the danger tile for a danger confirm and the info tile otherwise, and Cancel is secondary', () => {
        renderDialog({ variant: 'danger' });
        expect(screen.getByTestId('modal-header-icon').firstElementChild).toHaveClass('bg-semantic-danger-icon', 'text-semantic-danger');
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('border-strong');
    });

    it('inherits the brand context inside a brand dialog', () => {
        render(
            <BrandScope>
                <ConfirmDialog open title="確認" message="m" confirmLabel="OK" onConfirm={vi.fn()} onCancel={vi.fn()} />
            </BrandScope>,
        );
        expect(screen.getByRole('dialog', { name: '確認' })).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByTestId('modal-header-icon').firstElementChild).toHaveClass('bg-semantic-info-icon', 'text-semantic-info');
    });

    it('a warning confirm stays amber inside a brand scope, a default one takes the primary', () => {
        const { unmount } = render(
            <BrandScope>
                <ConfirmDialog open title="警告" message="m" confirmLabel="続行" variant="warning" onConfirm={vi.fn()} onCancel={vi.fn()} />
            </BrandScope>,
        );
        const warn = screen.getByRole('button', { name: '続行' });
        expect(warn).toHaveClass('bg-status-attention');
        expect(warn).not.toHaveClass('bg-accent-gradient');
        unmount();
        renderDialog();
        expect(screen.getByRole('button', { name: 'はい' })).toHaveClass('bg-accent-gradient');
    });

    it('outside a brand scope the dialog has no brand data-scope', () => {
        renderDialog();
        expect(screen.getByRole('dialog', { name: '確認 ✅' })).not.toHaveAttribute('data-scope', 'brand');
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
