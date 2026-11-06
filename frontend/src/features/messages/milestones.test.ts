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

    it('shows one card per open when messages and days both have a new milestone (streak arrives later)', () => {
        stored[MILESTONES_PREF] = { 'h|room': { messages: [1000], days: [] } };
        const { result, rerender, unmount } = renderHook((p) => useMilestone(p), { initialProps: { roomKey: 'h|room', totalMessages: 5001 as number | null, streakDays: null as number | null } });
        expect(result.current).toEqual({ kind: 'messages', value: 5000 });
        rerender({ roomKey: 'h|room', totalMessages: 5001, streakDays: 128 });
        expect(result.current).toEqual({ kind: 'messages', value: 5000 });
        const shownLogs = vi.mocked(clientLog).mock.calls.filter((c) => (c[1] as { outcome?: string }).outcome === 'shown');
        expect(shownLogs).toHaveLength(1);
        // The days milestone stays unrecorded, so a later open celebrates it.
        expect((stored[MILESTONES_PREF] as MilestoneStore)['h|room'].days).toEqual([]);
        unmount();
        const next = renderHook(() => useMilestone({ roomKey: 'h|room', totalMessages: 5001, streakDays: 128 }));
        expect(next.result.current).toEqual({ kind: 'days', value: 100 });
    });

    it('does not seed an empty room, so the first open with real data seeds silently', () => {
        const empty = renderHook(() => useMilestone({ roomKey: 'h|room', totalMessages: 0, streakDays: null }));
        expect(empty.result.current).toBeNull();
        expect(persisted.setPref).not.toHaveBeenCalled();
        empty.unmount();
        const synced = renderHook(() => useMilestone({ roomKey: 'h|room', totalMessages: 12000, streakDays: null }));
        expect(synced.result.current).toBeNull();
        expect((stored[MILESTONES_PREF] as MilestoneStore)['h|room'].messages).toEqual([1000, 5000, 10000]);
    });

    it('does not write the store when nothing was seeded or shown', () => {
        stored[MILESTONES_PREF] = { 'h|room': { messages: [1000], days: [100] } };
        const { result } = renderHook(() => useMilestone({ roomKey: 'h|room', totalMessages: 2000, streakDays: 128 }));
        expect(result.current).toBeNull();
        expect(persisted.setPref).not.toHaveBeenCalled();
    });

    it('does nothing for a group chat (no room key) or before the counts are known', () => {
        const { result } = renderHook(() => useMilestone({ roomKey: null, totalMessages: 20000, streakDays: 800 }));
        expect(result.current).toBeNull();
        renderHook(() => useMilestone({ roomKey: 'h|room', totalMessages: null, streakDays: null }));
        expect(persisted.setPref).not.toHaveBeenCalled();
    });
});
