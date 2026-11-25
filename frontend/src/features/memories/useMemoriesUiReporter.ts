import { useEffect } from 'react';

export const MEMORIES_UI_DEBOUNCE_MS = 300;

type MemoriesUiState = { open: boolean; focused: boolean };

const isFocused = () => document.hasFocus() && document.visibilityState === 'visible';

/** A post that has not answered by then is aborted, so it cannot hold the queue forever. */
export const MEMORIES_UI_POST_TIMEOUT_MS = 4000;

/** POST the state; never throws or rejects. `onFail` runs when the post failed or was rejected. */
function postMemoriesState(body: MemoriesUiState, onFail: () => void): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MEMORIES_UI_POST_TIMEOUT_MS);
    const fail = (why: string, detail: unknown) => {
        console.debug(`[memoriesUiState] ${why}`, detail);
        onFail();
    };
    try {
        return fetch('/api/ui-state/memories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        })
            .then(
                (res) => { if (!res.ok) fail('rejected', res.status); },
                (err) => fail('failed', err),
            )
            .finally(() => clearTimeout(timeout));
    } catch (err) {
        clearTimeout(timeout);
        fail('failed', err);
        return Promise.resolve();
    }
}

// Posts go out one at a time, across every mount of the hook, so an older state can never land
// after a newer one (e.g. an unmount's `open: false` overtaking a remount's `open: true`).
let queueTail: Promise<void> | null = null;

function enqueuePost(body: MemoriesUiState, onFail: () => void): void {
    const run = () => postMemoriesState(body, onFail);
    const next = queueTail ? queueTail.then(run) : run();
    queueTail = next;
    void next.then(() => {
        if (queueTail === next) queueTail = null;
    });
}

/**
 * Tell the backend whether Memories is in view (POST /api/ui-state/memories), so Memories
 * notifications are held while the fan is already looking at Memories. While mounted it reports
 * `{open: true, focused}` (`focused` = the window has focus and the document is visible),
 * debounced 300 ms after mount and after every focus / blur / visibility change, and only when
 * the state differs from the last one sent; a failed post forgets that state so the next change
 * resends. On unmount it reports `{open: false, focused}` at once, unless it never reported
 * anything. Posts are serialised (each waits for the previous answer, at most
 * {@link MEMORIES_UI_POST_TIMEOUT_MS}), so they reach the backend in order. Failures are swallowed.
 */
export function useMemoriesUiReporter(): void {
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let lastSent: MemoriesUiState | null = null;
        let reported = false;

        const send = (body: MemoriesUiState) => {
            lastSent = body;
            reported = true;
            enqueuePost(body, () => {
                if (lastSent === body) lastSent = null;
            });
        };

        const report = () => {
            timer = undefined;
            const focused = isFocused();
            if (lastSent && lastSent.open && lastSent.focused === focused) return;
            send({ open: true, focused });
        };

        const schedule = () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(report, MEMORIES_UI_DEBOUNCE_MS);
        };

        schedule();
        window.addEventListener('focus', schedule);
        window.addEventListener('blur', schedule);
        document.addEventListener('visibilitychange', schedule);
        return () => {
            if (timer !== undefined) clearTimeout(timer);
            window.removeEventListener('focus', schedule);
            window.removeEventListener('blur', schedule);
            document.removeEventListener('visibilitychange', schedule);
            if (reported) send({ open: false, focused: isFocused() });
        };
    }, []);
}
