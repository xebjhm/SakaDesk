import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import type { AppSettings } from '../../features/messages/MessagesFeature';
import en from '../../i18n/locales/en.json';
import ja from '../../i18n/locales/ja.json';
import zhCN from '../../i18n/locales/zh-CN.json';
import zhTW from '../../i18n/locales/zh-TW.json';
import yue from '../../i18n/locales/yue.json';

const base: AppSettings = {
    output_dir: '/out', auto_sync_enabled: false, sync_interval_minutes: 30, is_configured: true,
};

function renderModal(appSettings: AppSettings = base, onSaveSettings = vi.fn().mockResolvedValue(true)) {
    render(
        <SettingsModal
            appSettings={appSettings}
            outputDirInput="/out"
            onSelectFolder={() => {}}
            onSaveSettings={onSaveSettings}
            onClose={() => {}}
            activeService="hinatazaka46"
            onVerifyAndFix={() => {}}
            onDeepResync={() => {}}
        />,
    );
    return onSaveSettings;
}

describe('SettingsModal notification toggles', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    });

    it('notifications default on and toggle off', () => {
        const save = renderModal();
        const toggle = screen.getByRole('switch', { name: 'Notifications' });
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(toggle);
        expect(save).toHaveBeenCalledWith({ notifications_enabled: false });
    });

    it('hide content defaults off and toggles on', () => {
        const save = renderModal();
        const toggle = screen.getByRole('switch', { name: 'Hide message content in notifications' });
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(toggle).not.toBeDisabled();
        fireEvent.click(toggle);
        expect(save).toHaveBeenCalledWith({ notifications_hide_content: true });
    });

    it('hide content is disabled when notifications are off', () => {
        const save = renderModal({ ...base, notifications_enabled: false });
        const toggle = screen.getByRole('switch', { name: 'Hide message content in notifications' });
        expect(toggle).toBeDisabled();
        expect(toggle).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(toggle);
        expect(save).not.toHaveBeenCalled();
    });

    it('reset to defaults includes both notification settings', async () => {
        const save = renderModal({ ...base, notifications_enabled: false, notifications_hide_content: true });
        fireEvent.click(screen.getByText('Reset to defaults'));
        const confirm = await screen.findByRole('dialog', { name: 'Reset to defaults' });
        fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }));
        await waitFor(() => expect(save).toHaveBeenCalled());
        expect(save).toHaveBeenCalledWith(
            expect.objectContaining({ notifications_enabled: true, notifications_hide_content: false }),
        );
    });
});

describe('notification setting strings', () => {
    const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as Record<string, unknown>;
    it.each(Object.keys(locales))('%s has all four keys', (code) => {
        const settings = (locales[code] as Record<string, Record<string, string>>).settings;
        for (const key of ['notifications', 'notificationsDesc', 'notificationsHideContent', 'notificationsHideContentDesc']) {
            expect(settings[key], key).toBeTruthy();
        }
    });
});
