export const MEDIA_API_BASE = '/api/content/media';

/**
 * URL for an archived media file. `mediaFile` is relative to the service dir
 * (e.g. "messages/62 石森 璃花/.../voice/346492.m4a"); each path segment is
 * encoded so spaces and CJK survive, slashes are kept.
 */
export function buildMediaUrl(service: string, mediaFile: string, apiBase: string = MEDIA_API_BASE): string {
    return `${apiBase}/${encodeURIComponent(service)}/${mediaFile.split('/').map(encodeURIComponent).join('/')}`;
}
