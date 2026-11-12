/**
 * Per-launch API authentication for SakaDesk's own windows (security audit 2026-11-13).
 *
 * desktop.py opens each window at `http://127.0.0.1:<port>/#t=<token>`. The token
 * proves to the local backend that a request comes from SakaDesk's UI and not
 * from another program, Windows account or web page on this PC. It is moved out
 * of the URL into sessionStorage (so it survives a reload of this window only),
 * sent as a header on every same-origin `/api/` fetch, and swapped once for an
 * HttpOnly cookie that <img>, <video> and download requests carry.
 */

export const TOKEN_HEADER = 'X-SakaDesk-Token'
const STORAGE_KEY = 'sakadesk.launchToken'
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/

type LocationLike = Pick<Location, 'hash' | 'pathname' | 'search'>
type HistoryLike = Pick<History, 'replaceState' | 'state'>
type WindowLike = Pick<Window, 'fetch' | 'location'>

/** sessionStorage, or null where reading it throws. */
export function sessionStorageOrNull(): Storage | null {
    try {
        return window.sessionStorage
    } catch {
        return null
    }
}

/**
 * The launch token from the URL fragment (then stripped, other fragment segments kept
 * verbatim) or from this window's storage. `onStoreFailed` is called (no arguments, so it
 * can never see the token) when the fragment token could not be written to storage: the
 * token is still returned for this load, but a reload of the window would have none.
 */
export function takeLaunchToken(
    loc: LocationLike,
    storage: Storage | null,
    history: HistoryLike,
    onStoreFailed?: () => void,
): string | null {
    const rawHash = loc.hash.replace(/^#/, '')
    const fromHash = new URLSearchParams(rawHash).get('t')
    if (fromHash !== null && TOKEN_RE.test(fromHash)) {
        try {
            storage?.setItem(STORAGE_KEY, fromHash)
        } catch {
            // Storage unavailable: the header still works for this load.
            onStoreFailed?.()
        }
        const rest = rawHash
            .split('&')
            .filter((segment) => !segment.startsWith('t='))
            .join('&')
        history.replaceState(history.state, '', `${loc.pathname}${loc.search}${rest ? `#${rest}` : ''}`)
        return fromHash
    }
    try {
        const stored = storage?.getItem(STORAGE_KEY) ?? null
        return stored !== null && TOKEN_RE.test(stored) ? stored : null
    } catch {
        return null
    }
}

function requestUrl(input: RequestInfo | URL): string {
    if (input instanceof Request) return input.url
    if (input instanceof URL) return input.href
    return String(input)
}

/** Add the token header to every same-origin `/api/` fetch made through `win.fetch`. */
export function installApiAuth(token: string, win: WindowLike = window): void {
    const original = win.fetch.bind(win)
    win.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        let url: URL
        try {
            url = new URL(requestUrl(input), win.location.href)
        } catch {
            // Unparseable: let the native fetch produce its normal rejected promise.
            return original(input, init)
        }
        if (url.origin !== new URL(win.location.href).origin || !url.pathname.startsWith('/api/')) {
            return original(input, init)
        }
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
        headers.set(TOKEN_HEADER, token)
        return original(input, { ...init, headers })
    }
}

/** Swap the header for the HttpOnly media cookie. Never throws. */
export async function bootstrapApiCookie(fetchImpl: typeof fetch = fetch): Promise<boolean> {
    try {
        const res = await fetchImpl('/api/session/bootstrap', { method: 'POST' })
        return res.ok
    } catch {
        return false
    }
}
