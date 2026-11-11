/**
 * The chat's list snapshots (`components/listSnapshot.tsx`): per room, a detached, sanitised DOM
 * copy of its message list as last painted, and its scroll position. A plain module (no React), so
 * the app store and the settings hook can forget them.
 */

/** Rooms whose last painted list is kept (detached DOM copies, a few dozen rows each). */
export const LIST_SNAPSHOT_MAX = 8;

export interface ListSnapshot {
    node: HTMLElement;
    scrollTop: number;
}

/** room key → its list as last painted (insertion order = LRU). */
const snapshots = new Map<string, ListSnapshot>();

/**
 * Make a copy inert for the document it is shown in (W1, W2):
 * - `<audio>` / `<video>` lose `src`, `preload` and their `<source>` children: a media element
 *   with a `src` starts loading even detached, and a copy is never released, so it would pin a
 *   connection per voice or video row;
 * - every `id` and `for` goes (no duplicate ids: `getElementById` would find the copy's row);
 * - `data-testid` becomes `data-snapshot-testid` (test and e2e queries see the live list only).
 */
function sanitise(root: HTMLElement): HTMLElement {
    for (const media of root.querySelectorAll<HTMLMediaElement>('audio, video')) {
        media.querySelectorAll('source').forEach((s) => s.remove());
        media.removeAttribute('src');
        media.removeAttribute('preload');
        media.removeAttribute('autoplay');
    }
    for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
        el.removeAttribute('id');
        el.removeAttribute('for');
        const testId = el.getAttribute('data-testid');
        if (testId !== null) {
            el.removeAttribute('data-testid');
            el.setAttribute('data-snapshot-testid', testId);
        }
    }
    return root;
}

/** Keep a sanitised copy of `root` (a positioned list) and its scroller's `scrollTop` for `key`. */
export function rememberListSnapshot(key: string, root: HTMLElement, scrollTop: number): void {
    snapshots.delete(key);
    snapshots.set(key, { node: sanitise(root.cloneNode(true) as HTMLElement), scrollTop });
    if (snapshots.size > LIST_SNAPSHOT_MAX) snapshots.delete(snapshots.keys().next().value!);
}

/** The room's snapshot, if any. */
export function getListSnapshot(key: string): ListSnapshot | null {
    return snapshots.get(key) ?? null;
}

/**
 * Forget every snapshot (W3): the archive the copies came from changed (an output-dir change) or a
 * service was removed. Also used by tests.
 */
export function forgetListSnapshots(): void {
    snapshots.clear();
}
