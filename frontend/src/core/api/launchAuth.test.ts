import { describe, expect, it, vi } from 'vitest'
import { bootstrapApiCookie, installApiAuth, sessionStorageOrNull, takeLaunchToken, TOKEN_HEADER } from './launchAuth'

const TOKEN = 'Abc_def-0123456789xyzABCDEFGHIJ'

function memoryStorage(): Storage {
    const data = new Map<string, string>()
    return {
        get length() { return data.size },
        clear: () => data.clear(),
        getItem: (k) => data.get(k) ?? null,
        key: (i) => [...data.keys()][i] ?? null,
        removeItem: (k) => { data.delete(k) },
        setItem: (k, v) => { data.set(k, v) },
    }
}

describe('takeLaunchToken', () => {
    it('reads the fragment token, stores it and strips it from the URL', () => {
        const storage = memoryStorage()
        const history = { state: null, replaceState: vi.fn() }
        const token = takeLaunchToken({ hash: `#t=${TOKEN}`, pathname: '/', search: '?view=call-popup' }, storage, history)
        expect(token).toBe(TOKEN)
        expect(storage.getItem('sakadesk.launchToken')).toBe(TOKEN)
        expect(history.replaceState).toHaveBeenCalledWith(null, '', '/?view=call-popup')
    })

    it('keeps other fragment parameters', () => {
        const history = { state: null, replaceState: vi.fn() }
        takeLaunchToken({ hash: `#t=${TOKEN}&x=1`, pathname: '/', search: '' }, memoryStorage(), history)
        expect(history.replaceState).toHaveBeenCalledWith(null, '', '/#x=1')
    })

    it('falls back to the stored token after a reload', () => {
        const storage = memoryStorage()
        storage.setItem('sakadesk.launchToken', TOKEN)
        const history = { state: null, replaceState: vi.fn() }
        expect(takeLaunchToken({ hash: '', pathname: '/', search: '' }, storage, history)).toBe(TOKEN)
        expect(history.replaceState).not.toHaveBeenCalled()
    })

    it('rejects malformed tokens', () => {
        const history = { state: null, replaceState: vi.fn() }
        expect(takeLaunchToken({ hash: '#t=bad token', pathname: '/', search: '' }, memoryStorage(), history)).toBeNull()
        expect(takeLaunchToken({ hash: '#t=short', pathname: '/', search: '' }, null, history)).toBeNull()
    })

    it('still returns a fragment token when storage is unavailable', () => {
        const history = { state: null, replaceState: vi.fn() }
        expect(takeLaunchToken({ hash: `#t=${TOKEN}`, pathname: '/', search: '' }, null, history)).toBe(TOKEN)
    })

    it('strips a percent-encoded t key too (the token must not stay in the URL)', () => {
        const history = { state: null, replaceState: vi.fn() }
        expect(takeLaunchToken({ hash: `#%74=${TOKEN}`, pathname: '/', search: '' }, memoryStorage(), history)).toBe(TOKEN)
        expect(history.replaceState).toHaveBeenCalledWith(null, '', '/')
        const again = { state: null, replaceState: vi.fn() }
        takeLaunchToken({ hash: `#x=1&%74=${TOKEN}&t=${TOKEN}`, pathname: '/', search: '' }, memoryStorage(), again)
        expect(again.replaceState).toHaveBeenCalledWith(null, '', '/#x=1')
    })

    it('keeps a segment whose key only looks like t', () => {
        const history = { state: null, replaceState: vi.fn() }
        takeLaunchToken({ hash: `#t=${TOKEN}&tt=1&%E0=2`, pathname: '/', search: '' }, memoryStorage(), history)
        expect(history.replaceState).toHaveBeenCalledWith(null, '', '/#tt=1&%E0=2')
    })
})

describe('takeLaunchToken edge cases', () => {
    const KEY = 'sakadesk.launchToken'
    const OTHER = 'Zyx_wvu-9876543210zyxZYXWVUTSRQ'

    it('overwrites a previously stored token with a fresh fragment token', () => {
        const storage = memoryStorage()
        storage.setItem(KEY, OTHER)
        const history = { state: null, replaceState: vi.fn() }
        expect(takeLaunchToken({ hash: `#t=${TOKEN}`, pathname: '/', search: '' }, storage, history)).toBe(TOKEN)
        expect(storage.getItem(KEY)).toBe(TOKEN)
    })

    it('falls back to the stored token when the fragment token is malformed (and leaves the URL alone)', () => {
        const storage = memoryStorage()
        storage.setItem(KEY, TOKEN)
        const history = { state: null, replaceState: vi.fn() }
        expect(takeLaunchToken({ hash: '#t=bad token', pathname: '/', search: '' }, storage, history)).toBe(TOKEN)
        expect(history.replaceState).not.toHaveBeenCalled()
    })

    it('calls onStoreFailed when setItem throws and still returns the token', () => {
        const storage = memoryStorage()
        storage.setItem = () => { throw new Error('quota') }
        const history = { state: null, replaceState: vi.fn() }
        const onStoreFailed = vi.fn()
        expect(takeLaunchToken({ hash: `#t=${TOKEN}`, pathname: '/', search: '' }, storage, history, onStoreFailed)).toBe(TOKEN)
        expect(onStoreFailed).toHaveBeenCalledTimes(1)
    })

    it('does not call onStoreFailed when storing succeeds', () => {
        const history = { state: null, replaceState: vi.fn() }
        const onStoreFailed = vi.fn()
        takeLaunchToken({ hash: `#t=${TOKEN}`, pathname: '/', search: '' }, memoryStorage(), history, onStoreFailed)
        expect(onStoreFailed).not.toHaveBeenCalled()
    })

    it('preserves a non key=value fragment segment when stripping the token', () => {
        const history = { state: null, replaceState: vi.fn() }
        takeLaunchToken({ hash: `#/route&t=${TOKEN}`, pathname: '/', search: '' }, memoryStorage(), history)
        expect(history.replaceState).toHaveBeenCalledWith(null, '', '/#/route')
    })
})

