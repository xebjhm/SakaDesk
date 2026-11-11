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
import { gridColumns } from './useGridColumns';
import { MediaGridContext, type MediaGridTileReporter } from './gridContext';
import { mediaGridColumns } from '../tileGrid';

interface Item { id: string }
const items = (prefix: string, n: number): Item[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
const urlOf = (item: Item) => `/api/content/media/s/${item.id}.jpg`;

let observedWidth = 800;
class StubResizeObserver {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
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

    it('lays out one column before the width is known (no ResizeObserver)', () => {
        vi.stubGlobal('ResizeObserver', undefined);
        render(<Grid groups={[{ key: 'g1', label: 'A', items: items('a', 3) }]} />);
        expect(document.querySelectorAll('[data-media-grid-row]')).toHaveLength(3);
    });
});
