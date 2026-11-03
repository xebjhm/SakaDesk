import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import type { AppSettings } from '../../features/messages/MessagesFeature';

const settings: AppSettings = {
    output_dir: '/out', auto_sync_enabled: false, sync_interval_minutes: 30, is_configured: true,
    incoming_call_enabled: false,
    close_to_tray: false,
    autostart: true,
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

    it('turns the background call popup back on', async () => {
        const save = renderModal(undefined, { ...settings, call_popup_enabled: false });
        fireEvent.click(screen.getByText('Reset to defaults'));
        await waitFor(() => expect(save).toHaveBeenCalled());
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ call_popup_enabled: true }));
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

    it('restores the tray settings: close to tray on, autostart off', async () => {
        const save = renderModal();
        fireEvent.click(screen.getByText('Reset to defaults'));
        await waitFor(() => expect(save).toHaveBeenCalled());
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ close_to_tray: true, autostart: false }));
    });

    it('shows the tray switches from the saved values and toggles them', () => {
        const save = renderModal();
        const closeToTray = screen.getByRole('switch', { name: 'Keep running in the tray when closed' });
        const autostart = screen.getByRole('switch', { name: 'Start with Windows' });
        expect(closeToTray).toHaveAttribute('aria-checked', 'false');
        expect(autostart).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(closeToTray);
        expect(save).toHaveBeenCalledWith({ close_to_tray: true });
        fireEvent.click(autostart);
        expect(save).toHaveBeenCalledWith({ autostart: false });
    });

    it('a loaded setting without the tray fields reads as close-to-tray on, autostart off', () => {
        const { close_to_tray: _c, autostart: _a, ...withoutFields } = settings;
        void _c;
        void _a;
        renderModal(undefined, withoutFields);
        expect(screen.getByRole('switch', { name: 'Keep running in the tray when closed' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('switch', { name: 'Start with Windows' })).toHaveAttribute('aria-checked', 'false');
    });
});
