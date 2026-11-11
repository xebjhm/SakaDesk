/**
 * Canvas helpers of the year recap: render a DOM node to a canvas or PNG, and save an export locally.
 *
 * Rendering goes through `html-to-image` (DOM → SVG `foreignObject` → canvas). It clones the
 * node with its computed styles (so the design tokens resolve), inlines every `<img>` as a data
 * URL and draws the SVG on a canvas. Recap media is served same-origin by the local server
 * (`/api/content/media/...`, avatars from the profile-image routes), so the canvas is never
 * tainted. Web fonts are embedded by this module rather than by the library: the Noto families
 * come from Google Fonts in about a hundred `unicode-range` slices each, and only the slices
 * that cover the node's text (at most {@link MAX_FONT_FACES}) are inlined. Embedding goes to
 * the network: the Google stylesheet and each slice are fetched again, and the browser may or
 * may not answer them from its HTTP cache. Each request has a {@link FONT_FETCH_TIMEOUT_MS}
 * timeout and the whole embed a {@link FONT_BUDGET_MS} budget. When fonts cannot be embedded
 * in time (offline, a stalled network), the image is drawn with the system fallback fonts and
 * every fallback is reported as a log code.
 *
 * Saving: the desktop webview ignores `<a download>` blob URLs, so {@link saveBlob} hands the
 * bytes to the local server (`POST /api/memories/export`, held in memory only) and opens the
 * returned URL in a hidden iframe ({@link openDownloadUrl}), which opens the webview's native
 * save dialog. Nothing leaves the machine. Whether the user then saves the file is not
 * observable, so the outcome is `handed_off`, never "saved".
 */
import { toCanvas } from 'html-to-image';
import { openDownloadUrl } from '../../../utils/download';

/** Width in pixels of an exported poster (a 9:16 stage gives 1080 × 1920). */
export const POSTER_EXPORT_WIDTH = 1080;
/** Upper bound of embedded font slices (a poster's text needs far fewer). */
export const MAX_FONT_FACES = 64;
/** Timeout of one font request (stylesheet or slice). */
export const FONT_FETCH_TIMEOUT_MS = 4000;
/** Budget of the whole font embed; past it the image uses the system fonts. */
export const FONT_BUDGET_MS = 8000;
/** Timeout of the export handoff to the local server. */
export const EXPORT_POST_TIMEOUT_MS = 30000;
/** A transparent pixel drawn in place of an image that cannot be read. */
const IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** Children marked with this attribute are left out of the image. */
export const EXCLUDE_ATTR = 'data-image-exclude';
/** Elements marked with this attribute (and their children) stay on one line in the image. */
export const NOWRAP_ATTR = 'data-image-nowrap';
/**
 * Rules added to every image's embedded stylesheet. `html-to-image` copies each computed style
 * onto the clone inline, widths in px included, so a pill measured with the screen font wraps
 * (CJK breaks anywhere) when the export draws a slightly wider font. `!important` rules beat
 * those inline copies: marked elements keep one line and size to their text in the export's font.
 */
export const EXPORT_FIT_CSS =
    `[${NOWRAP_ATTR}], [${NOWRAP_ATTR}] * { white-space: nowrap !important; width: max-content !important; `
    + 'min-width: max-content !important; max-width: none !important; flex-shrink: 0 !important; }';

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

/** Thrown when a font request or the whole embed ran out of time. */
export class FontTimeoutError extends Error {
    constructor() {
        super('font_timeout');
        this.name = 'FontTimeoutError';
    }
}

/** Why one font slice was dropped (a log code). */
export type FaceDropReason = 'timeout' | 'status' | 'network';

export interface FontFetchOptions {
    fetchImpl?: typeof fetch;
    /** Per-request timeout (default {@link FONT_FETCH_TIMEOUT_MS}). */
    requestTimeoutMs?: number;
    /** Aborts every pending request (the overall budget). */
    signal?: AbortSignal;
}

/** Rejects with {@link FontTimeoutError} after `ms`; `onTimeout` runs first. */
function raceTimeout<T>(work: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            onTimeout?.();
            reject(new FontTimeoutError());
        }, ms);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** A fetch that is aborted after the per-request timeout or when the outer signal aborts. */
function fetchWithTimeout(url: string, opts: FontFetchOptions): Promise<Response> {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const outer = opts.signal;
    if (outer?.aborted) return Promise.reject(new FontTimeoutError());
    const onAbort = () => controller.abort();
    outer?.addEventListener('abort', onAbort);
    return raceTimeout(fetchImpl(url, { signal: controller.signal }), opts.requestTimeoutMs ?? FONT_FETCH_TIMEOUT_MS, onAbort)
        .catch((e: unknown) => {
            // An abort here is always one of our timeouts (per request or the overall budget).
            if (isAbort(e)) throw new FontTimeoutError();
            throw e;
        })
        .finally(() => outer?.removeEventListener('abort', onAbort));
}

