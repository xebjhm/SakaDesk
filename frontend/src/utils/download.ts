import { clientLog } from './clientLog'

/**
 * Download a media file via a hidden iframe.
 *
 * pywebview ignores both `<a download>` blob URLs and `window.open()`
 * (the latter opens the system browser).  A hidden iframe whose src
 * points to a URL returning Content-Disposition: attachment triggers
 * EdgeChromium's native download dialog without navigating away.
 *
 * Requires `webview.settings['ALLOW_DOWNLOADS'] = True` in desktop.py.
 *
 * Routing:
 * - /api/content/media/...  → /api/content/download/... (local message media)
 * - /api/blogs/image?...    → same URL + &download=filename (local cached blog image)
 * - other same-origin /api/ → append download=filename
 * - http(s) on another host → /api/blogs/proxy-image?url=...&download=filename
 * - anything else (javascript:, data:, blob:, protocol-relative, non-API paths)
 *   is refused with a `download_refused` breadcrumb (security audit 2026-11-13).
 */

/** `url` as a same-origin `/api/` path (with its query), or `null` for anything else. */
function appApiPath(url: string): string | null {
    let parsed: URL
    try {
        parsed = new URL(url, `${window.location.origin}/`)
    } catch {
        return null
    }
    if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith('/api/')) return null
    return `${parsed.pathname}${parsed.search}`
}

function refuse(): void {
    clientLog('download_refused', { reason: 'not_app_url' })
}

export function downloadMedia(url: string, filename: string): void {
    const local = appApiPath(url)
    const name = encodeURIComponent(filename)
    let downloadUrl: string
    if (local?.startsWith('/api/content/media/')) {
        downloadUrl = `${local.replace('/api/content/media/', '/api/content/download/')}?filename=${name}`
    } else if (local !== null) {
        // /api/blogs/image and other local API URLs take a download parameter.
        downloadUrl = `${local}${local.includes('?') ? '&' : '?'}download=${name}`
    } else if (/^https?:\/\//i.test(url)) {
        // External picture: through the proxy (official hosts only, server side).
        downloadUrl = `/api/blogs/proxy-image?url=${encodeURIComponent(url)}&download=${name}`
    } else {
        refuse()
        return
    }
    openDownloadUrl(downloadUrl)
}

/**
 * Open a same-origin `/api/` URL that answers with `Content-Disposition: attachment` in
 * a hidden iframe. This triggers the webview's native download dialog without
 * navigating away or opening the system browser (see {@link downloadMedia}). Any other
 * URL is refused (`download_refused`). Whether the user saves the file is not observable.
 */
export function openDownloadUrl(url: string): void {
    const local = appApiPath(url)
    if (local === null) {
        refuse()
        return
    }
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = local
    document.body.appendChild(iframe)
    setTimeout(() => iframe.remove(), 60000)
}
