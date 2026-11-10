import { describe, it, expect, vi, afterEach } from 'vitest';
import { embedFontFaces, pickFontFaces, savePng, unicodeRangeMatches } from './posterImage';

const cps = (s: string) => new Set(Array.from(s).map((c) => c.codePointAt(0) as number));

describe('unicodeRangeMatches', () => {
    it('matches single points, spans and wildcards', () => {
        expect(unicodeRangeMatches('U+0000-00FF, U+0131', cps('A'))).toBe(true);
        expect(unicodeRangeMatches('U+3000-30FF', cps('あ'))).toBe(true);
        expect(unicodeRangeMatches('U+4??', cps('ѐ'))).toBe(true);
        expect(unicodeRangeMatches('U+0131', cps('ı'))).toBe(true);
        expect(unicodeRangeMatches('U+3000-30FF', cps('A🌸'))).toBe(false);
    });
});

const CSS = `
@font-face { font-family: 'Noto Serif JP'; src: url(https://fonts.example/a.woff2) format('woff2'); unicode-range: U+3000-30FF; }
@font-face { font-family: 'Noto Serif JP'; src: url(https://fonts.example/b.woff2) format('woff2'); unicode-range: U+4E00-4E0F; }
@font-face { font-family: "Noto Sans"; src: url(https://fonts.example/c.woff2) format('woff2'); }
@font-face { font-family: 'Unused'; src: url(https://fonts.example/d.woff2) format('woff2'); }
`;

describe('pickFontFaces', () => {
    it('keeps only used families whose range covers the poster text', () => {
        const picked = pickFontFaces(CSS, new Set(['noto serif jp', 'noto sans']), cps('あA'));
        expect(picked).toHaveLength(2);
        expect(picked[0]).toContain('a.woff2');
        expect(picked[1]).toContain('c.woff2');
    });
});

describe('embedFontFaces', () => {
    it('inlines each font file as a data URL and drops faces that fail', async () => {
        const fetchImpl = vi.fn(async (url: string) => {
            if (url.includes('bad')) throw new Error('offline');
            return new Response('x', { headers: { 'Content-Type': 'font/woff2' } });
        });
        const faces = [
            "@font-face { font-family: 'A'; src: url(https://fonts.example/a.woff2) format('woff2'); }",
            "@font-face { font-family: 'B'; src: url(\"https://fonts.example/bad.woff2\") format('woff2'); }",
        ];
        const out = await embedFontFaces(faces, 'https://fonts.example/css', fetchImpl as unknown as typeof fetch);
        expect(out.css).toContain('url(data:font/woff2;base64,');
        expect(out.css).not.toContain('bad.woff2');
        expect(out.dropped).toBe(1);
    });
});

describe('savePng', () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    afterEach(() => {
        delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
        vi.restoreAllMocks();
    });

    it('writes through the save picker when there is one', async () => {
        const write = vi.fn();
        const close = vi.fn();
        const picker = vi.fn(async () => ({ createWritable: async () => ({ write, close }) }));
        (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker;
        await expect(savePng(blob, 'poster.png')).resolves.toEqual({ outcome: 'saved' });
        expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'poster.png' }));
        expect(write).toHaveBeenCalledWith(blob);
        expect(close).toHaveBeenCalled();
    });

    it('reports a cancelled picker without downloading', async () => {
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn(async () => {
            throw new DOMException('cancel', 'AbortError');
        });
        await expect(savePng(blob, 'poster.png')).resolves.toEqual({ outcome: 'cancelled' });
        expect(click).not.toHaveBeenCalled();
    });

    it('falls back to a blob download without a picker, or when the picker is refused', async () => {
        const anchors: HTMLAnchorElement[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { anchors.push(this); });
        URL.createObjectURL = vi.fn(() => 'blob:local/1');
        URL.revokeObjectURL = vi.fn();
        await expect(savePng(blob, 'poster.png')).resolves.toEqual({ outcome: 'downloaded' });
        expect(anchors[0].download).toBe('poster.png');
        expect(anchors[0].getAttribute('href')).toBe('blob:local/1');

        (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn(async () => {
            throw new DOMException('no', 'SecurityError');
        });
        await expect(savePng(blob, 'poster.png')).resolves.toEqual({ outcome: 'downloaded', fallback: 'picker_securityerror' });
    });
});
