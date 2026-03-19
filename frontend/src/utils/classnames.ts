import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

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
 * Full month names for display (English)
 */
export const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
] as const;

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
