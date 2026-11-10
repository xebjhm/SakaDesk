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
 * with the fetch's `AbortError` when `signal` aborts.
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
    const body = await res.json().catch(() => null) as { success?: boolean } | null;
    return !(body && body.success === false);
}
