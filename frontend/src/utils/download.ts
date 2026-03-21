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
 * - https://...             → /api/blogs/proxy-image?url=...&download=filename (external)
 * - other local URLs        → append ?download=filename
 */
export function downloadMedia(url: string, filename: string): void {
    // Strip local origin so absolute URLs like http://127.0.0.1:PORT/api/...
    // match the relative-path branches below (blog images use absolute URLs).
    let localUrl = url;
    if (localUrl.startsWith(window.location.origin)) {
        localUrl = localUrl.slice(window.location.origin.length);
    }

    let downloadUrl: string;

    if (localUrl.startsWith('/api/content/media/')) {
        // Local message media: rewrite to download endpoint
        downloadUrl = localUrl.replace('/api/content/media/', '/api/content/download/')
            + `?filename=${encodeURIComponent(filename)}`;
    } else if (localUrl.startsWith('/api/blogs/image')) {
        // Local cached blog image: add download param to existing endpoint
        const sep = localUrl.includes('?') ? '&' : '?';
        downloadUrl = `${localUrl}${sep}download=${encodeURIComponent(filename)}`;
    } else if (localUrl.startsWith('http://') || localUrl.startsWith('https://')) {
        // External URL: go through proxy
        downloadUrl = `/api/blogs/proxy-image?url=${encodeURIComponent(localUrl)}&download=${encodeURIComponent(filename)}`;
    } else {
        // Other local API URLs
        const sep = localUrl.includes('?') ? '&' : '?';
        downloadUrl = `${localUrl}${sep}download=${encodeURIComponent(filename)}`;
    }

    // Hidden iframe triggers the webview's native download dialog
    // without navigating away or opening the system browser.
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = downloadUrl;
    document.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), 60000);
}
