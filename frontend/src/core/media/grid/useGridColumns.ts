import { useLayoutEffect, useState, type RefObject } from 'react';
import { MEDIA_GRID_GAP_REM, MEDIA_GRID_MAX_COLS, MEDIA_TILE_MIN_REM } from '../tileGrid';

export interface GridColumnOptions {
    /** Narrowest tile, px (default `MEDIA_TILE_MIN_REM`, 9rem). */
    minTilePx?: number;
    /**
     * Widest tile, px. Unset (the default) follows `tileGrid.ts`: as many columns as fit at the
     * minimum tile, at most `MEDIA_GRID_MAX_COLS` (6). Set, the columns are
     * `ceil((width + gap) / (max + gap))`, reduced while a tile would be narrower than the minimum.
     */
    maxTilePx?: number;
    /** Gap between tiles, px (default `MEDIA_GRID_GAP_REM`, 0.5rem). */
    gapPx?: number;
    /** px per rem (default: the root font size, else 16). */
    remPx?: number;
}

export interface GridColumns {
    cols: number;
    /** One tile's edge in CSS px (`floor((width - gap × (cols - 1)) / cols)`). */
    tilePx: number;
}

/** The root font size in px (16 when unknown). */
export function rootRemPx(): number {
    if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return 16;
    const size = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(size) && size > 0 ? size : 16;
}

/**
 * The columns and tile size of a media grid `width` px wide. The defaults are `tileGrid.ts`'s
 * (tiles ≥ 9rem, ≤ 6 per row, a 0.5rem gap), so it matches `mediaGridColumns` and the album's
 * CSS grid. A zero width gives one column of 0 px. Pure.
 */
export function gridColumns(width: number, opts: GridColumnOptions = {}): GridColumns {
    const rem = opts.remPx ?? 16;
    const gap = opts.gapPx ?? MEDIA_GRID_GAP_REM * rem;
    const min = opts.minTilePx ?? MEDIA_TILE_MIN_REM * rem;
    if (!(width > 0)) return { cols: 1, tilePx: 0 };
    const tile = (cols: number) => (width - gap * (cols - 1)) / cols;
    let cols: number;
    if (opts.maxTilePx === undefined) {
        const capped = tile(MEDIA_GRID_MAX_COLS);
        const track = Math.max(min, capped);
        // The epsilon absorbs float error at an exact fit (as `mediaGridColumns`).
        cols = Math.min(MEDIA_GRID_MAX_COLS, Math.max(1, Math.floor((width + gap) / (track + gap) + 1e-9)));
    } else {
        cols = Math.max(1, Math.ceil((width + gap) / (opts.maxTilePx + gap)));
        while (cols > 1 && tile(cols) < min) cols -= 1;
    }
    return { cols, tilePx: Math.max(0, Math.floor(tile(cols))) };
}

/**
 * The columns and tile size of the grid wrapper in `ref`, kept current by a `ResizeObserver` (its
 * content width). Before the first measure (or without `ResizeObserver`) the wrapper's
 * `clientWidth` is used; a width still unknown lays out one minimum-size tile per row.
 */
export function useGridColumns(ref: RefObject<HTMLElement | null>, opts: GridColumnOptions = {}): GridColumns & { width: number } {
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        setWidth(el.clientWidth);
        if (typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (entry) setWidth(Math.floor(entry.contentRect.width));
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref]);
    const rem = opts.remPx ?? rootRemPx();
    const layout = gridColumns(width, { ...opts, remPx: rem });
    if (width > 0) return { ...layout, width };
    return { cols: 1, tilePx: Math.round(opts.minTilePx ?? MEDIA_TILE_MIN_REM * rem), width };
}
