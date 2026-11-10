/**
 * Photos of the share export (spec §9.5): frosted thumbnails and the colour record.
 *
 * **No raw member photo or avatar ever reaches the share renderer.** A photo is read once,
 * drawn into a canvas at most {@link FROST_SOURCE_PX} pixels on a side with a blur filter, and
 * only that tiny copy is kept (a {@link FrostedImage}). Even where the canvas `filter` is not
 * supported, nothing finer than 32 × 32 pixels survives; the collage then scales it up with
 * another blur. The renderer accepts only images registered by this module ({@link isFrosted}).
 * Avatars are never loaded here at all.
 *
 * Sources: the s05 photo wall (media URLs spread over the year in time order, without
 * timestamps) and the poster's start / mid / recent photos (with timestamps).
 *
 * Colour record: each photo's average colour, grouped by the JST month of its message. The wall
 * items carry no timestamp, so they are spread evenly, in their order, over the months of the
 * recap window ({@link assignMonths}); timed photos use their real month. A month with no photo
 * is simply not drawn (the export never shows an absence).
 */
import type { RecapPayload, S05PhotosData } from '../api';

/** Longest side of the only copy of a photo the export keeps. */
export const FROST_SOURCE_PX = 32;
/** Blur applied while shrinking (in pixels of the tiny copy). */
const FROST_SOURCE_BLUR_PX = 1;
/** Side of the canvas a photo's average colour is sampled on. */
const SAMPLE_PX = 8;
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

function sizeOf(src: CanvasImageSource): { w: number; h: number } {
    const s = src as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
    return { w: s.naturalWidth || s.width || 0, h: s.naturalHeight || s.height || 0 };
}

/**
 * The frosted copy of a photo: its centre square shrunk to {@link FROST_SOURCE_PX} with a blur.
 * Returns null for an empty image or when no 2D context is available.
 */
export function frostImage(src: CanvasImageSource, env: CanvasEnv = browserCanvasEnv): FrostedImage | null {
    const { w, h } = sizeOf(src);
    if (w <= 0 || h <= 0) return null;
    const side = Math.min(w, h);
    const canvas = env.createCanvas(FROST_SOURCE_PX, FROST_SOURCE_PX);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.filter = `blur(${FROST_SOURCE_BLUR_PX}px)`;
    ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, FROST_SOURCE_PX, FROST_SOURCE_PX);
    ctx.filter = 'none';
    return markFrosted(canvas);
}

/** The mean colour of the opaque pixels of RGBA data, or null when none is opaque. */
export function averageColour(data: ArrayLike<number>): [number, number, number] | null {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n += 1;
    }
    return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
}

/** A colour sampled from a photo as a CSS hex string (data, not a design literal). */
export function colourHex(rgb: [number, number, number]): string {
    return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/** The JST month (1–12) of a UTC ISO timestamp, or null. */
export function jstMonth(ts: string): number | null {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return Number(new Intl.DateTimeFormat('en-CA', { month: 'numeric', timeZone: 'Asia/Tokyo' }).format(d));
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

/** One averaged colour per month that has photos, in month order. */
export function monthlyColours(samples: { month: number; rgb: [number, number, number] }[]): MonthColour[] {
    const sums = new Map<number, { r: number; g: number; b: number; n: number }>();
    for (const s of samples) {
        const acc = sums.get(s.month) ?? { r: 0, g: 0, b: 0, n: 0 };
        acc.r += s.rgb[0];
        acc.g += s.rgb[1];
        acc.b += s.rgb[2];
        acc.n += 1;
        sums.set(s.month, acc);
    }
    return [...sums.entries()]
        .sort(([a], [b]) => a - b)
        .map(([month, a]) => ({ month, colour: colourHex([a.r / a.n, a.g / a.n, a.b / a.n]) }));
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

function sample(src: CanvasImageSource, env: CanvasEnv): [number, number, number] | null {
    const canvas = env.createCanvas(SAMPLE_PX, SAMPLE_PX);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0, SAMPLE_PX, SAMPLE_PX);
    return averageColour(ctx.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data);
}

export interface ShareAssets {
    /** Frosted photos for the collage. */
    photos: FrostedImage[];
    /** The colour record's months. */
    months: MonthColour[];
    /** Photos that could not be read (a log count). */
    skipped: number;
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
    const samples: { month: number; rgb: [number, number, number] }[] = [];
    let skipped = 0;
    loaded.forEach((img, i) => {
        const frost = img ? frostImage(img, env) : null;
        if (!img || !frost) {
            skipped += 1;
            return;
        }
        photos.push(frost);
        const rgb = sample(frost, env);
        if (rgb) samples.push({ month: months[i], rgb });
    });
    return { photos, months: monthlyColours(samples), skipped };
}
