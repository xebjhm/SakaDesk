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

/** Widths the backend avatar route accepts (`avatar_resize.ALLOWED_WIDTHS`). */
export type AvatarWidth = 64 | 128 | 192 | 256;

/**
 * Downscaled variant of an archived avatar. Only URLs served by the media
 * route (`/api/content/media/...`, i.e. local archived files) are rewritten to
 * `/api/content/avatar/...?w=<width>`; CDN and other URLs are returned
 * unchanged, and empty input gives `undefined`.
 */
export function resizedAvatarUrl(url: string | null | undefined, width: AvatarWidth): string | undefined {
    if (!url) return undefined;
    const prefix = `${MEDIA_API_BASE}/`;
    if (!url.startsWith(prefix)) return url;
    const rest = url.slice(prefix.length);
    return `${AVATAR_API_BASE}/${rest}${rest.includes('?') ? '&' : '?'}w=${width}`;
}
