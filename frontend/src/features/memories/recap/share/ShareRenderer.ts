/**
 * Deterministic Canvas 2D renderer of the recap share export (spec §9.5).
 *
 * Scenes (video, 12 s): 0–1.5 s year and member; 1.5–3.5 s star clock and peak hour;
 * 3.5–6 s frosted collage (or the colour record) and the photo count; 6–8 s a whitelisted
 * greeting and its count; 8–10 s the special-day stubs (dates and times only); 10–12 s the
 * share poster. The GIF drops the stubs and plays the rest in 8 s (see `buildTimeline`).
 *
 * Every frame is a pure function of (model, assets, options, time): no randomness (the collage
 * uses a seeded generator), no clock, no network. Each scene fades in over {@link ENTER_MS}
 * and the star clock fills over {@link CLOCK_FILL_MS}; after that a scene holds still, so the
 * GIF export can merge held frames.
 *
 * Obfuscation: the renderer draws photos only through {@link isFrosted} images (tiny blurred
 * copies made by `sharePhotos.ts`), composed into a collage layer blurred again by
 * {@link COLLAGE_BLUR_PX} (scaled) under an {@link HAZE_ALPHA} white haze. Any other image
 * handed to it is ignored. The only unfrosted image it can draw is the fan's own avatar, and
 * only when the fan turned it on. Colours come from design-token CSS variables
 * ({@link readSharePalette}) or from the photos' sampled month colours; none is a literal.
 */
import { fontFamily } from '../../../../design/tokens/type';
import { readCssVar } from '../posterImage';
import { buildTimeline, sceneAt, timelineMs, type Scene, type SceneKind, type ShareFormat, type ShareModel, type ShareStyle } from './shareModel';
import { browserCanvasEnv, isFrosted, markFrosted, type CanvasEnv, type FrostedImage, type MonthColour } from './sharePhotos';

/** Logical stage size (9:16); the GIF is drawn at this size, the PNG at 2×. */
export const SHARE_WIDTH = 540;
export const SHARE_HEIGHT = 960;
/** A collage thumbnail is at most this share of the stage width. */
export const COLLAGE_MAX_TILE_RATIO = 0.18;
/** Collage blur in logical pixels (multiplied by the render scale). */
export const COLLAGE_BLUR_PX = 6;
/** Opacity of the white haze over the collage. */
export const HAZE_ALPHA = 0.08;
/** Fade-in of each scene. */
export const ENTER_MS = 400;
/** The star clock's stars appear over this time. */
export const CLOCK_FILL_MS = 800;
const MAX_TILT = (8 * Math.PI) / 180;
const PANEL_ALPHA = 0.82;

/** The colours the renderer uses, read from the design tokens. */
export interface SharePalette {
    backgroundTop: string;
    backgroundBottom: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    haze: string;
    card: string;
    border: string;
    star: string;
    peak: string;
}

/**
 * The palette from the design tokens' CSS variables. The background's lower end is the
 * context's subtle accent (the member's group: identity); everything else is neutral.
 */
export function readSharePalette(el?: Element): SharePalette {
    const v = (name: string) => readCssVar(name, el);
    return {
        backgroundTop: v('--ds-surface-sheet'),
        backgroundBottom: v('--ds-accent-subtle'),
        text: v('--ds-text-primary'),
        textSecondary: v('--ds-text-secondary'),
        textMuted: v('--ds-text-muted'),
        haze: v('--ds-surface-card'),
        card: v('--ds-surface-card'),
        border: v('--ds-border-subtle'),
        star: v('--ds-text-secondary'),
        peak: v('--ds-text-primary'),
    };
}

/** Font stacks: the UI's display serif and sans, and the Japanese serif for her words. */
export interface ShareFonts {
    display: string;
    sans: string;
    quote: string;
}

export function readShareFonts(el?: Element): ShareFonts {
    return {
        display: readCssVar('--ds-font-family-serif', el) || fontFamily.reading,
        sans: readCssVar('--ds-font-family-sans', el) || fontFamily.sansJp,
        quote: fontFamily.reading,
    };
}

