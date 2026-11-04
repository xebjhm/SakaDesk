import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';
import { logDialog, logDialogLoad } from './dialogLog';

describe('dialog breadcrumbs', () => {
    it('log open and close with a reason', () => {
        logDialog('settings', 'open');
        logDialog('settings', 'close', 'escape');
        expect(clientLog).toHaveBeenNthCalledWith(1, 'dialog', { surface: 'settings', phase: 'open' });
        expect(clientLog).toHaveBeenNthCalledWith(2, 'dialog', { surface: 'settings', phase: 'close', reason: 'escape' });
    });

    it('log loads with an optional count', () => {
        logDialogLoad('calendar', 'ok', 3);
        logDialogLoad('diagnostics', 'error');
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'calendar', outcome: 'ok', count: 3 });
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'diagnostics', outcome: 'error' });
    });

    it('log a load failure with a reason code', () => {
        logDialogLoad('settings_ai_test', 'error', undefined, 'auth');
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'settings_ai_test', outcome: 'error', reason: 'auth' });
    });
});
