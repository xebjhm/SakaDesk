import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn(async () => document.createElement('canvas')) }));
vi.mock('../../../utils/download', () => ({ openDownloadUrl: vi.fn() }));
import { toCanvas } from 'html-to-image';
import { openDownloadUrl } from '../../../utils/download';
import {
    buildFontEmbedCSS, embedFontFaces, MAX_FONT_FACES, pickFontFaces, renderToCanvas, saveBlob, SaveError, savePng,
    unicodeRangeMatches,
} from './posterImage';

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
            if (url.includes('gone')) return new Response('', { status: 404 });
            return new Response('x', { headers: { 'Content-Type': 'font/woff2' } });
        });
        const faces = [
            "@font-face { font-family: 'A'; src: url(https://fonts.example/a.woff2) format('woff2'); }",
            "@font-face { font-family: 'B'; src: url(\"https://fonts.example/bad.woff2\") format('woff2'); }",
            "@font-face { font-family: 'C'; src: url(https://fonts.example/gone.woff2) format('woff2'); }",
        ];
        const out = await embedFontFaces(faces, 'https://fonts.example/css', { fetchImpl: fetchImpl as unknown as typeof fetch });
        expect(out.css).toContain('url(data:font/woff2;base64,');
        expect(out.css).not.toContain('bad.woff2');
        expect(out.dropped).toBe(2);
        expect([...out.reasons].sort()).toEqual(['network', 'status']);
    });

    it('drops a face whose request outlives the per-request timeout, with a timeout reason', async () => {
        const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
        const faces = ["@font-face { font-family: 'A'; src: url(https://fonts.example/slow.woff2); }"];
        const out = await embedFontFaces(faces, 'https://fonts.example/css', {
            fetchImpl: fetchImpl as unknown as typeof fetch, requestTimeoutMs: 5,
        });
        expect(out).toEqual({ css: '', dropped: 1, reasons: ['timeout'] });
        expect((fetchImpl.mock.calls[0] as unknown[])[1]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });
});


/** A poster node whose text uses one family, and stub stylesheets (one cross-origin). */
function stage(text: string, sheets: { href: string | null; css?: string }[]) {
    const node = document.createElement('div');
    node.style.fontFamily = "'Noto Serif JP'";
    node.textContent = text;
    document.body.appendChild(node);
    const list = sheets.map((sh) => ({
        href: sh.href,
        get cssRules(): CSSRuleList {
            if (sh.css === undefined) throw new DOMException('cross-origin', 'SecurityError');
            return [] as unknown as CSSRuleList;
        },
    }));
    Object.defineProperty(document, 'styleSheets', { configurable: true, get: () => list });
    return node;
}

const face = (i: number, range: string) =>
    `@font-face { font-family: 'Noto Serif JP'; src: url(https://fonts.example/${i}.woff2); unicode-range: ${range}; }`;

