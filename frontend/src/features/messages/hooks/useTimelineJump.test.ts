import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { Message } from '../../../types';
import { toLocalDateStr } from '../../../utils/dateFormatters';
import { useTimelineJump, MAX_CORRECTIONS } from './useTimelineJump';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

const msg = (id: number, ts: string): Message =>
    ({ id, timestamp: ts, type: 'text', is_favorite: false, content: `m${id}` });
const messages = [msg(1, '2022-01-15T01:00:00Z'), msg(2, '2024-03-15T01:00:00Z'), msg(3, '2026-11-03T01:00:00Z')];

interface SetupOpts {
    unread?: (id: number) => boolean;
    /** Called with the 1-based count of nextFrame calls, before it resolves. */
    onFrame?: (n: number) => void;
    ref?: { current: VirtuosoHandle | null };
}

function setup(measures: Array<number | null>, opts: SetupOpts = {}) {
    const scrollToIndex = vi.fn();
    const ref = opts.ref ?? { current: { scrollToIndex } as unknown as VirtuosoHandle };
    const onLanded = vi.fn();
    const queue = [...measures];
    const measure = vi.fn(() => (queue.length > 1 ? queue.shift()! : queue[0]));
    let frames = 0;
    const nextFrame = () => { frames += 1; opts.onFrame?.(frames); return Promise.resolve(); };
    const hook = renderHook(({ list, resetKey }: { list: readonly Message[]; resetKey?: unknown }) => useTimelineJump({
        virtuosoRef: ref,
        messages: list,
        isUnread: opts.unread ?? (() => false),
        onLanded,
        resetKey,
        deps: { nextFrame, measure, now: () => 0 },
    }), { initialProps: { list: messages as readonly Message[], resetKey: 'a' as unknown } });
    return { jumpTo: hook.result.current, scrollToIndex, onLanded, measure, ...hook };
}

beforeEach(() => vi.mocked(clientLog).mockClear());

