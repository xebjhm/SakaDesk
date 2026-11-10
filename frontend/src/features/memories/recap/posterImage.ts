/**
 * Canvas helpers of the year recap: render a DOM node to a canvas or PNG, and save a PNG locally.
 *
 * Rendering goes through `html-to-image` (DOM → SVG `foreignObject` → canvas). It clones the
 * node with its computed styles (so the design tokens resolve), inlines every `<img>` as a data
 * URL and draws the SVG on a canvas. Recap media is served same-origin by the local server
 * (`/api/content/media/...`, avatars from the profile-image routes), so the canvas is never
 * tainted. Web fonts are embedded by this module rather than by the library: the Noto families
 * come from Google Fonts in about a hundred `unicode-range` slices each, and only the slices
 * that cover the node's text are fetched (from the browser cache, as they are already drawn
 * on screen) and inlined. If that fails, the image is drawn with the system fallback fonts.
 *
 * Nothing is uploaded: the PNG goes to a file the user picks (the File System Access save
 * picker) or, where there is no picker, a local blob download.
 */
import { toCanvas } from 'html-to-image';

/** Width in pixels of an exported poster (a 9:16 stage gives 1080 × 1920). */
export const POSTER_EXPORT_WIDTH = 1080;
/** Upper bound of embedded font slices (a poster's text needs far fewer). */
const MAX_FONT_FACES = 64;
/** A transparent pixel drawn in place of an image that cannot be read. */
const IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** Children marked with this attribute are left out of the image. */
export const EXCLUDE_ATTR = 'data-image-exclude';

/** A CSS custom property's computed value (canvas renderers read the tokens this way, never literals). */
export function readCssVar(name: string, el: Element = document.documentElement): string {
    return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Whether a CSS `unicode-range` value covers at least one of the code points. */
export function unicodeRangeMatches(range: string, codePoints: Set<number>): boolean {
    const spans: [number, number][] = [];
    for (const raw of range.split(',')) {
        const token = raw.trim().replace(/^u\+/i, '');
        if (!token) continue;
        let lo: number;
        let hi: number;
        if (token.includes('?')) {
            lo = parseInt(token.replace(/\?/g, '0'), 16);
            hi = parseInt(token.replace(/\?/g, 'F'), 16);
        } else if (token.includes('-')) {
            const [a, b] = token.split('-');
            lo = parseInt(a, 16);
            hi = parseInt(b.replace(/^u\+/i, ''), 16);
        } else {
            lo = hi = parseInt(token, 16);
        }
        if (Number.isFinite(lo) && Number.isFinite(hi)) spans.push([lo, hi]);
    }
    for (const cp of codePoints) {
        if (spans.some(([lo, hi]) => cp >= lo && cp <= hi)) return true;
    }
    return false;
}

function normalizeFamily(family: string): string {
    return family.trim().replace(/^['"]|['"]$/g, '').trim().toLowerCase();
}

/**
 * The `@font-face` blocks of a stylesheet text whose family is used and whose `unicode-range`
 * (when it has one) covers the text.
 */
export function pickFontFaces(cssText: string, families: Set<string>, codePoints: Set<number>): string[] {
    const out: string[] = [];
    for (const block of cssText.match(/@font-face\s*\{[^}]*\}/gi) ?? []) {
        const family = /font-family\s*:\s*([^;}]+)/i.exec(block)?.[1];
        if (!family || !families.has(normalizeFamily(family))) continue;
        const range = /unicode-range\s*:\s*([^;}]+)/i.exec(block)?.[1];
        if (range && !unicodeRangeMatches(range, codePoints)) continue;
        out.push(block);
    }
    return out;
}

const FONT_MIME: Record<string, string> = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };

function toBase64(bytes: Uint8Array): string {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    return btoa(binary);
}