export interface RenderAssets {
    photos: FrostedImage[];
    months: MonthColour[];
    /** The fan's own chosen image; drawn only when the model says so. */
    avatar?: CanvasImageSource | null;
}

export interface RendererOptions {
    format: ShareFormat;
    /** Pixels per logical pixel (1 for the GIF, 2 for the PNG). */
    scale?: number;
    palette: SharePalette;
    fonts: ShareFonts;
    env?: CanvasEnv;
}

/** The scenes that have something to show. */
export function availableScenes(model: ShareModel, assets: Pick<RenderAssets, 'photos' | 'months'>, style: ShareStyle): Set<SceneKind> {
    const out = new Set<SceneKind>();
    if (model.clock) out.add('clock');
    if (style === 'collage' ? assets.photos.length > 0 : assets.months.length > 0) out.add('photos');
    if (model.greeting) out.add('greeting');
    if (model.stubs) out.add('stubs');
    return out;
}

/** Mulberry32: a small seeded generator in [0, 1). */
function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export interface CollageTile {
    /** Centre, in logical pixels. */
    x: number;
    y: number;
    size: number;
    /** Radians, within ±8°. */
    rotation: number;
    /** Share of this tile its right-hand neighbour covers (30–50%). */
    overlap: number;
    /** Index into the photos. */
    image: number;
}

/**
 * The collage: rows of small tilted thumbnails (each ≤ 18% of the stage width) that overlap
 * their neighbours by 30–50%, covering `width` × `height`. Photos repeat to fill the area.
 */
