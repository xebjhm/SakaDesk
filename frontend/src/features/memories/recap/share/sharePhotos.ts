/**
 * Photos of the share export (spec §9.5): frosted thumbnails and the colour record.
 *
 * **No raw member photo or avatar ever reaches the share renderer.** A photo is read once,
 * drawn into a canvas at most {@link FROST_SOURCE_PX} pixels on a side with a blur filter, and
 * only that tiny copy is kept (a {@link FrostedImage}). Where the canvas `filter` is not
 * supported ({@link canvasFilterSupported}, probed once per canvas factory), nothing finer than
 * 32 × 32 pixels survives either, and the copy is box-blurred by repeated downscale / upscale
 * ({@link boxBlurByRescale}) instead; {@link ShareAssets.blurFallback} reports it so the caller
 * can leave a breadcrumb. The collage then scales the copies up with another blur. The renderer
 * accepts only images registered by this module ({@link isFrosted}). Avatars are never loaded
 * here at all.
 *
 * Sources: the s05 photo wall (media URLs spread over the year in time order, without
 * timestamps) and the poster's start / mid / recent photos (with timestamps).
 *
 * Colour record: each month's dominant colour (the most common bucket of a coarse colour
 * histogram over every photo of the month, near-white and near-black ignored; see
 * {@link colourBuckets}), grouped by the JST month of its message. The wall
 * items carry no timestamp, so they are spread evenly, in their order, over the months of the
 * recap window ({@link assignMonths}); timed photos use their real month. A month with no photo
 * is simply not drawn (the export never shows an absence).
 */
import { jstNow } from '../../shared/jst';
import type { RecapPayload, S05PhotosData } from '../api';

/** Longest side of the only copy of a photo the export keeps. */
export const FROST_SOURCE_PX = 32;
/** Blur applied while shrinking (in pixels of the tiny copy). */
const FROST_SOURCE_BLUR_PX = 1;
/** Side of the canvas a photo's colours are sampled on (the frosted copy's own size). */
const SAMPLE_PX = 32;
/** Downscale factors of the box blur used where the canvas `filter` is unsupported. */
export const FROST_FALLBACK_PASSES = [3, 2] as const;
/** Levels per channel of the colour histogram (8 → buckets 32 values wide). */
const BUCKET_LEVELS = 8;
/** A pixel whose channels are all at least this is near-white and ignored. */
const NEAR_WHITE = 232;
/** A pixel whose channels are all at most this is near-black and ignored. */
const NEAR_BLACK = 24;
/** At most this many photos are read for one export. */
export const MAX_SHARE_PHOTOS = 24;

export interface CanvasEnv {
    createCanvas(width: number, height: number): HTMLCanvasElement;
}

export const browserCanvasEnv: CanvasEnv = {
    createCanvas(width, height) {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        return c;
    },
};

declare const frostedBrand: unique symbol;
/** A frosted (shrunken, blurred) photo: the only kind of photo the share renderer draws. */
export type FrostedImage = HTMLCanvasElement & { readonly [frostedBrand]: true };

const frosted = new WeakSet<object>();

/** Whether `x` was produced by this module's frosting (or a layer composed only of such images). */
export function isFrosted(x: unknown): x is FrostedImage {
    return typeof x === 'object' && x !== null && frosted.has(x);
}

/** Registers a canvas composed only of frosted images (the collage layer). */
export function markFrosted(canvas: HTMLCanvasElement): FrostedImage {
    frosted.add(canvas);
    return canvas as FrostedImage;
}

const filterSupport = new WeakMap<CanvasEnv, boolean>();

/**
 * Whether this canvas factory's 2D contexts honour `filter`, probed once per factory on `ctx` (a
 * context it made) by setting a blur and reading it back. The probe leaves `filter` at `none`.
 */
export function canvasFilterSupported(ctx: CanvasRenderingContext2D, env: CanvasEnv = browserCanvasEnv): boolean {
    const known = filterSupport.get(env);
    if (known !== undefined) return known;
    let ok = false;
    try {
        ctx.filter = 'blur(1px)';
        ok = ctx.filter === 'blur(1px)';
        ctx.filter = 'none';
    } catch {
        ok = false;
    }
    filterSupport.set(env, ok);
    return ok;
}

/**
 * A box blur without `filter`: the canvas is shrunk by each factor (with smoothing) into a scratch
 * canvas and drawn back up over itself. Returns false when a scratch context is unavailable.
 */
export function boxBlurByRescale(
    canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, env: CanvasEnv, factors: readonly number[],
): boolean {
    const { width: w, height: h } = canvas;
    for (const f of factors) {
        const sw = Math.max(1, Math.round(w / f));
        const sh = Math.max(1, Math.round(h / f));
        const scratch = env.createCanvas(sw, sh);
        const sctx = scratch.getContext('2d');
        if (!sctx) return false;
        sctx.imageSmoothingEnabled = true;
        sctx.drawImage(canvas, 0, 0, w, h, 0, 0, sw, sh);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(scratch, 0, 0, sw, sh, 0, 0, w, h);
        ctx.restore();
    }
    return true;
}

