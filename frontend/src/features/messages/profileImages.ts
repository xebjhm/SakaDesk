import { toLocalDateStr } from '../../utils/dateFormatters';

export type ProfileImageKind = 'group_thumbnail' | 'thumbnail' | 'phone_image';

/** Display order: list icon, chat icon, call screen. */
export const PROFILE_IMAGE_KINDS: ProfileImageKind[] = ['group_thumbnail', 'thumbnail', 'phone_image'];

/** i18n key suffix under `profileImages.` for each kind. */
export const KIND_I18N_KEY: Record<ProfileImageKind, 'thumbnailGroup' | 'thumbnail' | 'phoneImage'> = {
    group_thumbnail: 'thumbnailGroup',
    thumbnail: 'thumbnail',
    phone_image: 'phoneImage',
};

export interface ProfileImageEntry {
    url: string;
    first_seen: string | null;
    current: boolean;
}

export type ProfileImagesByKind = Partial<Record<ProfileImageKind, ProfileImageEntry[]>>;

type MemberImageFields = Partial<Record<ProfileImageKind | `${ProfileImageKind}_local`, string | null>>;

/** Local archived copy if the backend has one, else the CDN URL. */
export function memberImageUrl(member: MemberImageFields | null | undefined, kind: ProfileImageKind): string | undefined {
    return member?.[`${kind}_local`] || member?.[kind] || undefined;
}

export async function fetchProfileImages(path: string, signal?: AbortSignal): Promise<ProfileImagesByKind> {
    const res = await fetch(`/api/content/profile_images?path=${encodeURIComponent(path)}`, { signal });
    if (!res.ok) throw new Error(`profile_images ${res.status}`);
    const body = (await res.json()) as { kinds?: ProfileImagesByKind };
    return body.kinds ?? {};
}

function day(ts: string): string {
    return toLocalDateStr(ts).replace(/-/g, '/');
}

/**
 * Period an image was in use: from its first_seen to the first_seen of the
 * next newer version (entries are newest first), or "<from> – <currentLabel>"
 * for the current one. Unknown start: the current label alone (current) or ''.
 */
export function periodLabel(entries: ProfileImageEntry[], index: number, currentLabel: string): string {
    const entry = entries[index];
    if (!entry.first_seen) return entry.current ? currentLabel : '';
    const from = day(entry.first_seen);
    if (entry.current) return `${from} – ${currentLabel}`;
    const newer = entries[index - 1]?.first_seen;
    return newer ? `${from} – ${day(newer)}` : from;
}
