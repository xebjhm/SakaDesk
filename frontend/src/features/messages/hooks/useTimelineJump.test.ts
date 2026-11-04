import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { Message } from '../../../types';
import { toLocalDateStr } from '../../../utils/dateFormatters';
import { buildTimeline } from '../timeline/buildTimeline';
import type { Letter } from '../letters';
import { useTimelineJump, estimateTravel, MAX_CORRECTIONS, GLIDE_LEAD, STILLNESS_MS } from './useTimelineJump';

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
    /**
     * Animated path: a fake scroller, the visible range, and a clock that advances 16 ms per
     * frame. With `targetTop` the list is simulated: scrollToIndex moves the scroller to
     * targetTop + offset, and the target measures (targetTop - scrollTop) while it is on screen.
     */
    glide?: { scroller: FakeScroller; range?: { startIndex: number; endIndex: number } | null; reduced?: boolean; targetTop?: number };
    /** Initial message list (default: the three-message `messages`). */
    list?: readonly Message[];
    /** Letters merged into the timeline (default: none). */
    letters?: readonly Letter[];
}

interface FakeScroller { scrollTop: number; scrollHeight: number; clientHeight: number }
const fakeScroller = (scrollTop = 5000): FakeScroller => ({ scrollTop, scrollHeight: 100000, clientHeight: 600 });
const LEAD = Math.round(600 * GLIDE_LEAD);

function setup(measures: Array<number | null>, opts: SetupOpts = {}) {
    const glide = opts.glide;
    const scrollToIndex = vi.fn((loc: { behavior?: string; offset?: number }) => {
        if (glide?.targetTop !== undefined) glide.scroller.scrollTop = glide.targetTop + (loc.offset ?? 0);
    });
    const ref = opts.ref ?? { current: { scrollToIndex } as unknown as VirtuosoHandle };
    const onLanded = vi.fn();
    const queue = [...measures];
    const measure = vi.fn((): number | null => {
        if (glide?.targetTop !== undefined) {
            const sc = glide.scroller;
            const d = glide.targetTop - sc.scrollTop;
            if (d <= -50 || d >= sc.clientHeight) return null;
            // As landingError does: a row below its aligned spot is as close as it gets at the bottom.
            return d > 0 && sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 1 ? 0 : d;
        }
        return queue.length > 1 ? queue.shift()! : queue[0];
    });
    let frames = 0;
    const nextFrame = () => { frames += 1; opts.onFrame?.(frames); return Promise.resolve(); };
    const hook = renderHook(({ list, resetKey }: { list: readonly Message[]; resetKey?: unknown }) => useTimelineJump({
        virtuosoRef: ref,
        timeline: buildTimeline(list, opts.letters ?? []),
        isUnread: opts.unread ?? (() => false),
        onLanded,
        resetKey,
        getScroller: glide ? () => glide.scroller as HTMLElement : undefined,
        visibleRange: glide && glide.range !== undefined ? () => glide.range : undefined,
        deps: { nextFrame, measure, now: glide ? () => frames * 16 : () => 0, reducedMotion: () => glide?.reduced ?? false },
    }), { initialProps: { list: opts.list ?? (messages as readonly Message[]), resetKey: 'a' as unknown } });
    return { jumpTo: hook.result.current, scrollToIndex, onLanded, measure, ...hook };
}

beforeEach(() => vi.mocked(clientLog).mockClear());

/** The `path` field of the single timeline_jump breadcrumb. */
function pathLogged(): unknown {
    expect(clientLog).toHaveBeenCalledTimes(1);
    return (vi.mocked(clientLog).mock.calls[0][1] as { path?: string }).path;
}

describe('useTimelineJump', () => {
    it('jumps instantly, verifies, highlights and logs a landing', async () => {
        const { jumpTo, scrollToIndex, onLanded } = setup([3]);
        await expect(jumpTo({ kind: 'message', id: 2 })).resolves.toBe('landed');
        expect(scrollToIndex).toHaveBeenCalledTimes(1);
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 1, align: 'start', behavior: 'auto' });
        expect(onLanded).toHaveBeenCalledWith('msg-2');
        expect(clientLog).toHaveBeenCalledWith('timeline_jump',
            { target: 'message', index: 1, corrections: 0, outcome: 'landed', path: 'instant', jump_ms: 0 });
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
        expect(clientLog).toHaveBeenCalledWith('timeline_jump', expect.objectContaining({ outcome: 'not_found', index: -1, path: 'none' }));
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
        expect(onLanded).toHaveBeenCalledWith('msg-3');
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

    it('jumps to a letter by its row key, never to a message with the same id', async () => {
        const letters: Letter[] = [{ id: 2, text: '', created_at: '2024-03-15T02:00:00Z', image_url: null, width: null, height: null }];
        const { jumpTo, scrollToIndex, onLanded } = setup([0], { letters });
        // Rows: msg-1, msg-2, letter-2, msg-3
        await expect(jumpTo({ kind: 'letter', id: 2 })).resolves.toBe('landed');
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 2, align: 'start', behavior: 'auto' });
        expect(onLanded).toHaveBeenCalledWith('letter-2');
        expect(clientLog).toHaveBeenCalledWith('timeline_jump', expect.objectContaining({ target: 'letter', outcome: 'landed' }));
    });

    it('measures by row key', async () => {
        const { jumpTo, measure } = setup([0]);
        await jumpTo({ kind: 'message', id: 3 });
        expect(measure).toHaveBeenCalledWith('msg-3', 'start');
    });
});