function sizeOf(src: CanvasImageSource): { w: number; h: number } {
    const s = src as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
    return { w: s.naturalWidth || s.width || 0, h: s.naturalHeight || s.height || 0 };
}

/**
 * The frosted copy of a photo: its centre square shrunk to {@link FROST_SOURCE_PX} with a blur
 * (the `filter` blur, or {@link boxBlurByRescale} where `filter` is unsupported). Returns null
 * for an empty image or when no 2D context is available.
 */
export function frostImage(src: CanvasImageSource, env: CanvasEnv = browserCanvasEnv): FrostedImage | null {
    const { w, h } = sizeOf(src);
    if (w <= 0 || h <= 0) return null;
    const side = Math.min(w, h);
    const canvas = env.createCanvas(FROST_SOURCE_PX, FROST_SOURCE_PX);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const filterOk = canvasFilterSupported(ctx, env);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    if (filterOk) ctx.filter = `blur(${FROST_SOURCE_BLUR_PX}px)`;
    ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, FROST_SOURCE_PX, FROST_SOURCE_PX);
    if (filterOk) ctx.filter = 'none';
    else if (!boxBlurByRescale(canvas, ctx, env, FROST_FALLBACK_PASSES)) return null;
    return markFrosted(canvas);
}

/** One bucket of the colour histogram: its pixel count and channel sums. */
export interface ColourBucket {
    n: number;
    r: number;
    g: number;
    b: number;
}

/**
 * A coarse colour histogram of RGBA data: each opaque pixel falls into one of
 * {@link BUCKET_LEVELS}³ buckets. Transparent, near-white and near-black pixels are ignored (a
 * sky, a wall or a shadow is not a photo's colour).
 */
export function colourBuckets(data: ArrayLike<number>): Map<number, ColourBucket> {
    const out = new Map<number, ColourBucket>();
    const width = 256 / BUCKET_LEVELS;
    for (let i = 0; i + 3 < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE) continue;
        if (r <= NEAR_BLACK && g <= NEAR_BLACK && b <= NEAR_BLACK) continue;
        const key = (Math.floor(r / width) * BUCKET_LEVELS + Math.floor(g / width)) * BUCKET_LEVELS + Math.floor(b / width);
        const acc = out.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        acc.n += 1;
        acc.r += r;
        acc.g += g;
        acc.b += b;
        out.set(key, acc);
    }
    return out;
}

/** Adds `from`'s counts into `into`. */
export function mergeBuckets(into: Map<number, ColourBucket>, from: Map<number, ColourBucket>): Map<number, ColourBucket> {
    for (const [key, b] of from) {
        const acc = into.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        acc.n += b.n;
        acc.r += b.r;
        acc.g += b.g;
        acc.b += b.b;
        into.set(key, acc);
    }
    return into;
}

/**
 * The dominant colour of a histogram: the mean of its most common bucket (ties go to the lower
 * bucket, so the result is deterministic), or null when every pixel was ignored.
 */
export function dominantOf(buckets: Map<number, ColourBucket>): [number, number, number] | null {
    let best: [number, ColourBucket] | null = null;
    for (const entry of buckets) {
        if (!best || entry[1].n > best[1].n || (entry[1].n === best[1].n && entry[0] < best[0])) best = entry;
    }
    if (!best) return null;
    const b = best[1];
    return [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)];
}

/** The dominant colour of RGBA data ({@link colourBuckets} then {@link dominantOf}). */
export function dominantColour(data: ArrayLike<number>): [number, number, number] | null {
    return dominantOf(colourBuckets(data));
}

