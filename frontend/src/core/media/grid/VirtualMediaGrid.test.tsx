import React, { useContext, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
import { virtuosoCapture, resetVirtuosoCapture } from '../../../__tests__/virtuosoMock';
vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
const prime = vi.fn();
vi.mock('./mediaMeta', () => ({ primeMediaMeta: (urls: readonly (string | null | undefined)[]) => prime(urls) }));

import { VirtualMediaGrid, type MediaGridGroup, type VirtualMediaGridHandle } from './VirtualMediaGrid';
import { firstVisibleItem, rowOfItem } from './gridAnchor';
import { gridColumns } from './useGridColumns';
import { MediaGridContext, type MediaGridTileReporter } from './gridContext';
import { mediaGridColumns } from '../tileGrid';

interface Item { id: string }
const items = (prefix: string, n: number): Item[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
const urlOf = (item: Item) => `/api/content/media/s/${item.id}.jpg`;

let observedWidth = 800;
let lastObserver: { resize(width: number): void } | null = null;
class StubResizeObserver {
    private target: Element | null = null;
    constructor(private cb: ResizeObserverCallback) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        lastObserver = {
            resize(width: number) {
                observedWidth = width;
                self.cb([{ target: self.target, contentRect: { width } } as unknown as ResizeObserverEntry], self as unknown as ResizeObserver);
            },
        };
    }
    observe(target: Element) {
        this.target = target;
        this.cb([{ target, contentRect: { width: observedWidth } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
}

beforeEach(() => {
    observedWidth = 800;
    resetVirtuosoCapture();
    prime.mockClear();
    vi.mocked(clientLog).mockClear();
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
});
afterEach(() => vi.unstubAllGlobals());

function Grid({ groups, gridRef, renderTile }: {
    groups: MediaGridGroup<Item>[];
    gridRef?: React.Ref<VirtualMediaGridHandle>;
    renderTile?: (item: Item, flatIndex: number, tilePx: number) => React.ReactNode;
}) {
    return (
        <VirtualMediaGrid<Item>
            ref={gridRef}
            groups={groups}
            itemKey={(i) => i.id}
            mediaUrl={urlOf}
            renderTile={renderTile ?? ((item, flat, px) => <span data-testid="tile" data-flat={flat} data-px={px}>{item.id}</span>)}
            scrollParent={document.body}
            grid="messages"
        />
    );
}

describe('gridColumns', () => {
    it('follows tileGrid.ts by default (tiles ≥ 9rem, ≤ 6 per row)', () => {
        for (const w of [200, 300, 800, 960, 1200, 1600, 2400]) {
            expect(gridColumns(w).cols).toBe(mediaGridColumns(w));
        }
        expect(gridColumns(2400).cols).toBe(6);
        expect(gridColumns(800)).toEqual({ cols: 5, tilePx: Math.floor((800 - 8 * 4) / 5) });
        expect(gridColumns(0)).toEqual({ cols: 1, tilePx: 0 });
    });

    it('uses the max-tile formula when a max tile size is given', () => {
        // ceil((800 + 4) / (180 + 4)) = 5
        expect(gridColumns(800, { minTilePx: 112, maxTilePx: 180, gapPx: 4 }).cols).toBe(5);
        // reduced while the tile is narrower than min
        expect(gridColumns(300, { minTilePx: 140, maxTilePx: 100, gapPx: 4 }).cols).toBe(2);
    });
});

describe('VirtualMediaGrid', () => {
    it('chunks each group into rows of the computed columns, under sticky headers', () => {
        render(<Grid groups={[{ key: 'g1', label: '2026年11月', items: items('a', 12) }, { key: 'g2', label: '2026年10月', items: items('b', 3) }]} />);
        const rows = document.querySelectorAll('[data-media-grid-row]');
        expect(Array.from(rows).map(r => r.children.length)).toEqual([5, 5, 2, 3]);
        expect((rows[0] as HTMLElement).style.gridTemplateColumns).toBe('repeat(5, minmax(0, 1fr))');
        const tiles = screen.getAllByTestId('tile');
        expect(tiles.map(t => t.getAttribute('data-flat'))).toEqual(Array.from({ length: 15 }, (_, i) => String(i)));
        expect(tiles[0].getAttribute('data-px')).toBe(String(Math.floor((800 - 8 * 4) / 5)));
        const header = screen.getByText('2026年11月');
        expect(header.className).toContain('bg-sheet px-4 py-3 text-small font-semibold text-secondary');
        expect(screen.getByText('2026年10月')).toBeInTheDocument();
    });

    it('maps scrollToItem and scrollToGroup to Virtuoso locations', () => {
        const ref = React.createRef<VirtualMediaGridHandle>();
        render(<Grid gridRef={ref} groups={[{ key: 'g1', label: 'A', items: items('a', 12) }, { key: 'g2', label: 'B', items: items('b', 3) }]} />);
        act(() => ref.current!.scrollToItem(7));
        act(() => ref.current!.scrollToItem(13));
        act(() => ref.current!.scrollToItem(0));
        act(() => ref.current!.scrollToGroup('g2'));
        act(() => ref.current!.scrollToGroup('missing'));
        act(() => ref.current!.scrollToItem(99));
        expect(virtuosoCapture.scrollToIndex).toEqual([
            { index: 1, align: 'start' },
            { index: 3, align: 'start' },
            { index: 0, align: 'start' },
            { groupIndex: 1, align: 'start' },
        ]);
    });

    it('keys headers and rows by react-virtuoso 4.18 flat indices (headers counted)', () => {
        // GroupedVirtuoso calls computeItemKey for headers too, with an index that counts them.
        const groups = [{ key: 'g1', label: 'A', items: items('a', 12) }, { key: 'g2', label: 'B', items: items('b', 3) }];
        const { rerender } = render(<Grid groups={groups} />);
        expect(virtuosoCapture.groupedKeys).toEqual(['group:g1', 'row:a0', 'row:a5', 'row:a10', 'group:g2', 'row:b0']);
        expect(new Set(virtuosoCapture.groupedKeys).size).toBe(virtuosoCapture.groupedKeys.length);
        // An item key equal to a group key never collides with it.
        rerender(<Grid groups={[{ key: 'x', label: 'A', items: [{ id: 'x' }] }, { key: 'y', label: 'B', items: [{ id: 'y' }] }]} />);
        expect(virtuosoCapture.groupedKeys).toEqual(['group:x', 'row:x', 'group:y', 'row:y']);
    });

    it('keeps a row key stable when an earlier group grows', () => {
        render(<Grid groups={[{ key: 'g1', label: 'A', items: items('a', 3) }, { key: 'g2', label: 'B', items: items('b', 3) }]} />);
        const before = virtuosoCapture.groupedKeys.slice();
        resetVirtuosoCapture();
        render(<Grid groups={[{ key: 'g0', label: 'Z', items: items('z', 2) }, { key: 'g1', label: 'A', items: items('a', 3) }, { key: 'g2', label: 'B', items: items('b', 3) }]} />);
        expect(virtuosoCapture.groupedKeys.slice(2)).toEqual(before);
    });

    it('primes meta for the rendered rows plus two more screens', () => {
        render(<Grid groups={[{ key: 'g1', label: 'A', items: items('a', 50) }]} />);
        act(() => virtuosoCapture.rangeChanged!({ startIndex: 0, endIndex: 1 }));
        expect(prime).toHaveBeenCalledTimes(1);
        const urls = prime.mock.calls[0][0] as string[];
        expect(urls).toEqual(items('a', 30).map(urlOf));
        act(() => virtuosoCapture.rangeChanged!({ startIndex: 8, endIndex: 9 }));
        expect(prime.mock.calls[1][0]).toEqual(items('a', 50).slice(40).map(urlOf));
    });

    it('logs one media_grid breadcrumb with the first visible tile time', () => {
        let seen: MediaGridTileReporter | null = null;
        function ReportingTile() {
            const reporter = useContext(MediaGridContext);
            useEffect(() => {
                seen = reporter;
                reporter?.tileVisible(1);
                return () => reporter?.tileVisible(-1);
            }, [reporter]);
            return <span />;
        }
        render(<Grid groups={[{ key: 'g1', label: 'A', items: items('a', 7) }]} renderTile={() => <ReportingTile />} />);
        expect(clientLog).not.toHaveBeenCalled();
        expect(seen!.root).toBe(document.body);
        act(() => { seen!.tileReady(); seen!.tileReady(); });
        expect(clientLog).toHaveBeenCalledTimes(1);
        const [event, fields] = vi.mocked(clientLog).mock.calls[0];
        expect(event).toBe('media_grid');
        expect(fields).toMatchObject({ grid: 'messages', visible: 7, count: 7 });
        expect(Number.isInteger(fields!.first_tile_ms)).toBe(true);
        expect(fields!.first_tile_ms as number).toBeGreaterThanOrEqual(0);
    });

    it('keeps the first visible item in view when a resize changes the column count', () => {
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
        try {
            // 5 columns at 800 px: rows of 60 px from y = 0; the scroll parent's top is at 0 and
            // the sticky header 40 px tall, so the first visible row is the one under the header.
            const rowPx = 60;
            const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
                if (this.hasAttribute('data-media-grid-header')) return { top: 0, bottom: 40, height: 40 } as DOMRect;
                if (this.hasAttribute('data-media-grid-row')) {
                    const rows = Array.from(document.querySelectorAll('[data-media-grid-row]'));
                    // Scrolled so that row 3 (items 15–19) sits right under the header.
                    const top = (rows.indexOf(this) - 3) * rowPx + 40;
                    return { top, bottom: top + rowPx, height: rowPx } as DOMRect;
                }
                return { top: 0, bottom: 0, height: 0 } as DOMRect;
            });
            render(<Grid groups={[{ key: 'g1', label: 'A', items: items('a', 40) }]} />);
            act(() => virtuosoCapture.rangeChanged!({ startIndex: 2, endIndex: 6 }));
            expect(virtuosoCapture.scrollToIndex).toEqual([]);
            // 800 → 600 px: 5 → 4 columns (gridColumns), so item 15 moves to row floor(15 / 4) = 3.
            act(() => lastObserver!.resize(600));
            expect(gridColumns(600).cols).toBe(4);
            act(() => { vi.advanceTimersToNextFrame(); });
            expect(virtuosoCapture.scrollToIndex).toEqual([{ index: 3, align: 'start' }]);
            // 600 → 400 px: 4 → 2 columns; item 15 moves to row 7.
            act(() => lastObserver!.resize(400));
            act(() => { vi.advanceTimersToNextFrame(); });
            expect(virtuosoCapture.scrollToIndex[virtuosoCapture.scrollToIndex.length - 1]).toEqual({ index: Math.floor(15 / gridColumns(400).cols), align: 'start' });
            rect.mockRestore();
        } finally {
            vi.useRealTimers();
        }
    });

    describe('anchor persistence (review I2, I3)', () => {
        const rowPx = 60;
        const headerPx = 40;
        /** Which item's row is on screen, and where its top sits (px from the scroll parent's top). */
        let screen_: { item: string; top: number } | null = null;
        let rect: ReturnType<typeof vi.spyOn>;
        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
            screen_ = null;
            rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
                if (this.hasAttribute('data-media-grid-header')) return { top: 0, bottom: headerPx, height: headerPx } as DOMRect;
                if (this.hasAttribute('data-media-grid-row') && screen_) {
                    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-media-grid-row]'));
                    const at = rows.findIndex((r) => Array.from(r.children).some((c) => c.textContent === screen_!.item));
                    const top = (rows.indexOf(this) - at) * rowPx + screen_.top;
                    return { top, bottom: top + rowPx, height: rowPx } as DOMRect;
                }
                return { top: 0, bottom: 0, height: 0 } as DOMRect;
            });
        });
        afterEach(() => {
            rect.mockRestore();
            vi.useRealTimers();
        });
        const scrollEvent = () => act(() => {
            document.body.dispatchEvent(new Event('scroll'));
            vi.advanceTimersToNextFrame();
        });
        const resize = (width: number) => {
            act(() => lastObserver!.resize(width));
            act(() => { vi.advanceTimersToNextFrame(); });
        };
        const lastScroll = () => virtuosoCapture.scrollToIndex[virtuosoCapture.scrollToIndex.length - 1];

        it('keeps the same item over repeated column changes, though the header covers its re-anchored row', () => {
            render(<Grid groups={[{ key: 'g1', label: 'A', items: items('a', 60) }]} />);
            screen_ = { item: 'a15', top: headerPx };
            act(() => virtuosoCapture.rangeChanged!({ startIndex: 2, endIndex: 6 }));
            resize(600); // 5 → 4 columns
            expect(lastScroll()).toEqual({ index: Math.floor(15 / 4), align: 'start' });
            // Virtuoso aligned that row under the sticky header: most of it is covered, so a fresh
            // measure would pick the NEXT row. The scroll it caused must not move the anchor.
            screen_ = { item: 'a15', top: 0 };
            scrollEvent();
            act(() => virtuosoCapture.rangeChanged!({ startIndex: 3, endIndex: 7 }));
            resize(400); // 4 → 2 columns
            expect(lastScroll()).toEqual({ index: Math.floor(15 / gridColumns(400).cols), align: 'start' });
            resize(800); // back to 5
            expect(lastScroll()).toEqual({ index: 3, align: 'start' });
        });

        it('re-measures after a user gesture', () => {
            render(<Grid groups={[{ key: 'g1', label: 'A', items: items('a', 60) }]} />);
            screen_ = { item: 'a15', top: headerPx };
            act(() => virtuosoCapture.rangeChanged!({ startIndex: 2, endIndex: 6 }));
            resize(600);
            act(() => { document.body.dispatchEvent(new Event('wheel')); });
            screen_ = { item: 'a40', top: headerPx };
            scrollEvent();
            resize(400);
            expect(lastScroll()).toEqual({ index: Math.floor(40 / gridColumns(400).cols), align: 'start' });
        });

        it('a jump pins its target as the anchor', () => {
            const ref = React.createRef<VirtualMediaGridHandle>();
            render(<Grid gridRef={ref} groups={[{ key: 'g1', label: 'A', items: items('a', 60) }]} />);
            act(() => ref.current!.scrollToItem(22));
            screen_ = { item: 'a20', top: 0 }; // where Virtuoso put row 4 (items 20–24), header over it
            scrollEvent();
            resize(600);
            expect(lastScroll()).toEqual({ index: Math.floor(22 / 4), align: 'start' });
        });

        it('never anchors a stale item after the groups change', () => {
            const { rerender } = render(<Grid groups={[{ key: 'g1', label: 'A', items: items('a', 60) }]} />);
            screen_ = { item: 'a15', top: headerPx };
            act(() => virtuosoCapture.rangeChanged!({ startIndex: 2, endIndex: 6 }));
            // Another member: none of the old items is listed, and nothing is measured on screen yet.
            screen_ = null;
            rerender(<Grid groups={[{ key: 'h1', label: 'B', items: items('b', 60) }]} />);
            act(() => { vi.advanceTimersToNextFrame(); });
            const before = virtuosoCapture.scrollToIndex.length;
            resize(600);
            expect(virtuosoCapture.scrollToIndex.length).toBe(before);
        });

        it('keeps the anchor item, not its index, when a page is prepended', () => {
            const tail = items('a', 60);
            const { rerender } = render(<Grid groups={[{ key: 'g1', label: 'A', items: tail }]} />);
            screen_ = { item: 'a15', top: headerPx };
            act(() => virtuosoCapture.rangeChanged!({ startIndex: 2, endIndex: 6 }));
            // A newer month arrives above; the same item is still on screen.
            rerender(<Grid groups={[{ key: 'g0', label: 'Z', items: items('z', 7) }, { key: 'g1', label: 'A', items: tail }]} />);
            act(() => { vi.advanceTimersToNextFrame(); });
            resize(600);
            // g0 has 7 items → 2 rows at 4 columns; a15 is row 2 + floor(15 / 4) = 5.
            expect(lastScroll()).toEqual({ index: 2 + Math.floor(15 / 4), align: 'start' });
        });
    });

    it('does not scroll on a resize that keeps the column count, or when at the top', () => {
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
        try {
            render(<Grid groups={[{ key: 'g1', label: 'A', items: items('a', 40) }]} />);
            // jsdom rects are all 0: the first row counts as visible, i.e. the top.
            act(() => virtuosoCapture.rangeChanged!({ startIndex: 0, endIndex: 4 }));
            act(() => lastObserver!.resize(820));
            act(() => lastObserver!.resize(600));
            act(() => { vi.advanceTimersToNextFrame(); });
            expect(virtuosoCapture.scrollToIndex).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('lays out one column before the width is known (no ResizeObserver)', () => {
        vi.stubGlobal('ResizeObserver', undefined);
        render(<Grid groups={[{ key: 'g1', label: 'A', items: items('a', 3) }]} />);
        expect(document.querySelectorAll('[data-media-grid-row]')).toHaveLength(3);
    });
});

describe('resize anchoring helpers', () => {
    it('firstVisibleItem picks the first row whose middle is below the view top', () => {
        const rows = [
            { top: -50, bottom: 10, first: 0 },
            { top: 10, bottom: 70, first: 5 },
            { top: 70, bottom: 130, first: 10 },
        ];
        expect(firstVisibleItem(rows, 0)).toBe(5);
        // A sticky header of 50 px hides most of the row at 10–70 (middle 40).
        expect(firstVisibleItem(rows, 50)).toBe(10);
        expect(firstVisibleItem(rows, 500)).toBeNull();
        expect(firstVisibleItem([], 0)).toBeNull();
        // DOM order does not matter.
        expect(firstVisibleItem([rows[2], rows[1]], 0)).toBe(5);
    });

    it('rowOfItem maps a flat index to its row for a column count, across groups', () => {
        // Groups of 12 and 3 items at 5 columns: rows [0,1,2] then [3].
        expect(rowOfItem(7, [0, 12], [0, 3], 15, 5)).toBe(1);
        expect(rowOfItem(13, [0, 12], [0, 3], 15, 5)).toBe(3);
        // At 4 columns: rows [0,1,2] then [3].
        expect(rowOfItem(11, [0, 12], [0, 3], 15, 4)).toBe(2);
        expect(rowOfItem(-1, [0, 12], [0, 3], 15, 5)).toBeNull();
        expect(rowOfItem(15, [0, 12], [0, 3], 15, 5)).toBeNull();
    });
});
