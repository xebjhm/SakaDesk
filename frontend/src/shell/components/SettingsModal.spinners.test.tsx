import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import i18n from '../../i18n';
import { server } from '../../__tests__/mocks/server';
import { resetUpgradeStoreForTests, useUpgradeStore } from '../../core/upgrade/upgradeStore';
import { useAppStore } from '../../store/appStore';
import { SettingsModal } from './SettingsModal';
import type { AppSettings } from '../../features/messages/MessagesFeature';

// L7: every Settings spinner is the shared Spinner (static and labelled under reduced
// motion); none is a hand-built `animate-spin` glyph.

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

const base: AppSettings = {
    output_dir: '/out', auto_sync_enabled: true, adaptive_sync_enabled: false, sync_interval_minutes: 10, is_configured: true,
};

function renderModal() {
    render(
        <SettingsModal appSettings={base} outputDirInput="/out" onSelectFolder={() => {}}
            onSaveSettings={vi.fn().mockResolvedValue(true)} onClose={() => {}} activeService="hinatazaka46"
            onVerifyAndFix={() => {}} onDeepResync={() => {}} />,
    );
}

const tab = (name: string) => fireEvent.click(screen.getByRole('button', { name, exact: true } as never));

beforeEach(() => {
    resetUpgradeStoreForTests();
    useAppStore.setState({ selectedServices: [] });
});
afterEach(() => { vi.useRealTimers(); });

describe('SettingsModal spinners', () => {
    it('hand-builds no spinner: every glyph goes through the shared Spinner', () => {
        const source = readFileSync(resolve(__dirname, 'SettingsModal.tsx'), 'utf-8');
        expect(source).not.toMatch(/animate-spin/);
        expect(source).not.toMatch(/\bLoader2\b/);
    });

    it('checking for updates shows the shared, reduced-motion-safe spinner on the button', async () => {
        useUpgradeStore.setState({ checkVersion: () => new Promise(() => {}) });
        renderModal();
        tab(i18n.t('settings.tabUpdates'));
        const check = screen.getByRole('button', { name: i18n.t('settings.checkForUpdates') });
        fireEvent.click(check);
        expect(check).toHaveAttribute('aria-busy', 'true');
        const glyph = check.querySelector('[data-spinner]');
        expect(glyph).toHaveClass('animate-spin', 'motion-reduce:animate-none');
    });

    it('the AI provider settings show a labelled Spinner from 200 ms (not 199) while they load', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        server.use(
            http.get('/api/translation/config', () => new Promise<never>(() => {})),
            http.get('/api/translation/models', () => HttpResponse.json({})),
        );
        useAppStore.setState({ transcriptionEnabled: true });
        renderModal();
        tab(i18n.t('settings.tabAi'));
        const name = i18n.t('common.loading');
        act(() => { vi.advanceTimersByTime(199); });
        expect(screen.queryByRole('status', { name })).toBeNull();
        act(() => { vi.advanceTimersByTime(1); });
        const spinner = screen.getByRole('status', { name });
        // The label is visible (not screen-reader only), and the glyph stands still under reduced motion.
        expect(within(spinner).getByText(name)).not.toHaveClass('sr-only');
        expect(spinner.querySelector('svg')).toHaveClass('animate-spin', 'motion-reduce:animate-none');
    });

    it('test connection without a key says why it is unavailable', async () => {
        server.use(
            http.get('/api/translation/config', () => HttpResponse.json({ provider: 'gemini', model: null, has_api_key: false })),
            http.get('/api/translation/models', () => HttpResponse.json({})),
        );
        useAppStore.setState({ transcriptionEnabled: true });
        renderModal();
        tab(i18n.t('settings.tabAi'));
        const button = await screen.findByRole('button', { name: i18n.t('translation.settings.testConnection') });
        expect(button).toHaveAttribute('aria-disabled', 'true');
        expect(button).toHaveAccessibleDescription(i18n.t('translation.settings.testErrorNoKey'));
    });
});