export function collageLayout(count: number, seed: number, width: number, height: number): CollageTile[] {
    if (count <= 0) return [];
    const rand = seeded(seed);
    const max = width * COLLAGE_MAX_TILE_RATIO;
    const tiles: CollageTile[] = [];
    let y = max * 0.3;
    let row = 0;
    while (y - max / 2 < height) {
        let x = row % 2 ? max * 0.2 : -max * 0.1;
        let rowStep = max;
        while (x - max / 2 < width) {
            const size = max * (0.82 + 0.18 * rand());
            const overlap = 0.3 + 0.2 * rand();
            const rotation = (rand() * 2 - 1) * MAX_TILT;
            tiles.push({ x, y, size, rotation, overlap, image: Math.floor(rand() * count) });
            x += size * (1 - overlap);
            rowStep = Math.min(rowStep, size * (1 - overlap));
        }
        y += rowStep;
        row += 1;
    }
    return tiles;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (v: number) => 1 - (1 - v) * (1 - v);

/** Breaks text into lines of at most `maxWidth` (by character: Japanese has no spaces). */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
    const lines: string[] = [];
    for (const para of text.split(/\r?\n/)) {
        let line = '';
        for (const ch of Array.from(para)) {
            if (line && ctx.measureText(line + ch).width > maxWidth) {
                lines.push(line);
                line = ch;
            } else {
                line += ch;
            }
        }
        lines.push(line);
    }
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    const last = Array.from(kept[maxLines - 1]);
    kept[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 1)).join('')}…`;
    return kept;
}

/** Angle of a JST clock time: 0:00 at the top, clockwise over 24 hours (as the slide's dial). */
function angleOf(h: number, m: number): number {
    return ((h * 60 + m) / 1440) * 2 * Math.PI - Math.PI / 2;
}

const STAR_R: Record<string, number> = { text: 1.3, picture: 1.7, video: 1.7, voice: 1.9 };

export class ShareRenderer {
    readonly timeline: Scene[];
    readonly durationMs: number;
    private readonly scale: number;
    private readonly env: CanvasEnv;
    private layer: FrostedImage | null | undefined;

    constructor(
        private readonly model: ShareModel,
        private readonly assets: RenderAssets,
        private readonly opts: RendererOptions,
    ) {
        this.scale = opts.scale ?? 1;
        this.env = opts.env ?? browserCanvasEnv;
        this.timeline = buildTimeline(availableScenes(model, assets, model.style), opts.format);
        this.durationMs = timelineMs(this.timeline);
    }

    /** Frames of the whole timeline at `fps`. */
    frameCount(fps: number): number {
        return Math.round((this.durationMs * fps) / 1000);
    }

    drawFrame(ctx: CanvasRenderingContext2D, index: number, fps: number): void {
        this.drawAt(ctx, (index * 1000) / fps);
    }

    /** The share poster, fully entered (the share PNG). */
    drawPoster(ctx: CanvasRenderingContext2D): void {
        this.drawAt(ctx, this.durationMs - 1);
    }

    drawAt(ctx: CanvasRenderingContext2D, tMs: number): void {
        const s = this.scale;
        ctx.setTransform(s, 0, 0, s, 0, 0);
        ctx.globalAlpha = 1;
        ctx.filter = 'none';
        this.background(ctx);
        const scene = sceneAt(this.timeline, tMs);
        const local = Math.max(0, tMs - scene.startMs);
        ctx.globalAlpha = Number(easeOut(clamp01(local / ENTER_MS)).toFixed(3));
        const fill = Number(easeOut(clamp01(local / CLOCK_FILL_MS)).toFixed(3));
        switch (scene.kind) {
            case 'title': this.title(ctx); break;
            case 'clock': this.clockScene(ctx, fill); break;
            case 'photos': this.photosScene(ctx); break;
            case 'greeting': this.greetingScene(ctx); break;
            case 'stubs': this.stubsScene(ctx); break;
            case 'poster': this.posterScene(ctx); break;
        }
        ctx.globalAlpha = 1;
    }

    // -----------------------------------------------------------------------------------------

    private font(ctx: CanvasRenderingContext2D, family: keyof ShareFonts, size: number, weight = 400): void {
        ctx.font = `${weight} ${size}px ${this.opts.fonts[family]}`;
    }

    private text(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string, align: CanvasTextAlign = 'center'): void {
        ctx.fillStyle = colour;
        ctx.textAlign = align;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(text, x, y);
    }

    private lines(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, maxLines: number, leading: number, colour: string, align: CanvasTextAlign = 'center'): number {
        const lines = wrapText(ctx, text, maxWidth, maxLines);
        lines.forEach((line, i) => this.text(ctx, line, x, y + i * leading, colour, align));
        return lines.length * leading;
    }

    private background(ctx: CanvasRenderingContext2D): void {
        const p = this.opts.palette;
        const g = ctx.createLinearGradient(0, 0, 0, SHARE_HEIGHT);
        g.addColorStop(0, p.backgroundTop);
        g.addColorStop(1, p.backgroundBottom);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT);
    }

    private panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
        const alpha = ctx.globalAlpha;
        ctx.globalAlpha = alpha * PANEL_ALPHA;
        ctx.fillStyle = this.opts.palette.card;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 16);
        ctx.fill();
        ctx.globalAlpha = alpha;
    }

    /** The collage layer: frosted photos composed once, blurred again, under the haze. */
    private collageLayer(): FrostedImage | null {
        if (this.layer !== undefined) return this.layer;
        const photos = this.assets.photos.filter((p) => isFrosted(p));
        if (!photos.length) {
            this.layer = null;
            return null;
        }
        const s = this.scale;
        const canvas = this.env.createCanvas(SHARE_WIDTH * s, SHARE_HEIGHT * s);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            this.layer = null;
            return null;
        }
        ctx.setTransform(s, 0, 0, s, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.filter = `blur(${COLLAGE_BLUR_PX * s}px)`;
        for (const tile of collageLayout(photos.length, this.model.seed, SHARE_WIDTH, SHARE_HEIGHT)) {
            ctx.save();
            ctx.translate(tile.x, tile.y);
            ctx.rotate(tile.rotation);
            ctx.drawImage(photos[tile.image], -tile.size / 2, -tile.size / 2, tile.size, tile.size);
            ctx.restore();
        }
        ctx.filter = 'none';
        ctx.globalAlpha = HAZE_ALPHA;
        ctx.fillStyle = this.opts.palette.haze;
        ctx.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT);
        ctx.globalAlpha = 1;
        this.layer = markFrosted(canvas);
        return this.layer;
    }

    private drawCollage(ctx: CanvasRenderingContext2D): void {
        const layer = this.collageLayer();
        if (layer && isFrosted(layer)) ctx.drawImage(layer, 0, 0, SHARE_WIDTH, SHARE_HEIGHT);
    }

    /** Monthly rings: January innermost; months without photos are not drawn. */
    private colourRecord(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
        const step = radius / 13;
        ctx.lineCap = 'round';
        for (const m of this.assets.months) {
            ctx.strokeStyle = m.colour;
            ctx.lineWidth = step * 0.72;
            ctx.beginPath();
            ctx.arc(cx, cy, step * (m.month + 0.5), 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    private backdrop(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
        if (this.model.style === 'collage') this.drawCollage(ctx);
        else this.colourRecord(ctx, cx, cy, radius);
    }

    private starClock(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, fill: number): void {
        const clock = this.model.clock;
        if (!clock) return;
        const p = this.opts.palette;
        const inner = radius * 0.3;
        const k = radius / 100;
        if (clock.glow) {
            const a = angleOf(clock.peakHour, 30);
            const alpha = ctx.globalAlpha;
            ctx.globalAlpha = alpha * 0.12;
            ctx.fillStyle = p.peak;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, a - Math.PI / 24, a + Math.PI / 24);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = alpha;
        }
        ctx.fillStyle = p.textMuted;
        for (let q = 0; q < 4; q++) {
            const a = (q * Math.PI) / 2 - Math.PI / 2;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * radius * 1.06, cy + Math.sin(a) * radius * 1.06, 1.6 * k, 0, Math.PI * 2);
            ctx.fill();
        }
        const shown = Math.ceil(clock.stars.length * fill);
        clock.stars.slice(0, shown).forEach((star, i) => {
            const a = angleOf(star.h, star.m);
            const r = inner + (radius - inner) * ((i * 0.618034 + 0.31) % 1);
            ctx.fillStyle = clock.glow && star.h === clock.peakHour ? p.peak : p.star;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, (STAR_R[star.type] ?? 1.3) * k, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    // Scenes ----------------------------------------------------------------------------------

    private title(ctx: CanvasRenderingContext2D): void {
        const p = this.opts.palette;
        const m = this.model.title;
        this.font(ctx, 'display', 104, 600);
        this.text(ctx, m.year, SHARE_WIDTH / 2, 420, p.text);
        this.font(ctx, 'quote', 36, 500);
        this.text(ctx, m.member, SHARE_WIDTH / 2, 490, p.text);
        this.font(ctx, 'sans', 18);
        this.text(ctx, m.tagline, SHARE_WIDTH / 2, 540, p.textSecondary);
    }

    private clockScene(ctx: CanvasRenderingContext2D, fill: number): void {
        const p = this.opts.palette;
        const clock = this.model.clock;
        if (!clock) return;
        this.starClock(ctx, SHARE_WIDTH / 2, 390, 190, fill);
        this.font(ctx, 'sans', 18);
        this.lines(ctx, clock.label, SHARE_WIDTH / 2, 680, 440, 2, 26, p.textSecondary);
        if (clock.value) {
            this.font(ctx, 'display', 52, 600);
            this.text(ctx, clock.value, SHARE_WIDTH / 2, 760, p.text);
        }
    }

    private photosScene(ctx: CanvasRenderingContext2D): void {
        const p = this.opts.palette;
        this.backdrop(ctx, SHARE_WIDTH / 2, 400, 240);
        const ph = this.model.photos;
        this.panel(ctx, 50, 680, SHARE_WIDTH - 100, ph.line ? 150 : 96);
        this.font(ctx, 'sans', 18);
        this.text(ctx, ph.label, SHARE_WIDTH / 2, 734, p.textSecondary);
        if (ph.line) {
            this.font(ctx, 'display', 26, 600);
            this.lines(ctx, ph.line, SHARE_WIDTH / 2, 784, SHARE_WIDTH - 140, 2, 34, p.text);
        }
    }

    private greetingScene(ctx: CanvasRenderingContext2D): void {
        const p = this.opts.palette;
        const g = this.model.greeting;
        if (!g) return;
        this.font(ctx, 'display', 80, 600);
        this.lines(ctx, g.word, SHARE_WIDTH / 2, 440, SHARE_WIDTH - 60, 2, 96, p.text);
        this.font(ctx, 'sans', 20);
        this.lines(ctx, g.line, SHARE_WIDTH / 2, 560, SHARE_WIDTH - 100, 3, 30, p.textSecondary);
    }

    private stubsScene(ctx: CanvasRenderingContext2D): void {
        const p = this.opts.palette;
        const stubs = this.model.stubs;
        if (!stubs) return;
        this.font(ctx, 'display', 34, 600);
        this.text(ctx, stubs.label, SHARE_WIDTH / 2, 250, p.text);
        stubs.items.slice(0, 4).forEach((stub, i) => {
            const y = 320 + i * 130;
            this.panel(ctx, 80, y, SHARE_WIDTH - 160, 104);
            ctx.strokeStyle = p.border;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 5]);
            ctx.beginPath();
            ctx.roundRect(80, y, SHARE_WIDTH - 160, 104, 16);
            ctx.stroke();
            ctx.setLineDash([]);
            this.font(ctx, 'sans', 16);
            this.lines(ctx, stub.label, SHARE_WIDTH / 2, y + 38, SHARE_WIDTH - 200, 1, 20, p.textSecondary);
            this.font(ctx, 'display', 32, 600);
            this.text(ctx, stub.value, SHARE_WIDTH / 2, y + 82, p.text);
        });
    }

    private posterScene(ctx: CanvasRenderingContext2D): void {
        const p = this.opts.palette;
        const m = this.model;
        this.backdrop(ctx, SHARE_WIDTH / 2, 380, 230);
        this.font(ctx, 'display', 64, 600);
        this.text(ctx, m.title.year, 40, 116, p.text, 'left');
        this.font(ctx, 'quote', 28, 500);
        this.text(ctx, m.title.member, 40, 160, p.text, 'left');
        this.font(ctx, 'sans', 16);
        this.text(ctx, m.title.tagline, 40, 190, p.textSecondary, 'left');
        if (m.clock) this.starClock(ctx, SHARE_WIDTH - 90, 116, 54, 1);

        const sentences = m.poster.sentences;
        if (sentences.length) {
            this.font(ctx, 'quote', 24, 500);
            const heights = sentences.map((s) => wrapText(ctx, s, SHARE_WIDTH - 140, 3).length * 36);
            const total = heights.reduce((a, b) => a + b, 0) + (sentences.length - 1) * 24 + 56;
            const top = 790 - total;
            this.panel(ctx, 40, top, SHARE_WIDTH - 80, total);
            let y = top + 28 + 26;
            sentences.forEach((s, i) => {
                this.lines(ctx, s, SHARE_WIDTH / 2, y, SHARE_WIDTH - 140, 3, 36, p.text);
                y += heights[i] + 24;
            });
        }

        const avatar = m.poster.avatar ? this.assets.avatar ?? null : null;
        const textX = avatar ? 104 : 40;
        if (avatar) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(64, 858, 28, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(avatar, 36, 830, 56, 56);
            ctx.restore();
        }
        if (m.poster.withLine) {
            this.font(ctx, 'sans', 18, 500);
            this.text(ctx, m.poster.withLine, textX, 852, p.text, 'left');
        }
        if (m.poster.years) {
            this.font(ctx, 'sans', 14);
            this.text(ctx, m.poster.years, textX, 878, p.textSecondary, 'left');
        }
        if (m.poster.footer) {
            this.font(ctx, 'sans', 14, 600);
            this.text(ctx, m.poster.footer, SHARE_WIDTH / 2, 932, p.textMuted);
        }
    }
}
