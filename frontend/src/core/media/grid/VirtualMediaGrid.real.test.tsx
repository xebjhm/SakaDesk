import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';

// The REAL react-virtuoso (no mock): the gallery tests mock it, which hid D-M1, where
// `components={undefined}` made 4.18 throw "reading 'EmptyPlaceholder'" on mount.
vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('./mediaMeta', () => ({ primeMediaMeta: vi.fn() }));

import { VirtuosoMockContext } from 'react-virtuoso';
import { VirtualMediaGrid, type MediaGridGroup } from './VirtualMediaGrid';

/**
 * jsdom has no layout, so the real list measures a 0 px viewport and renders no rows. react-virtuoso's
 * own test hook, `VirtuosoMockContext`, gives it a viewport (and a size per item), so the real
 * library renders the sticky header and the first rows. It does not simulate scrolling.
 */
const sized = (node: React.ReactNode) => (
    <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 100 }}>{node}</VirtuosoMockContext.Provider>
);

interface Item { id: string }
const items = (prefix: string, n: number): Item[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
const groups: MediaGridGroup<Item>[] = [
    { key: 'g1', label: '2026年11月', items: items('a', 12) },
    { key: 'g2', label: '2026年10月', items: items('b', 3) },
];

class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

beforeEach(() => vi.stubGlobal('ResizeObserver', NoopResizeObserver));
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('VirtualMediaGrid with the real react-virtuoso', () => {
    it('mounts without a footer, without throwing, and renders the header and real rows', () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        try {
            expect(() => render(
                sized(
                    <VirtualMediaGrid<Item>
                        groups={groups}
                        itemKey={(i) => i.id}
                        mediaUrl={(i) => `/api/content/media/s/${i.id}.jpg`}
                        renderTile={(item) => <span data-testid="tile">{item.id}</span>}
                        scrollParent={parent}
                        grid="messages"
                    />,
                ),
                { container: parent },
            )).not.toThrow();
            // The sticky group header and the first rows, in order, drawn by the real library.
            expect(parent.querySelector('[data-media-grid-header]')).toHaveTextContent('2026年11月');
            const rows = Array.from(parent.querySelectorAll<HTMLElement>('[data-media-grid-row]'));
            expect(rows.length).toBeGreaterThan(0);
            const firsts = rows.map((r) => Number(r.dataset.first));
            expect(firsts[0]).toBe(0);
            for (let i = 1; i < firsts.length; i += 1) expect(firsts[i]).toBeGreaterThan(firsts[i - 1]);
            expect(parent.querySelectorAll('[data-testid="tile"]')[0]).toHaveTextContent('a0');
        } finally {
            errors.mockRestore();
            parent.remove();
        }
    });

    it('mounts with a footer and renders it', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        try {
            // Two items only, so every row and then the footer fit the mocked viewport.
            const { getByText } = render(
                sized(
                    <VirtualMediaGrid<Item>
                        groups={[{ key: 'g1', label: '2026年11月', items: items('a', 2) }]}
                        itemKey={(i) => i.id}
                        mediaUrl={() => null}
                        renderTile={(item) => <span>{item.id}</span>}
                        scrollParent={parent}
                        grid="blogs"
                        footer={<p>more</p>}
                    />,
                ),
                { container: parent },
            );
            expect(getByText('a0')).toBeTruthy();
            expect(getByText('more')).toBeTruthy();
        } finally {
            parent.remove();
        }
    });
});
