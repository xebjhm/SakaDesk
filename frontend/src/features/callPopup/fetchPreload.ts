import { PRELOAD_TIMEOUT_MS } from '../incomingCall/preloadAudio';

/**
 * The popup's voice preload: confirm the voice file is served, without an audio element.
 *
 * The popup page loads while its window is hidden, and WebView2 does not load media
 * in a hidden page (an `Audio` preload never reaches `canplay`, so B's preload always
 * timed out there). B rings only once the voice is ready so a call never has no voice;
 * here "ready" means the backend serves the file as audio, checked with a one-byte
 * ranged GET. Playback itself starts after the popup is shown, when the page is visible.
 *
 * Resolves on a 2xx audio response; rejects with `Error('media_unavailable')` on any
 * other status, a non-audio type, a network error or after `timeoutMs`, and with
 * `Error('aborted')` when `signal` aborts.
 */
export function fetchPreload(
    url: string,
    signal?: AbortSignal,
    timeoutMs: number = PRELOAD_TIMEOUT_MS,
    fetchFn: typeof fetch = fetch,
): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('aborted'));
            return;
        }
        const ctrl = new AbortController();
        let settled = false;
        const settle = (err?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            if (err) {
                ctrl.abort();
                reject(err);
            } else {
                resolve();
            }
        };
        const onAbort = () => settle(new Error('aborted'));
        const timer = setTimeout(() => settle(new Error('media_unavailable')), timeoutMs);
        signal?.addEventListener('abort', onAbort);
        fetchFn(url, { headers: { Range: 'bytes=0-0' }, signal: ctrl.signal })
            .then((res) => {
                const type = res.headers.get('content-type') ?? '';
                if (res.ok && type.startsWith('audio/')) settle();
                else settle(new Error('media_unavailable'));
            })
            .catch(() => settle(new Error('media_unavailable')));
    });
}
