export const MEDIA_API_BASE = '/api/content/media';

/**
 * URL for an archived media file. `mediaFile` is relative to the service dir
 * (e.g. "messages/62 石森 璃花/.../voice/346492.m4a"); each path segment is
 * encoded so spaces and CJK survive, slashes are kept.
 */
export function buildMediaUrl(service: string, mediaFile: string, apiBase: string = MEDIA_API_BASE): string {
    return `${apiBase}/${encodeURIComponent(service)}/${mediaFile.split('/').map(encodeURIComponent).join('/')}`;
}

export const AVATAR_API_BASE = '/api/content/avatar';

/**
 * Widths the backend avatar route accepts, ascending (mirrors
 * `avatar_resize.ALLOWED_WIDTHS`). 16 px steps up to 128 keep the pick close at
 * common display scales: 64 CSS px at 125 / 150 / 175 / 200 % is 80 / 96 / 112 /
 * 128 device px; 40 CSS px at 175 % is 70 → 80.
 */
export const AVATAR_WIDTHS = [64, 80, 96, 112, 128, 160, 192, 256] as const;

export type AvatarWidth = typeof AVATAR_WIDTHS[number];

/**
 * The allowed width for an avatar drawn at `cssPx` CSS px on a screen with
 * device pixel ratio `dpr`: the smallest one at or above `cssPx × dpr` (rounded
 * up, so the browser only ever shrinks it a little and never enlarges it),
 * or the largest one when nothing is big enough. A missing / invalid `dpr`
 * counts as 1; float noise below 0.01 px is ignored.
 *
 * This is a JS pick rather than `srcset`: Chromium (WebView2) chooses a srcset
 * candidate by the geometric mean of neighbouring densities, so at 125 % it
 * would pick the 1x image and enlarge it (soft). Re-pick when the ratio
 * changes (window moved to another monitor, zoom) with `useAvatarWidth`.
 */
export function avatarWidthFor(cssPx: number, dpr: number): AvatarWidth {
    const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const needed = Math.ceil(cssPx * ratio - 0.01);
    return AVATAR_WIDTHS.find(w => w >= needed) ?? AVATAR_WIDTHS[AVATAR_WIDTHS.length - 1];
}

/**
 * Downscaled variant of an archived avatar, for avatars drawn small (member
 * list, chat messages, chat header, letters, gallery / favourites headers);
 * pick `width` with `avatarWidthFor` / `useAvatarWidth` for the drawn size.
 * Only URLs served by the media route (`/api/content/media/...`, i.e. local
 * archived files) are rewritten to `/api/content/avatar/...?w=<width>`; CDN and
 * other URLs are returned unchanged, and empty input gives `undefined`.
 */
export function resizedAvatarUrl(url: string | null | undefined, width: AvatarWidth): string | undefined {
    if (!url) return undefined;
    const prefix = `${MEDIA_API_BASE}/`;
    if (!url.startsWith(prefix)) return url;
    const rest = url.slice(prefix.length);
    return `${AVATAR_API_BASE}/${rest}${rest.includes('?') ? '&' : '?'}w=${width}`;
}

export const THUMB_API_BASE = '/api/content/thumb';

/** Longest-side bounds the thumbnail route accepts (mirrors `photo_thumb.ALLOWED_WIDTHS`). */
export const THUMB_WIDTHS = [160, 320, 480, 640] as const;

export type ThumbWidth = typeof THUMB_WIDTHS[number];

/**
 * The width the background worker pre-generates for every picture (`photo_thumb.PREGEN_WIDTHS`).
 * Grid tiles never ask for more, so they hit the pre-generated variant; 320 / 160 derive from it.
 */
export const THUMB_PREGEN_WIDTH = 480;
/** The extra width pre-generated for ★ items and album covers (`photo_thumb.LARGE_WIDTH`). */
export const THUMB_LARGE_WIDTH = 640;

/**
 * The allowed thumbnail width for a picture drawn at `cssPx` CSS px (its longest side) on a
 * screen with device pixel ratio `dpr`: the smallest one covering `cssPx × dpr`, capped at
 * `THUMB_PREGEN_WIDTH` (480; a few % upscale is invisible and the 480 is pre-generated). Pass
 * `large: true` for ★ items and album covers, which may use `THUMB_LARGE_WIDTH` (640). A
 * missing / invalid `dpr` counts as 1 (as `avatarWidthFor`).
 */
export function thumbWidthFor(cssPx: number, dpr: number, opts: { large?: boolean } = {}): ThumbWidth {
    const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const needed = Math.ceil(cssPx * ratio - 0.01);
    const cap = opts.large ? THUMB_LARGE_WIDTH : THUMB_PREGEN_WIDTH;
    const allowed = THUMB_WIDTHS.filter(w => w <= cap);
    return allowed.find(w => w >= needed) ?? allowed[allowed.length - 1];
}

/**
 * A downscaled WebP of an archived picture (`/api/content/thumb/...?w=<width>`), for grids and
 * small stills; the media viewer keeps the full file. Only media-route URLs are rewritten
 * (others are returned unchanged); empty input gives `undefined`. The route answers 404 for
 * anything it cannot thumbnail (videos included), so callers fall back to the full URL on error.
 *
 * `v` is the file's content version (12 hex chars, from `/api/media/meta`). When given it is
 * appended as `&v=`, and a matching `v` makes the route answer `Cache-Control: immutable`
 * (a stale one gets `no-cache` with the current variant); without it the URL is unchanged
 * and the route keeps its one-day cache.
 */
export function thumbnailUrl(url: string | null | undefined, width: ThumbWidth, v?: string): string | undefined {
    if (!url) return undefined;
    const prefix = `${MEDIA_API_BASE}/`;
    if (!url.startsWith(prefix)) return url;
    const rest = url.slice(prefix.length);
    const version = v ? `&v=${encodeURIComponent(v)}` : '';
    return `${THUMB_API_BASE}/${rest}${rest.includes('?') ? '&' : '?'}w=${width}${version}`;
}