async function fetchDataUrl(url: string, fetchImpl: typeof fetch): Promise<string> {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error('font_fetch_status');
    const blob = await res.blob();
    const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase() ?? '';
    const mime = FONT_MIME[ext] || blob.type || 'application/octet-stream';
    return `data:${mime};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}

/** Inlines every `url(...)` of the faces as a data URL; a face whose file cannot be read is dropped. */
export async function embedFontFaces(
    faces: string[], baseUrl: string, fetchImpl: typeof fetch = fetch,
): Promise<{ css: string; dropped: number }> {
    let dropped = 0;
    const embedded = await Promise.all(faces.map(async (face) => {
        try {
            const urls = Array.from(face.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g));
            let out = face;
            for (const m of urls) {
                if (m[2].startsWith('data:')) continue;
                const data = await fetchDataUrl(new URL(m[2], baseUrl).href, fetchImpl);
                out = out.replace(m[0], `url(${data})`);
            }
            return out;
        } catch {
            dropped += 1;
            return null;
        }
    }));
    return { css: embedded.filter((f): f is string => f !== null).join('\n'), dropped };
}

/** The font families and the code points the node's text uses. */
function usedText(node: HTMLElement): { families: Set<string>; codePoints: Set<number> } {
    const families = new Set<string>();
    for (const el of [node, ...Array.from(node.querySelectorAll('*'))]) {
        for (const f of getComputedStyle(el).fontFamily.split(',')) {
            const name = normalizeFamily(f);
            if (name) families.add(name);
        }
    }
    const codePoints = new Set<number>();
    for (const ch of node.textContent ?? '') codePoints.add(ch.codePointAt(0) as number);
    return { families, codePoints };
}

/** The `@font-face` CSS (fonts inlined) that the node's text needs. */
export async function buildFontEmbedCSS(node: HTMLElement, fetchImpl: typeof fetch = fetch): Promise<{ css: string; dropped: number }> {
    const { families, codePoints } = usedText(node);
    const sources: { css: string; base: string }[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
        const base = sheet.href ?? window.location.href;
        try {
            const faces = Array.from(sheet.cssRules).filter((r) => r.constructor.name === 'CSSFontFaceRule' || r.type === 5);
            if (faces.length) sources.push({ css: faces.map((r) => r.cssText).join('\n'), base });
        } catch {
            // A cross-origin sheet (Google Fonts) hides its rules; read its text instead.
            if (!sheet.href) continue;
            const res = await fetchImpl(sheet.href);
            if (res.ok) sources.push({ css: await res.text(), base });
        }
    }
    const parts: string[] = [];
    let dropped = 0;
    let budget = MAX_FONT_FACES;
    for (const src of sources) {
        const faces = pickFontFaces(src.css, families, codePoints).slice(0, Math.max(0, budget));
        budget -= faces.length;
        if (!faces.length) continue;
        const out = await embedFontFaces(faces, src.base, fetchImpl);
        parts.push(out.css);
        dropped += out.dropped;
    }
    return { css: parts.join('\n'), dropped };
}

/** `null`, or why the image fell back to fewer or system fonts (a log code). */
export type FontFallback = 'font_embed_failed' | 'font_partial' | null;

/**
 * Draws the node on a canvas `width` pixels wide (the height follows its aspect). Children
 * marked {@link EXCLUDE_ATTR} are left out. Rejects when the node cannot be drawn.
 */
export async function renderToCanvas(
    node: HTMLElement, opts: { width?: number } = {},
): Promise<{ canvas: HTMLCanvasElement; fontFallback: FontFallback }> {
    const width = opts.width ?? POSTER_EXPORT_WIDTH;
    await document.fonts?.ready;
    let fontEmbedCSS = '';
    let fontFallback: FontFallback = null;
    try {
        const fonts = await buildFontEmbedCSS(node);
        fontEmbedCSS = fonts.css;
        if (fonts.dropped > 0) fontFallback = 'font_partial';
    } catch {
        fontFallback = 'font_embed_failed';
    }
    const shown = node.getBoundingClientRect().width || node.offsetWidth;
    const canvas = await toCanvas(node, {
        pixelRatio: shown > 0 ? width / shown : 1,
        fontEmbedCSS,
        cacheBust: false,
        imagePlaceholder: IMAGE_PLACEHOLDER,
        filter: (n) => !(n instanceof Element && n.hasAttribute(EXCLUDE_ATTR)),
    });
    return { canvas, fontFallback };
}

/** The canvas as a PNG blob. */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png_encode_failed'))), 'image/png');
    });
}

export type SaveOutcome = 'saved' | 'cancelled' | 'downloaded';

interface SaveFilePicker {
    (opts: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }): Promise<{
        createWritable: () => Promise<{ write: (data: Blob) => Promise<void> | void; close: () => Promise<void> | void }>;
    }>;
}

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Saves a PNG locally: through the save picker (the user picks the folder) when the webview has
 * one, else as a blob download. `fallback` is a log code when the picker was there but refused.
 */
export async function savePng(blob: Blob, filename: string): Promise<{ outcome: SaveOutcome; fallback?: string }> {
    const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    let fallback: string | undefined;
    if (typeof picker === 'function') {
        try {
            const handle = await picker({ suggestedName: filename, types: [{ description: 'PNG', accept: { 'image/png': ['.png'] } }] });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return { outcome: 'saved' };
        } catch (e) {
            const name = e instanceof Error || e instanceof DOMException ? e.name : 'unknown';
            if (name === 'AbortError') return { outcome: 'cancelled' };
            fallback = `picker_${name.toLowerCase().replace(/[^a-z0-9_]/g, '')}`.slice(0, 40);
        }
    }
    downloadBlob(blob, filename);
    return fallback ? { outcome: 'downloaded', fallback } : { outcome: 'downloaded' };
}