describe('useTimelineJump', () => {
    it('jumps instantly, verifies, highlights and logs a landing', async () => {
        const { jumpTo, scrollToIndex, onLanded } = setup([3]);
        await expect(jumpTo({ kind: 'message', id: 2 })).resolves.toBe('landed');
        expect(scrollToIndex).toHaveBeenCalledTimes(1);
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 1, align: 'start', behavior: 'auto' });
        expect(onLanded).toHaveBeenCalledWith(2);
        expect(clientLog).toHaveBeenCalledWith('timeline_jump',
            { target: 'message', index: 1, corrections: 0, outcome: 'landed', jump_ms: 0 });
    });

    it('waits for the row to render before measuring', async () => {
        const { jumpTo, measure } = setup([null, null, 0]);
        await expect(jumpTo({ kind: 'message', id: 2 })).resolves.toBe('landed');
        expect(measure.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('corrects an off landing and then lands', async () => {
        // First render measures 40, the settled re-measure is still 40 → one correction → 0.
        const { jumpTo, scrollToIndex } = setup([40, 40, 0]);
        await expect(jumpTo({ kind: 'message', id: 2 })).resolves.toBe('landed');
        expect(scrollToIndex).toHaveBeenCalledTimes(2);
        expect(clientLog).toHaveBeenCalledWith('timeline_jump', expect.objectContaining({ corrections: 1, outcome: 'landed' }));
    });

    it(`gives up after ${MAX_CORRECTIONS} corrections and does not highlight`, async () => {
        const { jumpTo, scrollToIndex, onLanded } = setup([40]);
        await expect(jumpTo({ kind: 'message', id: 2 })).resolves.toBe('gave_up');
        expect(scrollToIndex).toHaveBeenCalledTimes(1 + MAX_CORRECTIONS);
        expect(onLanded).not.toHaveBeenCalled();
    });

    it('gives up when the row never renders', async () => {
        const { jumpTo } = setup([null]);
        await expect(jumpTo({ kind: 'message', id: 2 })).resolves.toBe('gave_up');
    });

    it('reports not_found without scrolling', async () => {
        const { jumpTo, scrollToIndex } = setup([0]);
        await expect(jumpTo({ kind: 'message', id: 99 })).resolves.toBe('not_found');
        expect(scrollToIndex).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledWith('timeline_jump', expect.objectContaining({ outcome: 'not_found', index: -1 }));
    });

    it('first unread is centred and not highlighted', async () => {
        const { jumpTo, scrollToIndex, onLanded } = setup([0], { unread: id => id >= 2 });
        await expect(jumpTo({ kind: 'firstUnread' })).resolves.toBe('landed');
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 1, align: 'center', behavior: 'auto' });
        expect(onLanded).not.toHaveBeenCalled();
    });

    it('bottom scrolls without measuring', async () => {
        const { jumpTo, scrollToIndex, measure } = setup([0]);
        await expect(jumpTo({ kind: 'bottom' })).resolves.toBe('landed');
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 2, align: 'end', behavior: 'auto' });
        expect(measure).not.toHaveBeenCalled();
    });

    it('a newer jump cancels an older one still settling', async () => {
        const { jumpTo } = setup([null, null, null, 0]);
        const first = jumpTo({ kind: 'message', id: 1 });
        const second = jumpTo({ kind: 'message', id: 3 });
        await expect(first).resolves.toBe('cancelled');
        await expect(second).resolves.toBe('landed');
    });

    it('never uses smooth scrolling', async () => {
        const { jumpTo, scrollToIndex } = setup([40, 40, 0], { unread: id => id >= 2 });
        await jumpTo({ kind: 'date', date: toLocalDateStr(messages[1].timestamp) });
        await jumpTo({ kind: 'bottom' });
        await jumpTo({ kind: 'firstUnread' });
        await jumpTo({ kind: 'message', id: 1 });
        expect(scrollToIndex.mock.calls.length).toBeGreaterThanOrEqual(4);
        for (const [arg] of scrollToIndex.mock.calls) expect(arg.behavior).toBe('auto');
    });

    it('a date jump to an existing day lands and highlights', async () => {
        const { jumpTo, scrollToIndex, onLanded } = setup([0]);
        await expect(jumpTo({ kind: 'date', date: toLocalDateStr(messages[2].timestamp) })).resolves.toBe('landed');
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 2, align: 'start', behavior: 'auto' });
        expect(onLanded).toHaveBeenCalledWith(3);
    });

    it('a date jump to a missing day is not_found', async () => {
        const { jumpTo, scrollToIndex } = setup([0]);
        await expect(jumpTo({ kind: 'date', date: '2099-01-01' })).resolves.toBe('not_found');
        expect(scrollToIndex).not.toHaveBeenCalled();
    });

    it('top scrolls to the first row without measuring', async () => {
        const { jumpTo, scrollToIndex, measure } = setup([0]);
        await expect(jumpTo({ kind: 'top' })).resolves.toBe('landed');
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 0, align: 'start', behavior: 'auto' });
        expect(measure).not.toHaveBeenCalled();
    });

    it('a message jump with align center passes it to scrollToIndex', async () => {
        const { jumpTo, scrollToIndex } = setup([0]);
        await jumpTo({ kind: 'message', id: 2, align: 'center' });
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 1, align: 'center', behavior: 'auto' });
    });

    it('cancels when a newer jump starts during the settle frames', async () => {
        // Frame 1 renders the row; frames 2-3 are the settle wait. Cancel on frame 2.
        const s = setup([0], { onFrame: n => { if (n === 2) void s.jumpTo({ kind: 'bottom' }); } });
        await expect(s.jumpTo({ kind: 'message', id: 2 })).resolves.toBe('cancelled');
        expect(s.onLanded).not.toHaveBeenCalled();
    });

    it('cancels a waiting jump when the hook unmounts', async () => {
        let unmount: () => void = () => {};
        const s = setup([null], { onFrame: n => { if (n === 2) unmount(); } });
        unmount = s.unmount;
        await expect(s.jumpTo({ kind: 'message', id: 2 })).resolves.toBe('cancelled');
        expect(clientLog).toHaveBeenCalledWith('timeline_jump', expect.objectContaining({ outcome: 'cancelled' }));
    });

    it('corrects to the target\'s current index when rows were inserted before it', async () => {
        let rerender: ReturnType<typeof setup>['rerender'] = () => {};
        const inserted = [msg(0, '2020-01-01T01:00:00Z'), ...messages];
        const s = setup([40, 40, 0], { onFrame: n => { if (n === 1) rerender({ list: inserted, resetKey: 'a' }); } });
        rerender = s.rerender;
        await expect(s.jumpTo({ kind: 'message', id: 2 })).resolves.toBe('landed');
        expect(s.scrollToIndex).toHaveBeenNthCalledWith(1, { index: 1, align: 'start', behavior: 'auto' });
        expect(s.scrollToIndex).toHaveBeenNthCalledWith(2, { index: 2, align: 'start', behavior: 'auto' });
        expect(clientLog).toHaveBeenCalledWith('timeline_jump',
            expect.objectContaining({ index: 2, corrections: 1, outcome: 'landed' }));
    });

    it('cancels without a correction scroll when the target row disappears', async () => {
        let rerender: ReturnType<typeof setup>['rerender'] = () => {};
        const s = setup([40], { onFrame: n => { if (n === 1) rerender({ list: [messages[0], messages[2]], resetKey: 'a' }); } });
        rerender = s.rerender;
        await expect(s.jumpTo({ kind: 'message', id: 2 })).resolves.toBe('cancelled');
        expect(s.scrollToIndex).toHaveBeenCalledTimes(1);
        expect(s.onLanded).not.toHaveBeenCalled();
    });

    it('waits again when the row vanishes after settling, and highlights only after the final measure', async () => {
        const { jumpTo, onLanded, measure } = setup([0, null, 0, 0]);
        await expect(jumpTo({ kind: 'message', id: 2 })).resolves.toBe('landed');
        expect(measure).toHaveBeenCalledTimes(4);
        expect(onLanded).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('timeline_jump', expect.objectContaining({ corrections: 0, outcome: 'landed' }));
    });

    it('gives up, bounded, when the row vanishes after every settle', async () => {
        const alternating = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 0 : null));
        const { jumpTo, onLanded, measure } = setup(alternating);
        await expect(jumpTo({ kind: 'message', id: 2 })).resolves.toBe('gave_up');
        expect(onLanded).not.toHaveBeenCalled();
        expect(measure.mock.calls.length).toBeLessThanOrEqual(2 * (MAX_CORRECTIONS + 1));
    });

    it('gives up without counting a correction when the list handle is gone before a correction', async () => {
        const ref: { current: VirtuosoHandle | null } = { current: null };
        const s = setup([40], { ref, onFrame: n => { if (n === 1) ref.current = null; } });
        ref.current = { scrollToIndex: s.scrollToIndex } as unknown as VirtuosoHandle;
        await expect(s.jumpTo({ kind: 'message', id: 2 })).resolves.toBe('gave_up');
        expect(s.scrollToIndex).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('timeline_jump', expect.objectContaining({ corrections: 0, outcome: 'gave_up' }));
    });

    it('cancels at once when the row is removed while waiting for it to render', async () => {
        let rerender: ReturnType<typeof setup>['rerender'] = () => {};
        const s = setup([null], { onFrame: n => { if (n === 2) rerender({ list: [messages[0], messages[2]], resetKey: 'a' }); } });
        rerender = s.rerender;
        await expect(s.jumpTo({ kind: 'message', id: 2 })).resolves.toBe('cancelled');
        expect(s.measure.mock.calls.length).toBeLessThan(10);
        expect(s.scrollToIndex).toHaveBeenCalledTimes(1);
    });

    it('cancels when the row is removed after settling', async () => {
        // First measure renders (0), the settled re-measure finds nothing; the row left messages on frame 2.
        let rerender: ReturnType<typeof setup>['rerender'] = () => {};
        const s = setup([0, null], { onFrame: n => { if (n === 2) rerender({ list: [messages[0], messages[2]], resetKey: 'a' }); } });
        rerender = s.rerender;
        await expect(s.jumpTo({ kind: 'message', id: 2 })).resolves.toBe('cancelled');
        expect(s.onLanded).not.toHaveBeenCalled();
        expect(s.scrollToIndex).toHaveBeenCalledTimes(1);
    });

    it('cancels an in-flight jump when resetKey changes (room switch)', async () => {
        let rerender: ReturnType<typeof setup>['rerender'] = () => {};
        const s = setup([null], { onFrame: n => { if (n === 2) rerender({ list: messages, resetKey: 'b' }); } });
        rerender = s.rerender;
        await expect(s.jumpTo({ kind: 'message', id: 2 })).resolves.toBe('cancelled');
        expect(s.onLanded).not.toHaveBeenCalled();
    });
});
