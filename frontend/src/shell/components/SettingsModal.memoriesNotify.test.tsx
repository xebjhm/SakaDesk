import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import type { AppSettings } from '../../features/messages/MessagesFeature';

const base: AppSettings = {
    output_dir: '/out', auto_sync_enabled: false, sync_interval_minutes: 30, is_configured: true,
};

const SWITCHES = {
    onThisDay: { name: 'On This Day, daily', key: 'memories_notify_on_this_day', def: true },
    birthday: { name: 'Birthdays', key: 'memories_notify_birthday', def: true },
    anniversary: { name: 'Membership anniversaries', key: 'memories_notify_anniversary', def: true },
    recap: { name: 'Year recap', key: 'memories_notify_recap', def: true },
    cards: { name: 'Foil cards', key: 'memories_notify_cards', def: false },
} as const;

function renderModal(appSettings: AppSettings = base, onSaveSettings = vi.fn().mockResolvedValue(true)) {
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

const timeSelect = () => screen.getByRole('combobox', { name: 'Time' }) as HTMLSelectElement;

function stubZone(timeZone: string) {
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...real.call(this), timeZone };
    });
}

describe('SettingsModal Memories notifications', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows the heading and its description', () => {
        renderModal();
        expect(screen.getByText('Memories notifications')).toBeInTheDocument();
        expect(screen.getByText('Not shown while you are in Memories')).toBeInTheDocument();
    });

    it('renders the defaults: four switches on, cards off, 12:00', () => {
        renderModal();
        for (const { name, def } of Object.values(SWITCHES)) {
            expect(screen.getByRole('switch', { name }), name).toHaveAttribute('aria-checked', String(def));
        }
        expect(timeSelect().value).toBe('12:00');
    });

    it('offers 00:00 to 23:00 hourly', () => {
        renderModal();
        const values = Array.from(timeSelect().options).map((o) => o.value);
        expect(values).toHaveLength(24);
        expect(values[0]).toBe('00:00');
        expect(values[7]).toBe('07:00');
        expect(values[23]).toBe('23:00');
        expect(Array.from(timeSelect().options).map((o) => o.textContent)).toEqual(values);
    });

    it.each(Object.entries(SWITCHES))('toggling %s saves exactly its key', async (_id, { name, key, def }) => {
        const save = renderModal();
        fireEvent.click(screen.getByRole('switch', { name }));
        await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        expect(save).toHaveBeenCalledWith({ [key]: !def });
    });

    it('picking 07:00 saves the time alone', async () => {
        const save = renderModal();
        fireEvent.change(timeSelect(), { target: { value: '07:00' } });
        await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        expect(save).toHaveBeenCalledWith({ memories_notify_time: '07:00' });
    });

    it('disables every control while notifications are off', () => {
        const save = renderModal({ ...base, notifications_enabled: false });
        for (const { name } of Object.values(SWITCHES)) {
            const toggle = screen.getByRole('switch', { name });
            expect(toggle, name).toBeDisabled();
            expect(toggle, name).toHaveAttribute('aria-disabled', 'true');
            fireEvent.click(toggle);
        }
        expect(timeSelect()).toBeDisabled();
        expect(timeSelect()).toHaveAttribute('aria-disabled', 'true');
        expect(save).not.toHaveBeenCalled();
    });

    it('enables the controls while notifications are on', () => {
        renderModal({ ...base, notifications_enabled: true });
        for (const { name } of Object.values(SWITCHES)) {
            expect(screen.getByRole('switch', { name }), name).not.toBeDisabled();
        }
        expect(timeSelect()).not.toBeDisabled();
    });

    it('disables the time while On This Day is off', () => {
        renderModal({ ...base, memories_notify_on_this_day: false });
        expect(timeSelect()).toBeDisabled();
        expect(timeSelect()).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('switch', { name: 'Birthdays' })).not.toBeDisabled();
    });

    it('keeps a saved time that is not on the hour as an option', () => {
        renderModal({ ...base, memories_notify_time: '07:30' });
        expect(timeSelect().value).toBe('07:30');
        const values = Array.from(timeSelect().options).map((o) => o.value);
        expect(values).toContain('07:30');
        expect(values).toHaveLength(25);
        expect(values.indexOf('07:30')).toBe(values.indexOf('07:00') + 1);
    });

    it('shows the local equivalent outside Japan', () => {
        stubZone('America/New_York');
        renderModal();
        expect(screen.getByText(/^Japan time \((22|23):00 where you are\)$/)).toBeInTheDocument();
    });

    it('leaves the hint out in Asia/Tokyo', () => {
        stubZone('Asia/Tokyo');
        renderModal();
        expect(screen.queryByText(/^Japan time/)).not.toBeInTheDocument();
    });

    it('reset to defaults includes the six keys', async () => {
        const save = renderModal({
            ...base,
            memories_notify_on_this_day: false,
            memories_notify_birthday: false,
            memories_notify_anniversary: false,
            memories_notify_recap: false,
            memories_notify_cards: true,
            memories_notify_time: '07:30',
        });
        fireEvent.click(screen.getByText('Reset to defaults'));
        const confirm = await screen.findByRole('dialog', { name: 'Reset to defaults' });
        fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }));
        await waitFor(() => expect(save).toHaveBeenCalled());
        expect(save).toHaveBeenCalledWith(expect.objectContaining({
            memories_notify_on_this_day: true,
            memories_notify_birthday: true,
            memories_notify_anniversary: true,
            memories_notify_recap: true,
            memories_notify_cards: false,
            memories_notify_time: '12:00',
        }));
    });

    it('shows the row error when a save fails', async () => {
        renderModal(base, vi.fn().mockResolvedValue(false));
        fireEvent.click(screen.getByRole('switch', { name: 'Foil cards' }));
        expect(await screen.findByText("Couldn't save this setting. Try again.")).toBeInTheDocument();
    });
});
