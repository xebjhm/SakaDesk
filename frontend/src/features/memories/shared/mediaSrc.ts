import { buildMediaUrl } from '../../messages/mediaUrl';
import type { MemoryMessage } from '../types';

/** A message's media URL: the payload's `media_url`, else built from `media_file`; null without either. */
export function memoryMediaSrc(m: Pick<MemoryMessage, 'service' | 'media_url' | 'media_file'>): string | null {
    return m.media_url ?? (m.media_file ? buildMediaUrl(m.service, m.media_file) : null);
}
