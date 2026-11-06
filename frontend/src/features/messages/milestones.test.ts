import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';
import { persisted } from '../../core/persistence/persisted';
import {
    MILESTONES_PREF, decideMilestone, reachedDayMilestones, reachedMessageMilestones, useMilestone,
    type MilestoneStore,
} from './milestones';

describe('reached milestones (spec §9)', () => {
    it('messages: 1,000 / 5,000 / 10,000', () => {
        expect(reachedMessageMilestones(999)).toEqual([]);
        expect(reachedMessageMilestones(5000)).toEqual([1000, 5000]);
        expect(reachedMessageMilestones(25000)).toEqual([1000, 5000, 10000]);
    });
    it('days: day 100, then every full year', () => {
        expect(reachedDayMilestones(99)).toEqual([]);
        expect(reachedDayMilestones(128)).toEqual([100]);
        expect(reachedDayMilestones(800)).toEqual([100, 365, 730]);
    });
});

describe('decideMilestone (decision D10)', () => {
    it('seeds a kind silently the first time a room is seen', () => {
        const r = decideMilestone('h|room', { messages: [1000, 5000], days: [100] }, {});
        expect(r.show).toBeNull();
        expect(r.seeded).toEqual(['messages', 'days']);
        expect(r.next).toEqual({ 'h|room': { messages: [1000, 5000], days: [100] } });
    });

    it('shows the highest new messages milestone first and records the lower ones with it', () => {
        const store: MilestoneStore = { 'h|room': { messages: [], days: [] } };
        const r = decideMilestone('h|room', { messages: [1000, 5000], days: [100] }, store);
        expect(r.show).toEqual({ kind: 'messages', value: 5000 });
        expect(r.next['h|room']).toEqual({ messages: [1000, 5000], days: [] });
        const again = decideMilestone('h|room', { messages: [1000, 5000], days: [100] }, r.next);
        expect(again.show).toEqual({ kind: 'days', value: 100 });
        expect(decideMilestone('h|room', { messages: [1000, 5000], days: [100] }, again.next).show).toBeNull();
    });

    it('skips a kind whose data is not known yet', () => {
        const r = decideMilestone('h|room', { messages: null, days: [100] }, { 'h|room': { days: [] } });
        expect(r.show).toEqual({ kind: 'days', value: 100 });
        expect(r.next['h|room'].messages).toBeUndefined();
    });
});

describe('useMilestone', () => {
    let stored: Record<string, unknown>;
    beforeEach(() => {
        stored = {};
        vi.spyOn(persisted, 'getPref').mockImplementation(((key: string, fallback: unknown) => (key in stored ? stored[key] : fallback)) as never);
        vi.spyOn(persisted, 'setPref').mockImplementation(((key: string, value: unknown) => { stored[key] = value; }) as never);
    });
    afterEach(() => { vi.restoreAllMocks(); vi.mocked(clientLog).mockClear(); });

    it('seeds on the first open, celebrates a milestone reached since then on the next open, once', () => {
        const first = renderHook((p) => useMilestone(p), { initialProps: { roomKey: 'h|room', totalMessages: 4990, streakDays: 99 as number | null } });
        expect(first.result.current).toBeNull();
        expect(clientLog).toHaveBeenCalledWith('celebration', { target: 'milestone_messages', outcome: 'seeded' });
        // Messages arriving while the chat is open wait for the next open.
        first.rerender({ roomKey: 'h|room', totalMessages: 5001, streakDays: 99 });
        expect(first.result.current).toBeNull();
        first.unmount();

        const next = renderHook(() => useMilestone({ roomKey: 'h|room', totalMessages: 5001, streakDays: 99 }));
        expect(next.result.current).toEqual({ kind: 'messages', value: 5000 });
        expect(clientLog).toHaveBeenCalledWith('celebration', { target: 'milestone_messages', outcome: 'shown', count: 5000 });
        expect((stored[MILESTONES_PREF] as MilestoneStore)['h|room'].messages).toEqual([1000, 5000]);
        next.unmount();

        const later = renderHook(() => useMilestone({ roomKey: 'h|room', totalMessages: 5001, streakDays: 99 }));
        expect(later.result.current).toBeNull();
    });

    it('does nothing for a group chat (no room key) or before the counts are known', () => {
        const { result } = renderHook(() => useMilestone({ roomKey: null, totalMessages: 20000, streakDays: 800 }));
        expect(result.current).toBeNull();
        renderHook(() => useMilestone({ roomKey: 'h|room', totalMessages: null, streakDays: null }));
        expect(persisted.setPref).not.toHaveBeenCalled();
    });
});
