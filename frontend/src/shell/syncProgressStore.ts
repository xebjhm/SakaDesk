import { create } from 'zustand';
import type { SyncProgress } from '../features/messages/MessagesFeature';

export const IDLE_PROGRESS: SyncProgress = { state: 'idle' };

export interface SyncProgressState {
    /**
     * The progress the app shows: the active service's, or the running step of a sequential sync.
     * Derived from `byService` (kept current by `useSync`'s follower), not a primary store.
     */
    active: SyncProgress;
    /** Every service's latest progress: the primary record. */
    byService: Record<string, SyncProgress>;
}

/**
 * The one store of sync progress (UI health #2). Only `useSync` writes it (`setActiveProgress`,
 * `setServiceProgress`); views read it through a selector, so a progress tick re-renders the views
 * that show progress (the sync dialog, the inline first-sync view, the chat header pill) and
 * nothing else. It replaced the progress state `App` held, which re-rendered the whole UI every
 * second while a sync ran. The source of truth is `byService`; `active` is a derived view of it.
 */
export const useSyncProgressStore = create<SyncProgressState>()(() => ({ active: IDLE_PROGRESS, byService: {} }));

export function setActiveProgress(progress: SyncProgress): void {
    useSyncProgressStore.setState({ active: progress });
}

export function setServiceProgress(
    update: Record<string, SyncProgress> | ((prev: Record<string, SyncProgress>) => Record<string, SyncProgress>),
): void {
    useSyncProgressStore.setState((s) => ({ byService: typeof update === 'function' ? update(s.byService) : update }));
}

/** Tests and logout-like resets: back to idle, no services. */
export function resetSyncProgressStore(): void {
    useSyncProgressStore.setState({ active: IDLE_PROGRESS, byService: {} });
}

export const selectIsSyncing = (s: SyncProgressState): boolean => s.active.state === 'running';
