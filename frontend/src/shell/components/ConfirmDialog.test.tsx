import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { ConfirmDialog } from './ConfirmDialog';

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
});
