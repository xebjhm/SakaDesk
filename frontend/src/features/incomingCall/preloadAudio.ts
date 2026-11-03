export const PRELOAD_TIMEOUT_MS = 10_000;

/**
 * Load an audio file far enough to play. Resolves on `canplay`; rejects on
 * `error` or when nothing happens within `timeoutMs`. pysaka writes
 * `media_file` when the download is queued, so a URL may 404 until the file
 * is on disk; ringing only after this succeeds avoids a call with no voice.
 */
export function preloadAudio(url: string, timeoutMs: number = PRELOAD_TIMEOUT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
        const audio = new Audio();
        let settled = false;
        const settle = (ok: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (ok) {
                resolve();
            } else {
                audio.removeAttribute('src');
                audio.load();
                reject(new Error('media_unavailable'));
            }
        };
        const timer = setTimeout(() => settle(false), timeoutMs);
        audio.addEventListener('canplay', () => settle(true), { once: true });
        audio.addEventListener('error', () => settle(false), { once: true });
        audio.preload = 'auto';
        audio.src = url;
    });
}
