import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../shared/voicePlayback', async (importOriginal) => {
    const real = await importOriginal<typeof import('../shared/voicePlayback')>();
    return { ...real, fadeOutMemoriesVoices: vi.fn(() => Promise.resolve()) };
});
import { clientLog } from '../../../utils/clientLog';
import { fadeOutMemoriesVoices } from '../shared/voicePlayback';
import { SleepTimer } from './SleepTimer';
import { SLEEP_FADE_MS, useSleepTimer } from './useSleepTimer';

/** The page owns the timer state; the control draws it. */
const Harness: React.FC = () => <SleepTimer timer={useSleepTimer()} />;

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(clientLog).mockClear();
    vi.mocked(fadeOutMemoriesVoices).mockClear();
});
afterEach(() => { vi.useRealTimers(); });

const pick = (name: RegExp) => {
    fireEvent.click(screen.getByRole('button', { name: /Sleep timer|min left/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name }));
};

describe('SleepTimer', () => {
    it('offers off / 15 / 30 / 60 minutes in a menu', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Sleep timer' }));
        const items = screen.getAllByRole('menuitemradio').map((el) => el.textContent);
        expect(items).toEqual(['No timer', 'Stop in 15 minutes', 'Stop in 30 minutes', 'Stop in 60 minutes']);
        expect(screen.getByRole('menuitemradio', { name: 'No timer' })).toHaveAttribute('aria-checked', 'true');
    });

    it('counts down while armed and fades every Memories voice over 10 s at expiry', () => {
        render(<Harness />);
        pick(/15 minutes/);
        expect(screen.getByRole('button', { name: '15 min left' })).toBeInTheDocument();
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_radio', { phase: 'sleep_set', count: 15 });
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'sleep_timer', outcome: 'on' });

        act(() => { vi.advanceTimersByTime(14 * 60_000 + 1_000); });
        // Never a 0: the last minute still reads 1.
        expect(screen.getByRole('button', { name: '1 min left' })).toBeInTheDocument();
        expect(fadeOutMemoriesVoices).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(60_000); });
        expect(SLEEP_FADE_MS).toBe(10_000);
        expect(fadeOutMemoriesVoices).toHaveBeenCalledWith(10_000);
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_radio', { phase: 'sleep_fade' });
        expect(screen.getByRole('button', { name: 'Sleep timer' })).toBeInTheDocument();
    });

    it('can be cancelled before it fires', () => {
        render(<Harness />);
        pick(/30 minutes/);
        pick(/No timer/);
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'sleep_timer', outcome: 'off' });
        act(() => { vi.advanceTimersByTime(31 * 60_000); });
        expect(fadeOutMemoriesVoices).not.toHaveBeenCalled();
    });

    it('re-arming replaces the earlier deadline', () => {
        render(<Harness />);
        pick(/60 minutes/);
        pick(/15 minutes/);
        act(() => { vi.advanceTimersByTime(15 * 60_000); });
        expect(fadeOutMemoriesVoices).toHaveBeenCalledTimes(1);
        act(() => { vi.advanceTimersByTime(60 * 60_000); });
        expect(fadeOutMemoriesVoices).toHaveBeenCalledTimes(1);
    });

    it('logs the timer off when its owner unmounts while armed', () => {
        const { unmount } = render(<Harness />);
        pick(/15 minutes/);
        vi.mocked(clientLog).mockClear();
        unmount();
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'sleep_timer', outcome: 'off' });
    });

    it('logs nothing on unmount when off', () => {
        const { unmount } = render(<Harness />);
        unmount();
        expect(vi.mocked(clientLog)).not.toHaveBeenCalled();
    });
});
