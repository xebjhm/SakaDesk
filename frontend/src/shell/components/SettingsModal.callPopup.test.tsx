import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import type { AppSettings } from '../../features/messages/MessagesFeature';

const settings: AppSettings = {
    output_dir: '/out', auto_sync_enabled: false, sync_interval_minutes: 30, is_configured: true,
    incoming_call_enabled: true,
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

describe('SettingsModal background call popup toggle', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    });

    it('reads as on when the field is missing and toggles off', () => {
        const save = renderModal();
        const toggle = screen.getByRole('switch', { name: 'Background call popup' });
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(toggle);
        expect(save).toHaveBeenCalledWith({ call_popup_enabled: false });
    });

    it('is unchecked when disabled and toggles back on', () => {
        const save = renderModal(undefined, { ...settings, call_popup_enabled: false });
        const toggle = screen.getByRole('switch', { name: 'Background call popup' });
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(toggle);
        expect(save).toHaveBeenCalledWith({ call_popup_enabled: true });
    });

    it('renders the description', () => {
        renderModal();
        expect(screen.getByText(/rings in a small window at the bottom right/)).toBeInTheDocument();
    });

    it('sits immediately after the incoming calls switch', () => {
        renderModal();
        const switches = screen.getAllByRole('switch');
        const incoming = switches.findIndex((s) => s.getAttribute('aria-label') === 'Incoming calls');
        expect(incoming).toBeGreaterThanOrEqual(0);
        expect(switches[incoming + 1]).toHaveAttribute('aria-label', 'Background call popup');
    });
});
