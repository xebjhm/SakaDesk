import { useEffect } from 'react';

export const MEMORIES_UI_DEBOUNCE_MS = 300;

type MemoriesUiState = { open: boolean; focused: boolean };

const isFocused = () => document.hasFocus() && document.visibilityState === 'visible';

/** POST the state; never throws. `onFail` runs when the post failed or was rejected. */
function postMemoriesState(body: MemoriesUiState, onFail: () => void): void {
    try {
        fetch('/api/ui-state/memories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
            .then((res) => {
                if (!res.ok) {
                    console.debug('[memoriesUiState] rejected', res.status);
                    onFail();
                }
            })
            .catch((err) => {
                console.debug('[memoriesUiState] failed', err);
                onFail();
            });
    } catch (err) {
        console.debug('[memoriesUiState] failed', err);
        onFail();
    }
}

/**
 * Tell the backend whether Memories is in view (POST /api/ui-state/memories), so Memories
 * notifications are held while the fan is already looking at Memories. While mounted it reports
 * `{open: true, focused}` (`focused` = the window has focus and the document is visible),
 * debounced 300 ms after mount and after every focus / blur / visibility change, and only when
 * the state differs from the last one sent; a failed post forgets that state so the next change
 * resends. On unmount it reports `{open: false, focused}` at once. Failures are swallowed.
 */
export function useMemoriesUiReporter(): void {
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let lastSent: MemoriesUiState | null = null;

        const send = (body: MemoriesUiState) => {
            lastSent = body;
            postMemoriesState(body, () => {
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
            send({ open: false, focused: isFocused() });
        };
    }, []);
}
