import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Teach tailwind-merge every design-system utility declared in tailwind.config.js
// (DESIGN_SYSTEM "Adding or changing a token", step 2). Without this a token name is
// treated as a built-in one: a token text size and a token text colour would both be
// `text-*` colours and drop each other, and a group gradient (a background-image)
// would be a `bg-` colour. `classnames.registry.test.ts` checks this list against the config.
// `extend` keeps every built-in group merging; `mask-image` is a design-system group
// tailwind-merge does not know (the `mask-fade-y` utility).
// `phrase-break` is deliberately NOT registered: it must coexist with `break-words` / `break-all`.
export const TW_MERGE_CLASS_GROUPS = {
    'font-size': [{ text: ['caption', 'small', 'body', 'title', 'heading', 'display', 'reading', 'tile-date', 'tile-date-lg', 'tile-title', 'tile-title-lg', 'tile-name', 'tile-name-lg', 'segment'] }],
    'font-family': [{ font: ['sans', 'display', 'reading'] }],
    'text-color': [{ text: ['memories-night-ink', 'accent', 'accent-strong', 'accent-tonal', 'expressive-header', 'primary', 'secondary', 'muted', 'inverse', 'group-title', 'group-strong', 'status-danger', 'status-success', 'status-warning', 'semantic-success', 'semantic-warning', 'semantic-danger', 'semantic-info', 'semantic-oshi', 'semantic-oshi-solid', 'semantic-star', 'viewer', 'viewer-muted', 'console', 'console-muted', 'console-prompt', 'console-error', 'console-warning', 'console-badge', 'calendar-holiday', 'calendar-saturday', 'heart', 'group-shelter-picture', 'group-shelter-video', 'group-shelter-voice', 'group-shelter-text'] }],
    'bg-color': [{ bg: ['accent', 'accent-strong', 'accent-subtle', 'accent-border', 'accent-logo', 'sheet', 'card', 'pill', 'elevated', 'sunken', 'window', 'scrim', 'group-accent', 'group-badge', 'group-subtle', 'mark-exact', 'mark-reading', 'toast', 'status-danger', 'status-success', 'status-attention', 'semantic-success-subtle', 'semantic-warning-subtle', 'semantic-danger-subtle', 'semantic-info-subtle', 'semantic-success-icon', 'semantic-warning-icon', 'semantic-danger-icon', 'semantic-info-icon', 'semantic-oshi-subtle', 'semantic-oshi-solid', 'viewer-scrim', 'viewer-stage', 'viewer-control', 'viewer-control-hover', 'console', 'console-badge', 'control-off', 'skeleton', 'skeleton-veil', 'group-marker', 'header-glass', 'header-shade', 'frost', 'group-title-tint', 'group-title-wash', 'group-shelter-picture', 'group-shelter-video', 'group-shelter-voice', 'group-shelter-text', 'tile-glass', 'segment-track', 'memories-paper', 'memories-washi', 'memories-rarity-n', 'memories-rarity-r', 'memories-onair', 'memories-note'] }],
    'bg-image': [{ bg: ['accent-gradient', 'accent-wash', 'accent-tonal', 'expressive-soft', 'expressive-header', 'expressive-header-bar', 'expressive-progress', 'expressive-orb-1', 'expressive-orb-2', 'expressive-orb-3', 'aurora', 'accent-aura', 'accent-tile', 'tile-vignette', 'memories-cork', 'memories-foil', 'memories-ruled', 'memories-rarity-sr', 'memories-night', 'memories-sky', 'accent-lens', 'group-canvas', 'group-title', 'group-title-bar', 'group-ambient-1', 'group-ambient-2', 'group-ambient-3', 'member-wash'] }],
    'border-color': [{ border: ['accent-border', 'accent-wash', 'accent', 'accent-strong', 'frost', 'subtle', 'strong', 'mark-underline', 'semantic-success', 'semantic-warning', 'semantic-danger', 'semantic-info', 'semantic-oshi', 'group-bubble', 'group-subtle', 'surface', 'tile-glass', 'memories-paper', 'memories-silhouette', 'group-shelter-picture', 'group-shelter-video', 'group-shelter-voice', 'group-shelter-text'] }],
    'ring-color': [{ ring: ['accent', 'expressive-header', 'expressive-header-focus', 'accent-border', 'accent-logo', 'accent-subtle', 'semantic-oshi', 'group', 'group-logo', 'surface', 'strong'] }],
    fill: [{ fill: ['semantic-oshi'] }],
    rounded: [{ rounded: ['tail', 'card', 'sheet', 'pill'] }],
    shadow: [{ shadow: ['accent-glow', 'accent-halo', 'accent-glow-hover', 'accent-unread', 'accent-beacon', 'pill', 'card', 'sheet', 'group-glow', 'tile', 'tile-hover', 'caption', 'caption-hover', 'segment', 'memories-polaroid'] }],
    duration: [{ duration: ['fast', 'base', 'glide', 'lift', 'zoom', 'lens'] }],
    animate: [{ animate: ['landing', 'reveal', 'toast-in', 'orb-drift-1', 'orb-drift-2', 'orb-breathe', 'heart-float', 'heartbeat', 'star-fall', 'fan-in', 'petal-fall', 'shimmer', 'shimmer-sweep', 'progress-indeterminate', 'pop', 'confetti', 'sparkle'] }],
    ease: [{ ease: ['standard', 'spring'] }],
    sepia: [{ sepia: ['memories-1', 'memories-2', 'memories-3'] }],
    'max-h': [{ 'max-h': ['small-3'] }],
    blur: [{ blur: ['placeholder'] }],
    'backdrop-blur': [{ 'backdrop-blur': ['frost'] }],
    'rounded-tl': [{ 'rounded-tl': ['tail'] }],
    'mask-image': [{ mask: ['fade-y'] }],
    transition: [{ transition: ['caption'] }],
    'justify-content': [{ justify: ['safe-center'] }],
    'align-items': [{ items: ['safe-center'] }],
}

const twMerge = extendTailwindMerge<'mask-image'>({ extend: { classGroups: TW_MERGE_CLASS_GROUPS } })

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
