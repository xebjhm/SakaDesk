import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../utils/clientLog';
import { persisted } from '../core/persistence/persisted';
import { FIRST_SYNC_PREF, celebrateFirstSync, decideFirstSync } from './firstSyncCelebration';

describe('decideFirstSync (decision D11)', () => {
    it('celebrates a first sync where every service finished', () => {
        expect(decideFirstSync({ completed: 2, failed: 0 }, null)).toBe('show');
    });
    it('never celebrates twice', () => {
        expect(decideFirstSync({ completed: 2, failed: 0 }, '2026-11-06T03:00:00Z')).toBe('already_celebrated');
    });
    it('does not celebrate a sync where a service failed or nothing ran', () => {
        expect(decideFirstSync({ completed: 1, failed: 1 }, null)).toBe('sync_failed');
        expect(decideFirstSync({ completed: 0, failed: 0 }, null)).toBe('sync_failed');
    });
});

describe('celebrateFirstSync', () => {
    let stored: Record<string, unknown>;
    beforeEach(() => {
        stored = {};
        vi.spyOn(persisted, 'getPref').mockImplementation(((key: string, fallback: unknown) => (key in stored ? stored[key] : fallback)) as never);
        vi.spyOn(persisted, 'setPref').mockImplementation(((key: string, value: unknown) => { stored[key] = value; }) as never);
    });
    afterEach(() => { vi.restoreAllMocks(); vi.mocked(clientLog).mockClear(); });

    it('records the first celebration, logs it and refuses the second', () => {
        expect(celebrateFirstSync({ completed: 2, failed: 0 })).toBe(true);
        expect(stored[FIRST_SYNC_PREF]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(clientLog).toHaveBeenCalledWith('celebration', { target: 'first_sync', outcome: 'shown' });
        expect(celebrateFirstSync({ completed: 2, failed: 0 })).toBe(false);
        expect(clientLog).toHaveBeenCalledWith('celebration', { target: 'first_sync', outcome: 'skipped', reason: 'already_celebrated' });
    });

    it('logs a skipped celebration after a failed sync and stores nothing', () => {
        expect(celebrateFirstSync({ completed: 0, failed: 2 })).toBe(false);
        expect(stored).toEqual({});
        expect(clientLog).toHaveBeenCalledWith('celebration', { target: 'first_sync', outcome: 'skipped', reason: 'sync_failed' });
    });
});
