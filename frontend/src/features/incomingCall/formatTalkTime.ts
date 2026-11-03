/** Formats elapsed talk time as m:ss (minutes are not zero-padded). */
export function formatTalkTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
