import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copyImageToClipboard, copyVideoToClipboard } from './clipboard';

describe('copyImageToClipboard', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('should fetch image, convert to PNG blob, and write to clipboard', async () => {
        // Use a plain Blob as stand-in for the source image (no real canvas needed)
        const sourceBlob = new Blob(['fake-image-data'], { type: 'image/jpeg' });
        const pngBlob = new Blob(['fake-png-data'], { type: 'image/png' });

        // Mock fetch to return image blob
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            blob: () => Promise.resolve(sourceBlob),
        });
        vi.stubGlobal('fetch', mockFetch);

        // Mock URL.createObjectURL / revokeObjectURL so Image.src assignment works
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn().mockReturnValue('blob:fake-url'),
            revokeObjectURL: vi.fn(),
        });

        // Mock canvas.getContext to return a minimal 2D context stub
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            drawImage: vi.fn(),
        } as unknown as CanvasRenderingContext2D);

        // Mock canvas.toBlob to synchronously return a PNG blob
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
            function (callback: BlobCallback) {
                callback(pngBlob);
            },
        );

        // Mock HTMLImageElement so img.onload fires when src is set
        const origImage = globalThis.Image;
        class FakeImage {
            naturalWidth = 1;
            naturalHeight = 1;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_: string) {
                // Trigger onload asynchronously (mirrors real browser behaviour)
                setTimeout(() => this.onload?.(), 0);
            }
        }
        vi.stubGlobal('Image', FakeImage);

        // Mock clipboard
        const mockWrite = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { write: mockWrite },
            writable: true,
            configurable: true,
        });

        // Mock ClipboardItem
        vi.stubGlobal('ClipboardItem', class {
            constructor(public items: Record<string, Blob>) {}
        });

        await copyImageToClipboard('/api/content/media/test.jpg');

        expect(mockFetch).toHaveBeenCalledWith('/api/content/media/test.jpg');
        expect(mockWrite).toHaveBeenCalledTimes(1);

        vi.stubGlobal('Image', origImage);
    });

    it('should throw on fetch failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

        await expect(copyImageToClipboard('/bad-url')).rejects.toThrow();
    });
});

describe('copyVideoToClipboard', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('should POST to /api/content/clipboard with the media URL', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ ok: true }),
        });
        vi.stubGlobal('fetch', mockFetch);

        await copyVideoToClipboard('/api/content/media/test.mp4');

        expect(mockFetch).toHaveBeenCalledWith('/api/content/clipboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media_url: '/api/content/media/test.mp4' }),
        });
    });

    it('should throw when backend returns ok: false', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ ok: false, error: 'file_not_found' }),
        }));

        await expect(copyVideoToClipboard('/api/content/media/test.mp4')).rejects.toThrow();
    });

    it('should throw when backend returns non-200', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 501,
        }));

        await expect(copyVideoToClipboard('/api/content/media/test.mp4')).rejects.toThrow();
    });
});
