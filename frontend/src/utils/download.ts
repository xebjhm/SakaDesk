/**
 * Download a media file by fetching it as a blob and triggering a save dialog.
 *
 * For same-origin URLs (our API), fetches directly.
 * For external URLs (blog images), routes through the backend proxy to bypass CORS.
 */
export async function downloadMedia(url: string, filename: string): Promise<void> {
    let fetchUrl = url;
    // External URLs need to go through our proxy to bypass CORS
    if (url.startsWith('http://') || url.startsWith('https://')) {
        fetchUrl = `/api/blogs/proxy-image?url=${encodeURIComponent(url)}`;
    }
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(blobUrl);
}
