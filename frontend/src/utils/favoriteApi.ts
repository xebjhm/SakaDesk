/**
 * The one client for the ★ favourite of a message (`POST` / `DELETE /api/favorites/{id}?service=`),
 * shared by the chat and Memories so both write the same favourite (the Memories binder and
 * favourites caches follow through the room data hash).
 */

/**
 * Set (`on`) or clear a message's favourite. Resolves `true` when the server saved it, `false` on
 * an HTTP error, a network failure, or a 200 whose body says `success: false` (SD-CONTRACT-01:
 * the backend answers 200 with `{success: false, error}` when the upstream official-API call
 * fails, e.g. an expired session; checking only `res.ok` would leave an optimistic star lit for a
 * favourite that was never saved). A 200 without a readable body counts as saved. Rejects only
 * with an `AbortError` when `signal` aborts, also while the body is being read (never `true`).
 */
export async function setFavorite(service: string, messageId: number, on: boolean, signal?: AbortSignal): Promise<boolean> {
    const url = `/api/favorites/${messageId}?service=${encodeURIComponent(service)}`;
    let res: Response;
    try {
        res = await fetch(url, { method: on ? 'POST' : 'DELETE', signal });
    } catch (err) {
        if (signal?.aborted) throw err;
        return false;
    }
    if (!res.ok) return false;
    const body = await readBody(res, signal);
    return !(body && body.success === false);
}

/** The JSON body, or null when unreadable; rejects with an `AbortError` once `signal` aborts. */
function readBody(res: Response, signal?: AbortSignal): Promise<{ success?: boolean } | null> {
    const read = res.json().catch(() => null) as Promise<{ success?: boolean } | null>;
    if (!signal) return read;
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        if (signal.aborted) {
            onAbort();
            return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        void read.then((body) => {
            signal.removeEventListener('abort', onAbort);
            // An abort that broke the read surfaces here as an unreadable (null) body.
            if (signal.aborted) onAbort();
            else resolve(body);
        });
    });
}
