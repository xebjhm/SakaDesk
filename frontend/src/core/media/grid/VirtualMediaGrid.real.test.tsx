import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// The REAL react-virtuoso (no mock): the gallery tests mock it, which hid D-M1, where
// `components={undefined}` made 4.18 throw "reading 'EmptyPlaceholder'" on mount.
vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('./mediaMeta', () => ({ primeMediaMeta: vi.fn() }));

import { VirtualMediaGrid, type MediaGridGroup } from './VirtualMediaGrid';

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
    it('mounts without a footer and without throwing', () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        try {
            expect(() => render(
                <VirtualMediaGrid<Item>
                    groups={groups}
                    itemKey={(i) => i.id}
                    mediaUrl={(i) => `/api/content/media/s/${i.id}.jpg`}
                    renderTile={(item) => <span>{item.id}</span>}
                    scrollParent={parent}
                    grid="messages"
                />,
                { container: parent },
            )).not.toThrow();
            expect(parent.querySelector('[data-virtuoso-scroller], [data-test-id="virtuoso-item-list"], [data-testid="virtuoso-item-list"]')).not.toBeNull();
        } finally {
            errors.mockRestore();
            parent.remove();
        }
    });

    it('mounts with a footer and renders it', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        try {
            const { getByText } = render(
                <VirtualMediaGrid<Item>
                    groups={groups}
                    itemKey={(i) => i.id}
                    mediaUrl={() => null}
                    renderTile={(item) => <span>{item.id}</span>}
                    scrollParent={parent}
                    grid="blogs"
                    footer={<p>more</p>}
                />,
                { container: parent },
            );
            expect(getByText('more')).toBeTruthy();
        } finally {
            parent.remove();
        }
    });
});
