import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Teach tailwind-merge the design-system classes (tailwind.config.js) so a token
// text size and a token text colour are not treated as conflicting `text-*` classes,
// and the group gradient (a background-image) is not treated as a `bg-` colour.
// `mask-image` is a design-system group tailwind-merge does not know (the `mask-fade-y` utility).
const twMerge = extendTailwindMerge<'mask-image'>({
    extend: {
        classGroups: {
            'font-size': [{ text: ['caption', 'small', 'body', 'title', 'heading', 'display', 'reading', 'tile-date', 'tile-date-lg', 'tile-title', 'tile-title-lg', 'tile-name', 'tile-name-lg', 'segment'] }],
            'font-family': [{ font: ['sans', 'display', 'reading'] }],
            'text-color': [{ text: ['primary', 'secondary', 'muted', 'inverse', 'accent', 'accent-strong', 'accent-tonal', 'expressive-header', 'group-title', 'group-strong', 'status-danger', 'status-success', 'status-warning', 'semantic-success', 'semantic-warning', 'semantic-danger', 'semantic-info', 'viewer', 'viewer-muted', 'console', 'console-muted', 'console-prompt', 'console-error', 'console-warning', 'console-badge', 'calendar-holiday', 'calendar-saturday', 'heart', 'semantic-oshi', 'semantic-oshi-solid', 'semantic-star', 'group-shelter-picture', 'group-shelter-video', 'group-shelter-voice', 'group-shelter-text'] }],
            'bg-color': [{ bg: ['accent', 'accent-strong', 'accent-subtle', 'accent-border', 'accent-logo', 'status-attention', 'semantic-success-subtle', 'semantic-warning-subtle', 'semantic-danger-subtle', 'semantic-info-subtle', 'semantic-success-icon', 'semantic-warning-icon', 'semantic-danger-icon', 'semantic-info-icon', 'semantic-oshi-subtle', 'semantic-oshi-solid', 'console', 'console-badge', 'header-glass', 'header-shade', 'frost', 'group-title-tint', 'group-title-wash', 'group-shelter-picture', 'group-shelter-video', 'group-shelter-voice', 'group-shelter-text', 'tile-glass', 'segment-track'] }],
            'bg-image': [{ bg: ['accent-gradient', 'accent-wash', 'accent-tonal', 'expressive-soft', 'expressive-header', 'expressive-header-bar', 'expressive-progress', 'expressive-orb-1', 'expressive-orb-2', 'expressive-orb-3', 'aurora', 'group-canvas', 'group-title', 'group-title-bar', 'group-ambient-1', 'group-ambient-2', 'group-ambient-3', 'member-wash', 'accent-aura', 'accent-tile', 'tile-vignette', 'accent-lens'] }],
            'border-color': [{ border: ['accent', 'accent-strong', 'accent-border', 'accent-wash', 'frost', 'semantic-success', 'semantic-warning', 'semantic-danger', 'semantic-info', 'semantic-oshi', 'group-shelter-picture', 'group-shelter-video', 'group-shelter-voice', 'group-shelter-text', 'tile-glass'] }],
            'ring-color': [{ ring: ['accent', 'expressive-header', 'expressive-header-focus', 'accent-border', 'accent-logo', 'accent-subtle', 'semantic-oshi'] }],
            fill: [{ fill: ['semantic-oshi'] }],
            rounded: [{ rounded: ['tail', 'card', 'sheet', 'pill'] }],
            'rounded-tl': [{ 'rounded-tl': ['tail'] }],
            shadow: [{ shadow: ['accent-glow', 'accent-beacon', 'accent-glow-hover', 'accent-halo', 'accent-unread', 'pill', 'card', 'sheet', 'group-glow', 'tile', 'tile-hover', 'caption', 'caption-hover', 'segment'] }],
            duration: [{ duration: ['fast', 'base', 'glide', 'lift', 'zoom', 'lens'] }],
            animate: [{ animate: ['landing', 'reveal', 'orb-drift-1', 'orb-drift-2', 'orb-breathe', 'heart-float', 'heartbeat', 'shimmer', 'pop', 'confetti', 'sparkle', 'toast-in'] }],
            ease: [{ ease: ['standard', 'spring'] }],
            'mask-image': [{ mask: ['fade-y'] }],
            transition: [{ transition: ['caption'] }],
        },
    },
})

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

/**
 * Format a timestamp to "YYYY/MM/DD HH:mm" format
 */
export function formatDateTime(timestamp: string | Date): string {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hour = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    return `${year}/${month}/${day} ${hour}:${min}`;
}

/**
 * Format seconds to "MM:SS" format
 */
export function formatDuration(seconds: number | undefined): string {
    if (seconds === undefined || seconds === null) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Short month names for display (English)
 */
export const MONTH_NAMES_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
] as const;

/**
 * Format a month/year to "Jan 2024" format.
 * @param month - 1-indexed month (1 = January)
 * @param year - Full year (e.g., 2024)
 */
export function formatMonthYear(month: number, year: number): string {
    return `${MONTH_NAMES_SHORT[month - 1]} ${year}`;
}

/**
 * Format a date to "Jan 15 14:30" format.
 * @param date - Date object to format
 */
export function formatShortDate(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${MONTH_NAMES_SHORT[date.getMonth()]} ${date.getDate()} ${h}:${m}`;
}

/**
 * Format a download filename with timestamp prefix.
 * e.g. "2026-03-03_1433_4954134.jpg"
 *
 * @param url - Media URL to extract original filename from
 * @param timestamp - ISO timestamp string for the prefix
 */
export function formatDownloadFilename(url: string, timestamp?: string): string {
    // For URLs with a `filename` query param (e.g. /api/blogs/image?filename=img_0.jpg),
    // extract from the param. Otherwise extract from the URL path.
    let raw: string;
    const filenameParam = url.includes('filename=')
        ? new URL(url, window.location.origin).searchParams.get('filename')
        : null;
    if (filenameParam) {
        raw = filenameParam;
    } else {
        const pathOnly = url.split('?')[0];
        raw = pathOnly.split('/').pop() || 'download';
    }
    let decoded: string;
    try { decoded = decodeURIComponent(raw); } catch { decoded = raw; }
    // Extract just the filename (split on both / and \ for Windows paths)
    const originalName = decoded.split(/[/\\]/).pop() || decoded;
    if (!timestamp) return originalName;

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return originalName;
    const y = date.getFullYear();
    const mo = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const h = date.getHours().toString().padStart(2, '0');
    const mi = date.getMinutes().toString().padStart(2, '0');

    return `${y}-${mo}-${d}_${h}${mi}_${originalName}`;
}