/** Whether `e` is an abort (`DOMException` is not an `Error` in every runtime). */
function isAbort(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

function dropReason(e: unknown): FaceDropReason {
    if (e instanceof FontTimeoutError) return 'timeout';
    if (e instanceof Error && e.message === 'font_fetch_status') return 'status';
    return 'network';
}

function toBase64(bytes: Uint8Array): string {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    return btoa(binary);
}

async function fetchDataUrl(url: string, opts: FontFetchOptions): Promise<string> {
    const res = await fetchWithTimeout(url, opts);
    if (!res.ok) throw new Error('font_fetch_status');
    const blob = await res.blob();
    const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase() ?? '';
    const mime = FONT_MIME[ext] || blob.type || 'application/octet-stream';
    return `data:${mime};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
}

/**
 * Inlines every `url(...)` of the faces as a data URL. A face whose file cannot be read is
 * dropped, and its reason code is kept in `reasons` (one entry per dropped face).
 */
export async function embedFontFaces(
    faces: string[], baseUrl: string, opts: FontFetchOptions = {},
): Promise<{ css: string; dropped: number; reasons: FaceDropReason[] }> {
    const reasons: FaceDropReason[] = [];
    const embedded = await Promise.all(faces.map(async (face) => {
        try {
            const urls = Array.from(face.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g));
            let out = face;
            for (const m of urls) {
                if (m[2].startsWith('data:')) continue;
                const data = await fetchDataUrl(new URL(m[2], baseUrl).href, opts);
                out = out.replace(m[0], `url(${data})`);
            }
            return out;
        } catch (e) {
            reasons.push(dropReason(e));
            return null;
        }
    }));
    return { css: embedded.filter((f): f is string => f !== null).join('\n'), dropped: reasons.length, reasons };
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

export interface FontEmbedResult {
    css: string;
    /** Faces that could not be read. */
    dropped: number;
    /** One reason code per dropped face. */
    reasons: FaceDropReason[];
    /** Faces the text needs, before the {@link MAX_FONT_FACES} cut. */
    needed: number;
    /** Faces left out by the {@link MAX_FONT_FACES} cut. */
    truncated: number;
}

/**
 * The `@font-face` CSS (fonts inlined) that the node's text needs. Rejects with
 * {@link FontTimeoutError} when a stylesheet request times out.
 */
export async function buildFontEmbedCSS(node: HTMLElement, opts: FontFetchOptions = {}): Promise<FontEmbedResult> {
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
            const res = await fetchWithTimeout(sheet.href, opts);
            if (res.ok) sources.push({ css: await res.text(), base });
        }
    }
    const picked = sources.map((src) => ({ base: src.base, faces: pickFontFaces(src.css, families, codePoints) }));
    const needed = picked.reduce((n, p) => n + p.faces.length, 0);
    const parts: string[] = [];
    const reasons: FaceDropReason[] = [];
    let budget = MAX_FONT_FACES;
    for (const src of picked) {
        const faces = src.faces.slice(0, Math.max(0, budget));
        budget -= faces.length;
        if (!faces.length) continue;
        const out = await embedFontFaces(faces, src.base, opts);
        parts.push(out.css);
        reasons.push(...out.reasons);
    }
    return {
        css: parts.join('\n'),
        dropped: reasons.length,
        reasons,
        needed,
        truncated: Math.max(0, needed - MAX_FONT_FACES),
    };
}

/** Why the image fell back to fewer or system fonts (log codes; several can apply). */
export type FontFallback = 'font_embed_failed' | 'font_embed_timeout' | 'font_partial' | 'font_truncated';

export interface RenderOptions extends Omit<FontFetchOptions, 'signal'> {
    width?: number;
    /** Budget of the whole font embed (default {@link FONT_BUDGET_MS}). */
    fontBudgetMs?: number;
}

export interface RenderResult {
    canvas: HTMLCanvasElement;
    /** Every font fallback that happened, in a stable order; empty when the fonts embedded fully. */
    fontFallbacks: FontFallback[];
    /** Face counts when the {@link MAX_FONT_FACES} cut applied, else `null`. */
    fontTruncation: { needed: number; truncated: number } | null;
}

/**
 * Draws the node on a canvas `width` pixels wide (the height follows its aspect). Children
 * marked {@link EXCLUDE_ATTR} are left out; those marked {@link NOWRAP_ATTR} stay on one line
 * ({@link EXPORT_FIT_CSS}). Font embedding never blocks past its budget; it
 * degrades to system fonts instead. Rejects when the node cannot be drawn.
 */
export async function renderToCanvas(node: HTMLElement, opts: RenderOptions = {}): Promise<RenderResult> {
    const width = opts.width ?? POSTER_EXPORT_WIDTH;
    const budget = new AbortController();
    const fallbacks = new Set<FontFallback>();
    let fontEmbedCSS = '';
    let fontTruncation: RenderResult['fontTruncation'] = null;
    try {
        const work = (async () => {
            await document.fonts?.ready;
            return buildFontEmbedCSS(node, { ...opts, signal: budget.signal });
        })();
        const fonts = await raceTimeout(work, opts.fontBudgetMs ?? FONT_BUDGET_MS, () => budget.abort());
        fontEmbedCSS = fonts.css;
        if (fonts.reasons.includes('timeout')) fallbacks.add('font_embed_timeout');
        if (fonts.dropped > 0) fallbacks.add('font_partial');
        if (fonts.truncated > 0) {
            fallbacks.add('font_truncated');
            fontTruncation = { needed: fonts.needed, truncated: fonts.truncated };
        }
    } catch (e) {
        fallbacks.add(e instanceof FontTimeoutError ? 'font_embed_timeout' : 'font_embed_failed');
    } finally {
        budget.abort();
    }
    const shown = node.getBoundingClientRect().width || node.offsetWidth;
    const canvas = await toCanvas(node, {
        pixelRatio: shown > 0 ? width / shown : 1,
        fontEmbedCSS: fontEmbedCSS ? `${fontEmbedCSS}\n${EXPORT_FIT_CSS}` : EXPORT_FIT_CSS,
        cacheBust: false,
        imagePlaceholder: IMAGE_PLACEHOLDER,
        filter: (n) => !(n instanceof Element && n.hasAttribute(EXCLUDE_ATTR)),
    });
    const order: FontFallback[] = ['font_embed_failed', 'font_embed_timeout', 'font_partial', 'font_truncated'];
    return { canvas, fontFallbacks: order.filter((c) => fallbacks.has(c)), fontTruncation };
}

/** The canvas as a PNG blob. */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png_encode_failed'))), 'image/png');
    });
}

/** The export kinds the local handoff accepts (`backend/services/memories/exports.py`). */
export type ExportKind = 'png' | 'gif' | 'webm' | 'mp4';

const EXPORT_MIME: Record<ExportKind, string> = { png: 'image/png', gif: 'image/gif', webm: 'video/webm', mp4: 'video/mp4' };

/** Why a handoff failed (a log code). */
export type SaveErrorCode = 'export_rejected' | 'export_too_large' | 'export_timeout' | 'export_network' | 'export_cancelled';

export class SaveError extends Error {
    constructor(readonly code: SaveErrorCode) {
        super(code);
        this.name = 'SaveError';
    }
}

/** The only outcome: the bytes reached the local server and the save dialog URL was opened. */
export type SaveOutcome = 'handed_off';

/**
 * Saves an export: posts the bytes to the local in-memory handoff, then opens its download
 * URL in a hidden iframe so the webview shows its native save dialog. The server sanitises
 * `filename` and forces the extension to `kind`. Rejects with a {@link SaveError}. Aborting
 * `signal` aborts the upload and rejects with `export_cancelled`; no download is opened then.
 */
export async function saveBlob(
    blob: Blob, kind: ExportKind, filename: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal,
): Promise<{ outcome: SaveOutcome }> {
    if (signal?.aborted) throw new SaveError('export_cancelled');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXPORT_POST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    let res: Response;
    try {
        res = await fetchImpl(`/api/memories/export?kind=${kind}`, {
            method: 'POST',
            body: blob,
            headers: { 'Content-Type': EXPORT_MIME[kind] },
            signal: controller.signal,
        });
    } catch (e) {
        if (signal?.aborted) throw new SaveError('export_cancelled');
        throw new SaveError(isAbort(e) ? 'export_timeout' : 'export_network');
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
    if (!res.ok) throw new SaveError(res.status === 413 ? 'export_too_large' : 'export_rejected');
    let token: unknown;
    try {
        token = ((await res.json()) as { token?: unknown }).token;
    } catch {
        throw new SaveError('export_rejected');
    }
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) throw new SaveError('export_rejected');
    if (signal?.aborted) throw new SaveError('export_cancelled');
    openDownloadUrl(`/api/memories/export/${token}?filename=${encodeURIComponent(filename)}`);
    return { outcome: 'handed_off' };
}

/** {@link saveBlob} for a PNG. */
export function savePng(blob: Blob, filename: string, fetchImpl?: typeof fetch): Promise<{ outcome: SaveOutcome }> {
    return saveBlob(blob, 'png', filename, fetchImpl);
}
