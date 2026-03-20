import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadMedia } from './download';
import { formatDownloadFilename } from './classnames';

describe('download + filename integration', () => {
    let iframeSrcs: string[];
    let appendChildSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        iframeSrcs = [];
        appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
            const el = node as HTMLIFrameElement;
            if (el.tagName === 'IFRAME') {
                iframeSrcs.push(el.getAttribute('src') || '');
            }
            return node;
        });
        vi.useFakeTimers();
    });

    afterEach(() => {
        appendChildSpy.mockRestore();
        vi.useRealTimers();
    });

    it('message photo: correct download URL with timestamp filename', () => {
        const mediaUrl = '/api/content/media/hinatazaka46/messages%5C90%20%E9%AB%98%E4%BA%95%5Cpicture%5C444767.jpg';
        const timestamp = '2026-03-18T12:21:00Z';
        const filename = formatDownloadFilename(mediaUrl, timestamp);

        // Filename should be just "444767.jpg" with timestamp, not the full path
        expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}_444767\.jpg$/);

        downloadMedia(mediaUrl, filename);
        expect(iframeSrcs[0]).toContain('/api/content/download/');
        expect(iframeSrcs[0]).toContain('filename=');
    });

    it('message video: correct download URL', () => {
        const mediaUrl = '/api/content/media/hinatazaka46/messages%5C90%5Cvideo%5C444491.mp4';
        const timestamp = '2026-03-16T16:32:00Z';
        const filename = formatDownloadFilename(mediaUrl, timestamp);

        expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}_444491\.mp4$/);

        downloadMedia(mediaUrl, filename);
        expect(iframeSrcs[0]).toContain('/api/content/download/');
    });

    it('blog image: correct download URL with image index', () => {
        const mediaUrl = '/api/blogs/image?service=hinatazaka46&blog_id=68404&filename=img_0.jpg';
        const timestamp = '2026-03-18T23:00:00Z';
        const filename = formatDownloadFilename(mediaUrl, timestamp);

        // Should extract "img_0.jpg" from query param, not "image" from path
        expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}_img_0\.jpg$/);

        downloadMedia(mediaUrl, filename);
        // Should route to blog image endpoint with download param, NOT proxy
        expect(iframeSrcs[0]).toContain('/api/blogs/image?');
        expect(iframeSrcs[0]).toContain('download=');
        expect(iframeSrcs[0]).not.toContain('proxy-image');
    });

    it('blog image with absolute URL: strips origin before routing', () => {
        const savedOrigin = window.location.origin;

        // In jsdom, window.location is special; use the href setter to change origin
        Object.defineProperty(window, 'location', {
            value: { ...window.location, origin: 'http://127.0.0.1:11803' },
            writable: true,
            configurable: true,
        });

        const mediaUrl = 'http://127.0.0.1:11803/api/blogs/image?service=hinatazaka46&blog_id=68404&filename=img_0.jpg';
        const filename = formatDownloadFilename(mediaUrl, '2026-03-18T23:36:00Z');

        expect(filename).toMatch(/img_0\.jpg$/);

        downloadMedia(mediaUrl, filename);
        // Must NOT go through proxy — origin should be stripped
        expect(iframeSrcs[0]).toContain('/api/blogs/image?');
        expect(iframeSrcs[0]).not.toContain('proxy-image');

        // Restore
        Object.defineProperty(window, 'location', {
            value: new URL(savedOrigin),
            writable: true,
            configurable: true,
        });
    });

    it('external blog image: routes through proxy', () => {
        const mediaUrl = 'https://cdn.hinatazaka46.com/images/photo_001.jpg';
        const filename = formatDownloadFilename(mediaUrl, '2026-03-18T12:00:00Z');

        expect(filename).toMatch(/photo_001\.jpg$/);

        downloadMedia(mediaUrl, filename);
        expect(iframeSrcs[0]).toContain('/api/blogs/proxy-image?url=');
    });
});
