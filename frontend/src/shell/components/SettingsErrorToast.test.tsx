import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { clientLog } from '../../utils/clientLog';
import { popDialog, pushDialog, resetDialogStack } from '../../design/dialog/dialogStack';
import { SettingsErrorToast } from './SettingsErrorToast';

vi.mock('../../utils/clientLog', async (orig) => ({ ...(await orig<typeof import('../../utils/clientLog')>()), clientLog: vi.fn() }));

describe('SettingsErrorToast', () => {
    afterEach(() => { resetDialogStack(); vi.mocked(clientLog).mockClear(); });

    it('waits while a dialog is open, logs one deferral, and shows on close', () => {
        let entry!: ReturnType<typeof pushDialog>;
        act(() => { entry = pushDialog({ node: () => null, dismissible: true }); });
        const { rerender } = render(<SettingsErrorToast errorKey="settings.saveFailed" onDebug={vi.fn()} onClose={vi.fn()} />);
        rerender(<SettingsErrorToast errorKey="settings.saveFailed" onDebug={vi.fn()} onClose={vi.fn()} />);
        expect(screen.queryByTestId('settings-error-toast')).toBeNull();
        expect(vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'dialog')).toHaveLength(1);
        act(() => popDialog(entry));
        expect(screen.getByTestId('settings-error-toast')).toBeInTheDocument();
    });

    it('logs a second deferral when another dialog opens over a toast that was already showing', () => {
        const props = { errorKey: 'settings.saveFailed', onDebug: vi.fn(), onClose: vi.fn() };
        render(<SettingsErrorToast {...props} />);
        expect(screen.getByTestId('settings-error-toast')).toBeInTheDocument();
        expect(vi.mocked(clientLog)).not.toHaveBeenCalled();
        let entry!: ReturnType<typeof pushDialog>;
        act(() => { entry = pushDialog({ node: () => null, dismissible: true }); });
        expect(screen.queryByTestId('settings-error-toast')).toBeNull();
        expect(vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'dialog')).toHaveLength(1);
        act(() => popDialog(entry));
        act(() => { entry = pushDialog({ node: () => null, dismissible: true }); });
        expect(vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'dialog')).toHaveLength(2);
        expect(vi.mocked(clientLog)).toHaveBeenLastCalledWith('dialog', { target: 'settings_error_toast', outcome: 'suppressed' });
    });

    it('renders nothing without an error', () => {
        render(<SettingsErrorToast errorKey={null} onDebug={vi.fn()} onClose={vi.fn()} />);
        expect(screen.queryByTestId('settings-error-toast')).toBeNull();
    });
});
