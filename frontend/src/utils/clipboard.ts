/**
 * Clipboard utilities for copying media to the system clipboard.
 * Used by MediaViewerModal when golden finger is active.
 */

/**
 * Copy an image to the clipboard as PNG.
 *
 * Fetches the image, draws it onto an offscreen canvas to convert
 * to PNG (Clipboard API requires image/png), and writes to clipboard.
 */
export async function copyImageToClipboard(src: string): Promise<void> {
    const response = await fetch(src);
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const sourceBlob = await response.blob();

    // Skip canvas conversion if already PNG — avoids slow re-encoding for large images
    const pngBlob = sourceBlob.type === 'image/png'
        ? sourceBlob
        : await convertToPng(sourceBlob);

    await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlob }),
    ]);
}

/**
 * Copy a video file to the Windows clipboard via the backend.
 *
 * The backend places the file on the clipboard using CF_HDROP format,
 * so it can be pasted into Discord, Telegram, file explorers, etc.
 */
export async function copyVideoToClipboard(mediaUrl: string): Promise<void> {
    const response = await fetch('/api/content/clipboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_url: mediaUrl }),
    });

    if (!response.ok) {
        throw new Error(`Clipboard API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.ok) {
        throw new Error(data.error || 'Clipboard operation failed');
    }
}

/**
 * Convert any image blob to PNG format using an offscreen canvas.
 */
function convertToPng(blob: Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to get canvas context'));
                return;
            }

            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);

            canvas.toBlob((pngBlob) => {
                if (!pngBlob) {
                    reject(new Error('Failed to convert image to PNG'));
                    return;
                }
                resolve(pngBlob);
            }, 'image/png');
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image for clipboard'));
        };

        img.src = url;
    });
}