describe('useTimelineJump glide', () => {
    // 200 rows; ten of them (60 px each on a 600 px viewport) are on screen.
    const many = Array.from({ length: 200 }, (_, i) => msg(i + 1, new Date(Date.UTC(2024, 0, 1) + i * 3_600_000).toISOString()));
    const below = { startIndex: 0, endIndex: 9 }; // far above row 150 (id 151)
    const above = { startIndex: 150, endIndex: 159 }; // far below row 0 (id 1)

    it('far downward: lands a lead short above the target, then glides down into place', async () => {
        const scroller = fakeScroller();
        const tops: number[] = [];
        const s = setup([], { list: many, glide: { scroller, range: below, targetTop: 20000 }, onFrame: () => tops.push(scroller.scrollTop) });
        await expect(s.jumpTo({ kind: 'message', id: 151 })).resolves.toBe('landed');
        expect(s.scrollToIndex).toHaveBeenCalledTimes(1);
        expect(s.scrollToIndex).toHaveBeenCalledWith({ index: 150, align: 'start', behavior: 'auto', offset: -LEAD });
        expect(tops[0]).toBe(20000 - LEAD);
        expect(scroller.scrollTop).toBe(20000);
        expect(s.onLanded).toHaveBeenCalledWith('msg-151');
        expect(pathLogged()).toBe('far');
    });

    it('far upward: lands a lead short below the target, then glides up into place', async () => {
        const scroller = fakeScroller();
        const tops: number[] = [];
        const s = setup([], { list: many, glide: { scroller, range: above, targetTop: 1000 }, onFrame: () => tops.push(scroller.scrollTop) });
        await expect(s.jumpTo({ kind: 'message', id: 1 })).resolves.toBe('landed');
        expect(s.scrollToIndex).toHaveBeenCalledTimes(1);
        expect(s.scrollToIndex).toHaveBeenCalledWith({ index: 0, align: 'start', behavior: 'auto', offset: LEAD });
        expect(tops[0]).toBe(1000 + LEAD);
        expect(scroller.scrollTop).toBe(1000);
    });

    it('upward: still lands when Virtuoso compensates for taller rows mid-glide', async () => {
        // Rows between the viewport and the target measure 95 px taller than estimated, so
        // Virtuoso pushes scrollTop down by 95 while the target is still off screen.
        const scroller = fakeScroller();
        let pushed = false;
        const s = setup([], {
            list: many,
            glide: { scroller, range: above, targetTop: 1000 },
            onFrame: () => { if (!pushed && scroller.scrollTop < 1000 + LEAD - 100) { pushed = true; scroller.scrollTop += 95; } },
        });
        await expect(s.jumpTo({ kind: 'message', id: 1 })).resolves.toBe('landed');
        expect(pushed).toBe(true);
        expect(s.scrollToIndex).toHaveBeenCalledTimes(1); // no correction needed
        expect(scroller.scrollTop).toBe(1000);
    });

    it('far, but the target never rendered during the glide: finishes with an exact instant scroll', async () => {
        // Measured in the browser (grouped list, Home from the bottom): right after the lead-in,
        // rows above the viewport measure taller and Virtuoso pushes scrollTop down by 170 px
        // before the glide starts, so the planned glide ends short with the target unrendered.
        const scroller = fakeScroller();
        let pushed = false;
        const s = setup([], {
            list: many,
            glide: { scroller, range: above, targetTop: 1000 },
            onFrame: () => { if (!pushed && scroller.scrollTop === 1000 + LEAD) { pushed = true; scroller.scrollTop += 170; } },
        });
        await expect(s.jumpTo({ kind: 'top' })).resolves.toBe('landed');
        expect(pushed).toBe(true);
        expect(s.scrollToIndex).toHaveBeenCalledTimes(2);
        expect(s.scrollToIndex).toHaveBeenLastCalledWith({ index: 0, align: 'start', behavior: 'auto' });
        expect(scroller.scrollTop).toBe(1000);
        expect(pathLogged()).toBe('far_snap');
    });

    it('downward: follows the target when it moves mid-glide, without a correction', async () => {
        // A picture above the target finishes loading mid-glide and pushes it 60 px down.
        const scroller = fakeScroller();
        const g = { scroller, range: below, targetTop: 20000 };
        const s = setup([], { list: many, glide: g, onFrame: () => { if (scroller.scrollTop > 20000 - LEAD / 2) g.targetTop = 20060; } });
        await expect(s.jumpTo({ kind: 'message', id: 151 })).resolves.toBe('landed');
        expect(s.scrollToIndex).toHaveBeenCalledTimes(1);
        expect(scroller.scrollTop).toBe(20060);
    });

    it('close upward: glides from here, homing in once the row renders, with no lead-in the wrong way', async () => {
        // The target is two rows above the visible ones, 150 px above the viewport top.
        const scroller = fakeScroller();
        const tops: number[] = [];
        const s = setup([], { list: many, glide: { scroller, range: { startIndex: 52, endIndex: 61 }, targetTop: 4850 }, onFrame: () => tops.push(scroller.scrollTop) });
        await expect(s.jumpTo({ kind: 'message', id: 51 })).resolves.toBe('landed');
        expect(s.scrollToIndex).not.toHaveBeenCalled();
        for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeLessThanOrEqual(tops[i - 1]);
        expect(scroller.scrollTop).toBe(4850);
        expect(s.onLanded).toHaveBeenCalledWith('msg-51');
        expect(pathLogged()).toBe('close');
    });

    it('close upward: rows taller than the visible ones still glide all the way, without a snap', async () => {
        // Estimated 120 px, really 210 px (a long message in between).
        const scroller = fakeScroller();
        const s = setup([], { list: many, glide: { scroller, range: { startIndex: 52, endIndex: 61 }, targetTop: 4790 } });
        await expect(s.jumpTo({ kind: 'message', id: 51 })).resolves.toBe('landed');
        expect(s.scrollToIndex).not.toHaveBeenCalled();
        expect(scroller.scrollTop).toBe(4790);
    });

    it('close downward: glides from here toward a row just below the viewport', async () => {
        const scroller = fakeScroller();
        const tops: number[] = [];
        const s = setup([], { list: many, glide: { scroller, range: { startIndex: 40, endIndex: 49 }, targetTop: 5660 }, onFrame: () => tops.push(scroller.scrollTop) });
        await expect(s.jumpTo({ kind: 'message', id: 52 })).resolves.toBe('landed');
        expect(s.scrollToIndex).not.toHaveBeenCalled();
        for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1]);
        expect(scroller.scrollTop).toBe(5660);
    });

    it('close but still not rendered after the glide: finishes with an exact instant scroll', async () => {
        // Rows were much taller than the visible ones suggested: the estimate falls short.
        const scroller = fakeScroller();
        const s = setup([], { list: many, glide: { scroller, range: { startIndex: 52, endIndex: 61 }, targetTop: 2000 } });
        await expect(s.jumpTo({ kind: 'message', id: 51 })).resolves.toBe('landed');
        expect(s.scrollToIndex).toHaveBeenCalledTimes(1);
        expect(s.scrollToIndex).toHaveBeenCalledWith({ index: 50, align: 'start', behavior: 'auto' });
        expect(scroller.scrollTop).toBe(2000);
        expect(pathLogged()).toBe('close_snap');
    });

    it('near: glides straight to the target by the measured error, without scrollToIndex', async () => {
        const scroller = fakeScroller();
        const s = setup([], { glide: { scroller, range: { startIndex: 0, endIndex: 2 }, targetTop: 5120 } });
        await expect(s.jumpTo({ kind: 'message', id: 2 })).resolves.toBe('landed');
        expect(s.scrollToIndex).not.toHaveBeenCalled();
        expect(scroller.scrollTop).toBe(5120);
        expect(s.onLanded).toHaveBeenCalledWith('msg-2');
        expect(pathLogged()).toBe('onscreen');
    });

    it('near bottom: glides down to the last row instead of leading in from above', async () => {
        const scroller = fakeScroller();
        const s = setup([], { glide: { scroller, range: { startIndex: 0, endIndex: 2 }, targetTop: 5090 } });
        await expect(s.jumpTo({ kind: 'bottom' })).resolves.toBe('landed');
        expect(s.scrollToIndex).not.toHaveBeenCalled();
        expect(scroller.scrollTop).toBe(5090);
    });

    it('near but not rendered yet: falls back to an instant scroll', async () => {
        const scroller = fakeScroller();
        const s = setup([null, 0], { glide: { scroller, range: { startIndex: 0, endIndex: 2 } } });
        await expect(s.jumpTo({ kind: 'message', id: 2 })).resolves.toBe('landed');
        expect(s.scrollToIndex).toHaveBeenCalledWith({ index: 1, align: 'start', behavior: 'auto' });
        expect(scroller.scrollTop).toBe(5000);
        expect(pathLogged()).toBe('onscreen_snap');
    });

    it('reduced motion keeps the instant path', async () => {
        const scroller = fakeScroller();
        const s = setup([], { list: many, glide: { scroller, range: below, reduced: true, targetTop: 20000 } });
        await expect(s.jumpTo({ kind: 'message', id: 151 })).resolves.toBe('landed');
        expect(s.scrollToIndex).toHaveBeenCalledTimes(1);
        expect(s.scrollToIndex.mock.calls[0][0]).toEqual({ index: 150, align: 'start', behavior: 'auto' });
        expect(s.scrollToIndex.mock.calls[0][0]).not.toHaveProperty('offset');
        expect(scroller.scrollTop).toBe(20000);
        expect(pathLogged()).toBe('instant');
    });

    it('a jump cancelled mid-glide ends cancelled and stops moving', async () => {
        const scroller = fakeScroller();
        let rerender: ReturnType<typeof setup>['rerender'] = () => {};
        let at = 0;
        const s = setup([], {
            list: many,
            glide: { scroller, range: below, targetTop: 20000 },
            onFrame: () => {
                if (at === 0 && scroller.scrollTop > 20000 - LEAD) { at = scroller.scrollTop; rerender({ list: many, resetKey: 'b' }); }
            },
        });
        rerender = s.rerender;
        await expect(s.jumpTo({ kind: 'message', id: 151 })).resolves.toBe('cancelled');
        expect(at).toBeGreaterThan(20000 - LEAD);
        expect(scroller.scrollTop).toBe(at);
        expect(s.onLanded).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('timeline_jump', expect.objectContaining({ outcome: 'cancelled' }));
    });

    it('logs exactly one breadcrumb per animated jump', async () => {
        const s = setup([], { list: many, glide: { scroller: fakeScroller(), range: below, targetTop: 20000 } });
        await s.jumpTo({ kind: 'message', id: 151 });
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('timeline_jump', expect.objectContaining({ outcome: 'landed', corrections: 0 }));
    });

    it('every scrollToIndex call on the animated path uses behavior auto', async () => {
        const scroller = fakeScroller();
        const s = setup([], { list: many, glide: { scroller, range: { startIndex: 90, endIndex: 99 }, targetTop: 20000 }, unread: id => id >= 2 });
        await s.jumpTo({ kind: 'message', id: 151 });
        await s.jumpTo({ kind: 'top' });
        await s.jumpTo({ kind: 'bottom' });
        await s.jumpTo({ kind: 'firstUnread' });
        expect(s.scrollToIndex.mock.calls.length).toBeGreaterThanOrEqual(3);
        for (const [arg] of s.scrollToIndex.mock.calls) expect(arg.behavior).toBe('auto');
    });

    it('waits until Virtuoso has stopped re-scrolling the lead-in before gliding', async () => {
        // Rows measured after the lead-in change scrollHeight on frames 1-3 (Virtuoso re-issues
        // its scrollToIndex then); a glide started meanwhile would be snapped back.
        const scroller = fakeScroller();
        let firstMove = 0;
        const s = setup([], {
            list: many,
            glide: { scroller, range: below, targetTop: 20000 },
            onFrame: n => {
                if (n <= 3) scroller.scrollHeight += 25;
                if (!firstMove && scroller.scrollTop !== 20000 - LEAD) firstMove = n;
            },
        });
        await expect(s.jumpTo({ kind: 'message', id: 151 })).resolves.toBe('landed');
        // The last change was seen on frame 3 (48 ms); the glide may start writing only after the window.
        expect((firstMove - 1) * 16 - 48).toBeGreaterThanOrEqual(STILLNESS_MS);
        expect(scroller.scrollTop).toBe(20000);
    });

    it('falls back to an exact instant scroll when the lead-in never settles', async () => {
        const scroller = fakeScroller();
        const s = setup([], {
            list: many,
            glide: { scroller, range: below, targetTop: 20000 },
            onFrame: () => { scroller.scrollHeight += 1; },
        });
        await expect(s.jumpTo({ kind: 'message', id: 151 })).resolves.toBe('landed');
        expect(s.scrollToIndex).toHaveBeenCalledTimes(2);
        expect(s.scrollToIndex).toHaveBeenNthCalledWith(2, { index: 150, align: 'start', behavior: 'auto' });
        expect(scroller.scrollTop).toBe(20000);
        expect(pathLogged()).toBe('far_unsettled');
    });

    it('an unknown visible range (null) jumps instantly, without a lead-in', async () => {
        const scroller = fakeScroller();
        const s = setup([], { list: many, glide: { scroller, range: null, targetTop: 20000 } });
        await expect(s.jumpTo({ kind: 'message', id: 151 })).resolves.toBe('landed');
        expect(s.scrollToIndex).toHaveBeenCalledTimes(1);
        expect(s.scrollToIndex.mock.calls[0][0]).toEqual({ index: 150, align: 'start', behavior: 'auto' });
        expect(s.scrollToIndex.mock.calls[0][0]).not.toHaveProperty('offset');
        expect(pathLogged()).toBe('instant');
    });

    it('without a visibleRange argument the jump is instant too', async () => {
        const scroller = fakeScroller();
        const s = setup([], { list: many, glide: { scroller, targetTop: 20000 } });
        await expect(s.jumpTo({ kind: 'message', id: 151 })).resolves.toBe('landed');
        expect(s.scrollToIndex).toHaveBeenCalledTimes(1);
        expect(s.scrollToIndex.mock.calls[0][0]).not.toHaveProperty('offset');
        expect(pathLogged()).toBe('instant');
    });

    it('far jump at the bottom edge: the clamped lead-in is shorter, yet the jump still lands', async () => {
        // The target sits in the last screen: its aligned position lies 100 px past the
        // scroll range, so Virtuoso clamps the lead-in and the glide covers only 380 px.
        // Like a real element, the scroller clamps writes to its scroll range.
        let top = 5000;
        const scroller = {
            scrollHeight: 20700, clientHeight: 600,
            get scrollTop() { return top; },
            set scrollTop(v: number) { top = Math.min(20700 - 600, Math.max(0, v)); },
        };
        const maxTop = scroller.scrollHeight - scroller.clientHeight;
        const targetTop = maxTop + 100;
        const s = setup([], { list: many, glide: { scroller, range: below, targetTop } });
        const leadIns: number[] = [];
        s.scrollToIndex.mockImplementation((loc: { offset?: number }) => {
            scroller.scrollTop = Math.min(maxTop, targetTop + (loc.offset ?? 0));
            leadIns.push(scroller.scrollTop);
        });
        await expect(s.jumpTo({ kind: 'message', id: 151 })).resolves.toBe('landed');
        expect(leadIns[0]).toBe(maxTop - 380);
        expect(scroller.scrollTop).toBe(maxTop);
        expect(pathLogged()).toBe('far');
        expect(clientLog).toHaveBeenCalledTimes(1);
    });

    it('far jump already at the scroll limit: no glide is needed and it still lands', async () => {
        const scroller = { scrollTop: 5000, scrollHeight: 20600, clientHeight: 600 };
        const maxTop = 20000;
        const s = setup([], { list: many, glide: { scroller, range: below, targetTop: maxTop } });
        s.scrollToIndex.mockImplementation(() => { scroller.scrollTop = maxTop; }); // offset clamped to zero
        await expect(s.jumpTo({ kind: 'message', id: 151 })).resolves.toBe('landed');
        expect(scroller.scrollTop).toBe(maxTop);
        expect(s.scrollToIndex).toHaveBeenCalledTimes(1);
    });
});

describe('estimateTravel', () => {
    // Ten visible rows on a 600 px viewport: 60 px each.
    const range = { startIndex: 40, endIndex: 49 };
    it('is 0 for a row on screen', () => {
        expect(estimateTravel(45, 'start', range, 600)).toBe(0);
    });
    it('downward: start puts the row at the top, end at the bottom', () => {
        expect(estimateTravel(50, 'start', range, 600)).toBe(600);
        expect(estimateTravel(52, 'start', range, 600)).toBe(720);
        expect(estimateTravel(50, 'end', range, 600)).toBe(60);
        expect(estimateTravel(50, 'center', range, 600)).toBe(330);
    });
    it('upward: negative, start at the top, end at the bottom', () => {
        expect(estimateTravel(39, 'start', range, 600)).toBe(-60);
        expect(estimateTravel(39, 'end', range, 600)).toBe(-600);
        expect(estimateTravel(39, 'center', range, 600)).toBe(-330);
    });
});