/** A colour sampled from a photo as a CSS hex string (data, not a design literal). */
export function colourHex(rgb: [number, number, number]): string {
    return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/** The JST month (1–12) of a UTC ISO timestamp, or null. */
export function jstMonth(ts: string): number | null {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return jstNow(d).month;
}

export interface MonthWindow {
    first: number;
    last: number;
}

/**
 * The months the recap covers: from January, or the subscription month when the fan joined this
 * year; to December in the final recap, else the latest month a timed photo came in (December
 * when none is timed).
 */
export function monthWindow(recap: RecapPayload, timed: string[]): MonthWindow {
    const start = recap.member.subscription_start;
    const joined = start && start.startsWith(`${recap.year}-`) ? Number(start.slice(5, 7)) : 1;
    const first = joined >= 1 && joined <= 12 ? joined : 1;
    if (recap.phase === 'final') return { first, last: 12 };
    const months = timed.map(jstMonth).filter((m): m is number => m !== null);
    const last = months.length ? Math.max(first, ...months) : 12;
    return { first, last };
}

/**
 * The month of each photo: its JST month when timed; untimed photos (the wall, in time order)
 * are spread evenly over the window in their order.
 */
export function assignMonths(items: { ts: string | null }[], window: MonthWindow): number[] {
    const untimed = items.filter((i) => i.ts === null).length;
    const span = window.last - window.first + 1;
    let k = 0;
    return items.map((i) => {
        const m = i.ts !== null ? jstMonth(i.ts) : null;
        if (m !== null) return m;
        const month = window.first + Math.floor((k * span) / Math.max(1, untimed));
        k += 1;
        return month;
    });
}

export interface MonthColour {
    month: number;
    colour: string;
}

/**
 * One dominant colour per month that has photos, in month order: the histograms of the month's
 * photos are pooled and the most common bucket wins (never a mean of means, which drifts grey).
 * A month whose pixels were all ignored is not drawn.
 */
export function monthlyColours(samples: { month: number; buckets: Map<number, ColourBucket> }[]): MonthColour[] {
    const pooled = new Map<number, Map<number, ColourBucket>>();
    for (const s of samples) pooled.set(s.month, mergeBuckets(pooled.get(s.month) ?? new Map(), s.buckets));
    return [...pooled.entries()]
        .sort(([a], [b]) => a - b)
        .flatMap(([month, buckets]) => {
            const rgb = dominantOf(buckets);
            return rgb ? [{ month, colour: colourHex(rgb) }] : [];
        });
}

export interface SharePhotoSource {
    url: string;
    /** The message's UTC timestamp, or null for a wall item (which has none). */
    ts: string | null;
}

/** The photos the export may frost: the s05 wall, then the poster's start / mid / recent; each URL once. */
export function sharePhotoSources(recap: RecapPayload): SharePhotoSource[] {
    const out: SharePhotoSource[] = [];
    const seen = new Map<string, SharePhotoSource>();
    const add = (url: string | null | undefined, ts: string | null) => {
        if (!url) return;
        const known = seen.get(url);
        if (known) {
            if (known.ts === null && ts !== null) known.ts = ts;
            return;
        }
        const item = { url, ts };
        seen.set(url, item);
        out.push(item);
    };
    const s05 = recap.slides.find((s) => s.key === 's05_photos')?.data as S05PhotosData | undefined;
    for (const url of s05?.wall ?? []) add(url, null);
    for (const m of recap.poster?.start_mid_recent ?? []) if (m.type === 'picture') add(m.media_url, m.ts);
    return out.slice(0, MAX_SHARE_PHOTOS);
}

/** Loads an image same-origin (recap media is served by the local server, so canvases stay clean). */
export function loadImageElement(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image_load_failed'));
        img.src = url;
    });
}

function sample(src: CanvasImageSource, env: CanvasEnv): Map<number, ColourBucket> | null {
    const canvas = env.createCanvas(SAMPLE_PX, SAMPLE_PX);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0, SAMPLE_PX, SAMPLE_PX);
    return colourBuckets(ctx.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data);
}

export interface ShareAssets {
    /** Frosted photos for the collage. */
    photos: FrostedImage[];
    /** The colour record's months. */
    months: MonthColour[];
    /** Photos that could not be read (a log count). */
    skipped: number;
    /** True when the canvas has no `filter` and photos were box-blurred by rescaling instead. */
    blurFallback?: boolean;
}

/**
 * Reads the export's photos and keeps only their frosted copies and colours. The loaded
 * images go out of scope here; nothing raw is returned.
 */
export async function loadShareAssets(
    recap: RecapPayload,
    deps: { env?: CanvasEnv; loadImage?: (url: string) => Promise<CanvasImageSource> } = {},
): Promise<ShareAssets> {
    const env = deps.env ?? browserCanvasEnv;
    const loadImage = deps.loadImage ?? loadImageElement;
    const sources = sharePhotoSources(recap);
    const window = monthWindow(recap, sources.flatMap((s) => (s.ts ? [s.ts] : [])));
    const months = assignMonths(sources, window);
    const loaded = await Promise.all(sources.map(async (s) => {
        try {
            return await loadImage(s.url);
        } catch {
            return null;
        }
    }));
    const photos: FrostedImage[] = [];
    const samples: { month: number; buckets: Map<number, ColourBucket> }[] = [];
    let skipped = 0;
    loaded.forEach((img, i) => {
        const frost = img ? frostImage(img, env) : null;
        if (!img || !frost) {
            skipped += 1;
            return;
        }
        photos.push(frost);
        const buckets = sample(frost, env);
        if (buckets) samples.push({ month: months[i], buckets });
    });
    const blurFallback = photos.length > 0 && filterSupport.get(env) === false;
    return { photos, months: monthlyColours(samples), skipped, blurFallback };
}
