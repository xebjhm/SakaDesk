/**
 * Normalise a thrown value's class name into a breadcrumb field value
 * (`NotAllowedError` -> `notallowederror`; anything else -> `unknown`). The
 * backend whitelist accepts only `^[a-z0-9_]{1,40}$`.
 *
 * Kept out of `clientLog.ts` so tests that mock that module (for `clientLog`
 * alone) still get the real helper; `clientLog.ts` re-exports it.
 */
export function breadcrumbCode(value: unknown): string {
    const name = value instanceof Error || value instanceof DOMException ? value.name : 'unknown';
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'unknown';
}
