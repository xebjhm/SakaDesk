import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import { KeepListPainted, LIST_SNAPSHOT_COVER_MAX_MS, LIST_SNAPSHOT_MAX, resetListSnapshots } from './listSnapshot';

/** Virtuoso's DOM as far as the cover reads it: the scroller and the item list (hidden until positioned). */
function FakeList({ room, hidden }: { room: string; hidden: boolean }) {
    return (
        <div data-virtuoso-scroller="true" data-testid="virtuoso-scroller" style={{ overflowY: 'auto', height: 300 }}>
            <div data-testid="virtuoso-item-list" style={hidden ? { visibility: 'hidden' } : {}}>
                <p>{`${room} のメッセージ 🌸`}</p>
            </div>
        </div>
    );
}

function View({ room, hidden, restore = true }: { room: string; hidden: boolean; restore?: boolean }) {
    return (
        <KeepListPainted roomKey={room} restore={restore}>
            <FakeList room={room} hidden={hidden} />
        </KeepListPainted>
    );
}

const cover = () => screen.queryByTestId('chat-list-snapshot');

/** Paint room A positioned at scrollTop 120, then switch to B (A's list is remembered on leave). */
function visitAThenB() {
    const utils = render(<View room="A" hidden={false} />);
    (document.querySelector('[data-virtuoso-scroller]') as HTMLElement).scrollTop = 120;
    utils.rerender(<View room="B" hidden={false} />);
    return utils;
}

beforeEach(() => {
    resetListSnapshots();
    vi.mocked(clientLog).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('KeepListPainted (I1: no blank frames on a revisit)', () => {
    it('covers a revisited room with its last painted list from the first commit, at its scroll position', () => {
        const { rerender } = visitAThenB();
        rerender(<View room="A" hidden />);
        const shown = cover();
        expect(shown).not.toBeNull();
        expect(shown).toHaveAttribute('aria-hidden', 'true');
        expect(shown).toHaveAttribute('inert');
        expect(shown!.textContent).toContain('A のメッセージ 🌸');
        expect((shown!.querySelector('[data-virtuoso-scroller]') as HTMLElement).scrollTop).toBe(120);
    });

    it('drops the cover in the same task the live list is shown (the guard still hides it until then)', async () => {
        const { rerender } = visitAThenB();
        rerender(<View room="A" hidden />);
        const live = screen.getAllByTestId('virtuoso-item-list').find((el) => !cover()!.contains(el))!;
        expect(live.style.visibility).toBe('hidden');
        await act(async () => { live.style.visibility = ''; await Promise.resolve(); });
        expect(cover()).toBeNull();
        expect(screen.getAllByText('A のメッセージ 🌸')).toHaveLength(1);
    });

    it('shows no cover for a room never painted, a jump to a message, or a list already positioned', () => {
        const { rerender } = render(<View room="A" hidden />);
        expect(cover()).toBeNull();
        rerender(<View room="B" hidden={false} />);
        rerender(<View room="A" hidden={false} />);
        rerender(<View room="B" hidden restore={false} />);
        expect(cover()).toBeNull();
        rerender(<View room="A" hidden={false} />);
        expect(cover()).toBeNull();
    });

    it('never remembers a list left before it was positioned (that snapshot would be blank)', () => {
        const { rerender } = render(<View room="A" hidden />);
        rerender(<View room="B" hidden={false} />);
        rerender(<View room="A" hidden />);
        expect(cover()).toBeNull();
    });

    it('drops a cover the live list never reveals after the cap, with a codes-only breadcrumb', () => {
        vi.useFakeTimers();
        const { rerender } = visitAThenB();
        rerender(<View room="A" hidden />);
        act(() => { vi.advanceTimersByTime(LIST_SNAPSHOT_COVER_MAX_MS - 1); });
        expect(cover()).not.toBeNull();
        act(() => { vi.advanceTimersByTime(1); });
        expect(cover()).toBeNull();
        expect(clientLog).toHaveBeenCalledWith('chat_load', { outcome: 'snapshot_timeout' });
    });

    it(`keeps at most ${LIST_SNAPSHOT_MAX} rooms`, () => {
        const rooms = Array.from({ length: LIST_SNAPSHOT_MAX + 2 }, (_, i) => `R${i}`);
        const { rerender } = render(<View room={rooms[0]} hidden={false} />);
        for (const r of rooms.slice(1)) rerender(<View room={r} hidden={false} />);
        rerender(<View room="last" hidden={false} />);
        rerender(<View room={rooms[0]} hidden />); // evicted: the oldest
        expect(cover()).toBeNull();
        rerender(<View room="x" hidden={false} />);
        rerender(<View room={rooms[LIST_SNAPSHOT_MAX + 1]} hidden />);
        expect(cover()).not.toBeNull();
    });
});
