import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { act, render } from '@testing-library/react';
import { IDLE_PROGRESS, resetSyncProgressStore, selectIsSyncing, setActiveProgress, setServiceProgress, useSyncProgressStore } from './syncProgressStore';

describe('syncProgressStore', () => {
    beforeEach(() => resetSyncProgressStore());

    it('starts idle with no services', () => {
        expect(useSyncProgressStore.getState()).toMatchObject({ active: IDLE_PROGRESS, byService: {} });
    });

    it('sets the shown progress and per-service progress (value or updater)', () => {
        setActiveProgress({ state: 'running', phase: 'syncing' });
        setServiceProgress({ hinatazaka46: { state: 'running' } });
        setServiceProgress((prev) => ({ ...prev, sakurazaka46: { state: 'queued', queue_position: 1 } }));
        const s = useSyncProgressStore.getState();
        expect(s.active.state).toBe('running');
        expect(Object.keys(s.byService)).toEqual(['hinatazaka46', 'sakurazaka46']);
        expect(selectIsSyncing(s)).toBe(true);
    });

    it('re-renders a selector component only when its slice changes', () => {
        const renders = { count: 0 };
        const Probe: React.FC = () => {
            const syncing = useSyncProgressStore(selectIsSyncing);
            renders.count += 1;
            return <span>{String(syncing)}</span>;
        };
        const { container } = render(<Probe />);
        expect(renders.count).toBe(1);
        act(() => setActiveProgress({ state: 'running', completed: 1 })); // idle -> running: slice changes
        expect(renders.count).toBe(2);
        act(() => setActiveProgress({ state: 'running', completed: 2 })); // same slice
        act(() => setActiveProgress({ state: 'running', completed: 3 }));
        act(() => setServiceProgress({ hinatazaka46: { state: 'running' } })); // another slice entirely
        expect(renders.count).toBe(2);
        expect(container.textContent).toBe('true');
        act(() => setActiveProgress({ state: 'complete' }));
        expect(renders.count).toBe(3);
        expect(container.textContent).toBe('false');
    });
});
