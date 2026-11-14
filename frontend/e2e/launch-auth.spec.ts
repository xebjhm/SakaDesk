import { expect, test, type Page } from '@playwright/test'
import { E2E_API_TOKEN } from './apiToken'

// The real launch-auth path (security audit 2026-11-13). The config's X-SakaDesk-Token header
// is turned off here, so the page must authenticate the way SakaDesk's windows do: the #t=
// fragment moves into sessionStorage, the fetch wrapper sends it as a header, and the bootstrap
// cookie covers plain GETs (<img>, <video>, downloads) that cannot carry a header.
test.use({ extraHTTPHeaders: {} })

const CLIENT_LOG_BODY = JSON.stringify({ event: 'dialog', fields: {} })

/** A POST through window.fetch, which launchAuth wraps to add the token header. */
function wrappedFetchPost(page: Page): Promise<number> {
    return page.evaluate(async (body) => {
        const res = await fetch('/api/client-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        })
        return res.status
    }, CLIENT_LOG_BODY)
}

/** An XMLHttpRequest, which the wrapper does not touch: only the cookie can authenticate it. */
function xhrStatus(page: Page, method: 'GET' | 'POST', url: string): Promise<number> {
    return page.evaluate(
        ([m, u, body]) =>
            new Promise<number>((resolve) => {
                const xhr = new XMLHttpRequest()
                xhr.open(m, u)
                if (m === 'POST') xhr.setRequestHeader('Content-Type', 'application/json')
                xhr.onloadend = () => resolve(xhr.status)
                xhr.send(m === 'POST' ? body : null)
            }),
        [method, url, CLIENT_LOG_BODY] as const,
    )
}

test('a window opened with #t= authenticates fetches, cookie GETs and reloads', async ({ page }) => {
    const bootstrap = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/session/bootstrap')
    await page.goto(`/#t=${E2E_API_TOKEN}`)
    expect((await bootstrap).status()).toBe(200)

    // The token leaves the address bar as soon as the page has read it.
    const href = await page.evaluate(() => window.location.href)
    expect(new URL(href).hash).not.toContain('t=')
    expect(href).not.toContain(E2E_API_TOKEN)

    expect(await wrappedFetchPost(page)).toBe(204)
    expect(await xhrStatus(page, 'GET', '/api/settings')).toBe(200)
    // The cookie never authorizes a change.
    expect(await xhrStatus(page, 'POST', '/api/client-log')).toBe(401)

    // A reload has no fragment: the token comes back from this window's sessionStorage.
    await page.reload()
    expect(await page.evaluate(() => window.location.hash)).toBe('')
    expect(await wrappedFetchPost(page)).toBe(204)
})

test('a page opened without #t= and without the header gets 401', async ({ page }) => {
    await page.goto('/')
    expect(await page.evaluate(async () => (await fetch('/api/settings')).status)).toBe(401)
    expect(await xhrStatus(page, 'GET', '/api/settings')).toBe(401)
})