describe('sessionStorageOrNull', () => {
    it('returns null when reading window.sessionStorage throws', () => {
        const spy = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
            throw new DOMException('denied', 'SecurityError')
        })
        try {
            expect(sessionStorageOrNull()).toBeNull()
        } finally {
            spy.mockRestore()
        }
    })
})

describe('installApiAuth', () => {
    function fakeWindow() {
        const seen: { url: string; headers: Headers }[] = []
        const win = {
            location: new URL('http://127.0.0.1:8765/') as unknown as Location,
            fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = input instanceof Request ? input.url : String(input)
                seen.push({ url, headers: new Headers(init?.headers) })
                return new Response('{}')
            }) as unknown as typeof fetch,
        }
        return { win, seen }
    }

    it('adds the header to same-origin /api requests and keeps existing headers', async () => {
        const { win, seen } = fakeWindow()
        installApiAuth(TOKEN, win)
        await win.fetch('/api/settings', { headers: { 'Content-Type': 'application/json' } })
        expect(seen[0].headers.get(TOKEN_HEADER)).toBe(TOKEN)
        expect(seen[0].headers.get('Content-Type')).toBe('application/json')
    })

    it('handles URL and Request inputs', async () => {
        const { win, seen } = fakeWindow()
        installApiAuth(TOKEN, win)
        await win.fetch(new URL('http://127.0.0.1:8765/api/a'))
        await win.fetch(new Request('http://127.0.0.1:8765/api/b', { headers: { 'X-Keep': '1' } }))
        expect(seen[0].headers.get(TOKEN_HEADER)).toBe(TOKEN)
        expect(seen[1].headers.get(TOKEN_HEADER)).toBe(TOKEN)
        expect(seen[1].headers.get('X-Keep')).toBe('1')
    })

    it('does not match /apix/ or the bare /api path, but resolves relative api/x', async () => {
        const { win, seen } = fakeWindow()
        installApiAuth(TOKEN, win)
        await win.fetch('/apix/foo')
        await win.fetch('/api')
        await win.fetch('api/x')
        expect(seen[0].headers.get(TOKEN_HEADER)).toBeNull()
        expect(seen[1].headers.get(TOKEN_HEADER)).toBeNull()
        expect(seen[2].headers.get(TOKEN_HEADER)).toBe(TOKEN)
    })

    it('keeps method and body alongside the added header', async () => {
        const calls: RequestInit[] = []
        const win = {
            location: new URL('http://127.0.0.1:8765/') as unknown as Location,
            fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
                calls.push(init ?? {})
                return new Response('{}')
            }) as unknown as typeof fetch,
        }
        installApiAuth(TOKEN, win)
        await win.fetch('/api/x', { method: 'POST', body: '{"a":1}' })
        expect(calls[0].method).toBe('POST')
        expect(calls[0].body).toBe('{"a":1}')
        expect(new Headers(calls[0].headers).get(TOKEN_HEADER)).toBe(TOKEN)
    })

    it('does not throw synchronously for an unparseable URL; the native promise decides', async () => {
        const win = {
            location: new URL('http://127.0.0.1:8765/') as unknown as Location,
            fetch: vi.fn(() => Promise.reject(new TypeError('bad'))) as unknown as typeof fetch,
        }
        installApiAuth(TOKEN, win)
        let promise: Promise<Response> | undefined
        expect(() => { promise = win.fetch('http://[') }).not.toThrow()
        await expect(promise).rejects.toThrow('bad')
    })

    it('never sends the token elsewhere', async () => {
        const { win, seen } = fakeWindow()
        installApiAuth(TOKEN, win)
        await win.fetch('/assets/app.js')
        await win.fetch('https://cdn.example.com/api/x')
        await win.fetch('http://127.0.0.1:9999/api/x')
        expect(seen.every((s) => s.headers.get(TOKEN_HEADER) === null)).toBe(true)
    })
})

describe('bootstrapApiCookie', () => {
    it('posts to the bootstrap route and reports success', async () => {
        const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch
        await expect(bootstrapApiCookie(fetchImpl)).resolves.toBe(true)
        expect(fetchImpl).toHaveBeenCalledWith('/api/session/bootstrap', { method: 'POST' })
    })

    it('reports failure without throwing', async () => {
        const rejecting = vi.fn(async () => { throw new Error('down') }) as unknown as typeof fetch
        const unauthorized = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch
        await expect(bootstrapApiCookie(rejecting)).resolves.toBe(false)
        await expect(bootstrapApiCookie(unauthorized)).resolves.toBe(false)
    })
})
