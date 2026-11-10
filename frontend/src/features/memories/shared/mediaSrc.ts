import { buildMediaUrl } from '../../messages/mediaUrl';
import type { MemoryMessage } from '../types';

/** A message's media URL: the payload's `media_url`, else built from `media_file`; null without either. */
export function memoryMediaSrc(m: Pick<MemoryMessage, 'service' | 'media_url' | 'media_file'>): string | null {
    return m.media_url ?? (m.media_file ? buildMediaUrl(m.service, m.media_file) : null);
}

/** A picture or video the media viewer can show (it has a URL or a service-relative file). */
export function isViewableMedia(m: Pick<MemoryMessage, 'type' | 'service' | 'media_url' | 'media_file'>): boolean {
    return (m.type === 'picture' || m.type === 'video') && Boolean(m.media_url || m.media_file);
}

/** The viewer's source of a viewable item (`isViewableMedia`: it has a URL or a file). */
export function viewerSrc(m: Pick<MemoryMessage, 'service' | 'media_url' | 'media_file'>): string {
    return memoryMediaSrc(m) ?? '';
}