describe('buildFontEmbedCSS', () => {
    afterEach(() => {
        delete (document as unknown as { styleSheets?: unknown }).styleSheets;
        document.body.innerHTML = '';
    });

    it('reads a cross-origin sheet as text and inlines only the faces the text needs', async () => {
        const node = stage('あ', [{ href: 'https://fonts.example/css' }]);
        const sheet = [face(1, 'U+3000-30FF'), face(2, 'U+4E00-4E0F')].join('\n');
        const fetchImpl = vi.fn(async (url: string) => new Response(url.endsWith('/css') ? sheet : 'x'));
        const out = await buildFontEmbedCSS(node, { fetchImpl: fetchImpl as unknown as typeof fetch });
        expect(out).toEqual(expect.objectContaining({ dropped: 0, needed: 1, truncated: 0 }));
        expect(out.css).toContain('data:font/woff2;base64,');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('reports how many faces the budget cut', async () => {
        const node = stage('A', [{ href: 'https://fonts.example/css' }]);
        const sheet = Array.from({ length: MAX_FONT_FACES + 3 }, (_, i) => face(i, 'U+0041')).join('\n');
        const fetchImpl = vi.fn(async (url: string) => new Response(url.endsWith('/css') ? sheet : 'x'));
        const out = await buildFontEmbedCSS(node, { fetchImpl: fetchImpl as unknown as typeof fetch });
        expect(out.needed).toBe(MAX_FONT_FACES + 3);
        expect(out.truncated).toBe(3);
        expect(fetchImpl).toHaveBeenCalledTimes(1 + MAX_FONT_FACES);
    });

    it('rejects with a timeout when the stylesheet request stalls', async () => {
        const node = stage('A', [{ href: 'https://fonts.example/css' }]);
        const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
        await expect(buildFontEmbedCSS(node, { fetchImpl: fetchImpl as unknown as typeof fetch, requestTimeoutMs: 5 }))
            .rejects.toMatchObject({ name: 'FontTimeoutError' });
    });
});

describe('renderToCanvas', () => {
    afterEach(() => {
        delete (document as unknown as { styleSheets?: unknown }).styleSheets;
        document.body.innerHTML = '';
        vi.mocked(toCanvas).mockClear();
    });

    it('has no fallbacks when every face embeds', async () => {
        const node = stage('あ', [{ href: 'https://fonts.example/css' }]);
        const fetchImpl = vi.fn(async (url: string) => new Response(url.endsWith('/css') ? face(1, 'U+3000-30FF') : 'x'));
        const out = await renderToCanvas(node, { fetchImpl: fetchImpl as unknown as typeof fetch });
        expect(out.fontFallbacks).toEqual([]);
        expect(out.fontTruncation).toBeNull();
        expect(vi.mocked(toCanvas).mock.calls[0][1]).toEqual(expect.objectContaining({ fontEmbedCSS: expect.stringContaining('data:font/woff2') }));
    });

    it('reports every fallback at once: a timed-out face, the partial set and the budget cut', async () => {
        const node = stage('A', [{ href: 'https://fonts.example/css' }]);
        const sheet = Array.from({ length: MAX_FONT_FACES + 1 }, (_, i) => face(i, 'U+0041')).join('\n');
        const fetchImpl = vi.fn((url: string) => {
            if (url.endsWith('/css')) return Promise.resolve(new Response(sheet));
            if (url.endsWith('/0.woff2')) return new Promise<Response>(() => {});
            return Promise.resolve(new Response('x'));
        });
        const out = await renderToCanvas(node, { fetchImpl: fetchImpl as unknown as typeof fetch, requestTimeoutMs: 5 });
        expect(out.fontFallbacks).toEqual(['font_embed_timeout', 'font_partial', 'font_truncated']);
        expect(out.fontTruncation).toEqual({ needed: MAX_FONT_FACES + 1, truncated: 1 });
    });

    it('falls back to system fonts when the whole embed outlives its budget', async () => {
        const node = stage('A', [{ href: 'https://fonts.example/css' }]);
        const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
        const out = await renderToCanvas(node, { fetchImpl: fetchImpl as unknown as typeof fetch, requestTimeoutMs: 10000, fontBudgetMs: 5 });
        expect(out.fontFallbacks).toEqual(['font_embed_timeout']);
        expect(vi.mocked(toCanvas).mock.calls[0][1]).toEqual(expect.objectContaining({ fontEmbedCSS: '' }));
    });

    it('logs font_embed_failed when the stylesheet cannot be read at all', async () => {
        const node = stage('A', [{ href: 'https://fonts.example/css' }]);
        const fetchImpl = vi.fn(async () => { throw new TypeError('offline'); });
        const out = await renderToCanvas(node, { fetchImpl: fetchImpl as unknown as typeof fetch });
        expect(out.fontFallbacks).toEqual(['font_embed_failed']);
    });
});

describe('saveBlob', () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345_-';
    beforeEach(() => vi.mocked(openDownloadUrl).mockClear());

    it('posts the bytes to the local handoff and opens the download URL in the iframe', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: TOKEN })));
        await expect(savePng(blob, 'sakadesk-recap-2026-金村.png', fetchImpl as unknown as typeof fetch))
            .resolves.toEqual({ outcome: 'handed_off' });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api/memories/export?kind=png');
        expect(init).toEqual(expect.objectContaining({ method: 'POST', body: blob }));
        expect(openDownloadUrl).toHaveBeenCalledWith(
            `/api/memories/export/${TOKEN}?filename=${encodeURIComponent('sakadesk-recap-2026-金村.png')}`,
        );
    });

    it('passes the kind through for R8 exports', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: TOKEN })));
        await saveBlob(new Blob(['g']), 'gif', 'a.gif', fetchImpl as unknown as typeof fetch);
        expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('/api/memories/export?kind=gif');
    });

    it.each([
        [() => new Response('', { status: 413 }), 'export_too_large'],
        [() => new Response('', { status: 400 }), 'export_rejected'],
        [() => new Response('not json'), 'export_rejected'],
        [() => new Response(JSON.stringify({ token: '../x' })), 'export_rejected'],
    ])('rejects with a code and opens nothing on a refused handoff (%#)', async (reply, code) => {
        const fetchImpl = vi.fn(async () => reply());
        const err = await saveBlob(blob, 'png', 'a.png', fetchImpl as unknown as typeof fetch).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(SaveError);
        expect((err as SaveError).code).toBe(code);
        expect(openDownloadUrl).not.toHaveBeenCalled();
    });

    it('reports a network failure', async () => {
        const fetchImpl = vi.fn(async () => { throw new TypeError('down'); });
        await expect(saveBlob(blob, 'png', 'a.png', fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ code: 'export_network' });
    });

    it('reports a timed-out handoff', async () => {
        const fetchImpl = vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); });
        await expect(saveBlob(blob, 'png', 'a.png', fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ code: 'export_timeout' });
    });
});
