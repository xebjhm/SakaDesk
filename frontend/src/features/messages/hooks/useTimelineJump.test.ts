import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { Message } from '../../../types';
import { useTimelineJump, MAX_CORRECTIONS } from './useTimelineJump';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

const msg = (id: number, ts: string): Message =>
    ({ id, timestamp: ts, type: 'text', is_favorite: false, content: `m${id}` });
const messages = [msg(1, '2022-01-15T01:00:00Z'), msg(2, '2024-03-15T01:00:00Z'), msg(3, '2026-11-03T01:00:00Z')];

function setup(measures: Array<number | null>, opts: { unread?: (id: number) => boolean } = {}) {
    const scrollToIndex = vi.fn();
    const ref = { current: { scrollToIndex } as unknown as VirtuosoHandle };
    const onLanded = vi.fn();
    const queue = [...measures];
    const measure = vi.fn(() => (queue.length > 1 ? queue.shift()! : queue[0]));
    const { result } = renderHook(() => useTimelineJump({
        virtuosoRef: ref,
        messages,
        isUnread: opts.unread ?? (() => false),
        onLanded,
        deps: { nextFrame: () => Promise.resolve(), measure, now: () => 0 },
    }));
    return { jumpTo: result.current, scrollToIndex, onLanded, measure };
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
        const { jumpTo, scrollToIndex } = setup([40, 40, 0]);
        await jumpTo({ kind: 'date', date: '2099-01-01' });
        await jumpTo({ kind: 'message', id: 1 });
        for (const [arg] of scrollToIndex.mock.calls) expect(arg.behavior).toBe('auto');
    });
});
