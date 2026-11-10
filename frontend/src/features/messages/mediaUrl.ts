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
export const THUMB_WIDTHS = [160, 320, 640] as const;

export type ThumbWidth = typeof THUMB_WIDTHS[number];

/**
 * The allowed thumbnail width for a picture drawn at `cssPx` CSS px (its longest side) on a
 * screen with device pixel ratio `dpr`: the smallest one covering `cssPx × dpr`, else the
 * largest. A missing / invalid `dpr` counts as 1 (as `avatarWidthFor`).
 */
export function thumbWidthFor(cssPx: number, dpr: number): ThumbWidth {
    const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const needed = Math.ceil(cssPx * ratio - 0.01);
    return THUMB_WIDTHS.find(w => w >= needed) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
}

/**
 * A downscaled WebP of an archived picture (`/api/content/thumb/...?w=<width>`), for grids and
 * small stills; the media viewer keeps the full file. Only media-route URLs are rewritten
 * (others are returned unchanged); empty input gives `undefined`. The route answers 404 for
 * anything it cannot thumbnail (videos included), so callers fall back to the full URL on error.
 */
export function thumbnailUrl(url: string | null | undefined, width: ThumbWidth): string | undefined {
    if (!url) return undefined;
    const prefix = `${MEDIA_API_BASE}/`;
    if (!url.startsWith(prefix)) return url;
    const rest = url.slice(prefix.length);
    return `${THUMB_API_BASE}/${rest}${rest.includes('?') ? '&' : '?'}w=${width}`;
}
