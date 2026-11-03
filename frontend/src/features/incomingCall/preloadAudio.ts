export const PRELOAD_TIMEOUT_MS = 10_000;

/**
 * Load an audio file far enough to play. Resolves on `canplay`; rejects on
 * `error`, when nothing happens within `timeoutMs`, or when `signal` aborts
 * (`Error('aborted')`). pysaka writes `media_file` when the download is
 * queued, so a URL may 404 until the file is on disk; ringing only after this
 * succeeds avoids a call with no voice.
 *
 * A failed or aborted preload clears `src` and calls `load()` so the browser
 * drops the in-flight download, and removes its listeners.
 */
export function preloadAudio(
    url: string,
    signal?: AbortSignal,
    timeoutMs: number = PRELOAD_TIMEOUT_MS,
): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('aborted'));
            return;
        }
        const audio = new Audio();
        let settled = false;
        const onCanPlay = () => settle(true);
        const onError = () => settle(false);
        const onAbort = () => settle(false, 'aborted');
        const settle = (ok: boolean, reason = 'media_unavailable') => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('error', onError);
            signal?.removeEventListener('abort', onAbort);
            if (ok) {
                resolve();
            } else {
                audio.removeAttribute('src');
                audio.load();
                reject(new Error(reason));
            }
        };
        const timer = setTimeout(() => settle(false), timeoutMs);
        audio.addEventListener('canplay', onCanPlay);
        audio.addEventListener('error', onError);
        signal?.addEventListener('abort', onAbort);
        audio.preload = 'auto';
        audio.src = url;
    });
}
