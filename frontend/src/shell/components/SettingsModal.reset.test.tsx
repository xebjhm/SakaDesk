import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import type { AppSettings } from '../../features/messages/MessagesFeature';

const settings: AppSettings = {
    output_dir: '/out', auto_sync_enabled: false, sync_interval_minutes: 30, is_configured: true,
    incoming_call_enabled: false,
};

function renderModal(onSaveSettings = vi.fn().mockResolvedValue(true), appSettings = settings) {
    render(
        <SettingsModal
            appSettings={appSettings}
            outputDirInput="/out"
            setOutputDirInput={() => {}}
            onSaveSettings={onSaveSettings}
            onClose={() => {}}
            activeService="hinatazaka46"
            onVerifyAndFix={() => {}}
            onDeepResync={() => {}}
        />,
    );
    return onSaveSettings;
}

describe('SettingsModal reset to defaults', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
        vi.spyOn(window, 'confirm').mockReturnValue(true);
    });

    it('turns the incoming call setting back on', async () => {
        const save = renderModal();
        fireEvent.click(screen.getByText('Reset to defaults'));
        await waitFor(() => expect(save).toHaveBeenCalled());
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ incoming_call_enabled: true, auto_sync_enabled: true }));
    });

    it('a loaded setting without the field reads as on and toggles off', () => {
        const { incoming_call_enabled: _omit, ...withoutField } = settings;
        void _omit;
        const save = renderModal(undefined, withoutField);
        const toggle = screen.getByRole('switch', { name: 'Incoming calls' });
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(toggle);
        expect(save).toHaveBeenCalledWith({ incoming_call_enabled: false });
    });
});
