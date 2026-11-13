import { clientLog, breadcrumbCode } from '../utils/clientLog';

/**
 * The output (archive) folder is chosen only in the native folder picker the backend runs
 * (`POST /api/settings/select-folder`, security audit 2026-11-13): a page cannot name a
 * folder, so the field that shows it is read-only. These helpers call the picker and turn
 * the backend's reason codes into i18n keys (`settings.outputDirError.<code>`).
 */

/** Reasons the backend gives for a folder it refuses or a picker that failed. */
export const OUTPUT_DIR_ERROR_CODES = [
    'invalid', 'device', 'network', 'root', 'relative', 'profile', 'app_data', 'system',
    'not_writable', 'not_picked', 'unavailable', 'timeout', 'busy', 'cooldown', 'failed',
] as const;

export type OutputDirErrorCode = typeof OUTPUT_DIR_ERROR_CODES[number];

/** The i18n key of a backend reason code; an unknown or missing code is the generic picker failure. */
export function outputDirErrorKey(code: unknown): string {
    if (typeof code === 'string' && (OUTPUT_DIR_ERROR_CODES as readonly string[]).includes(code)) {
        return `settings.outputDirError.${code}`;
    }
    return 'settings.outputDirError.failed';
}

/** What the picker gave: the chosen folder, or the i18n key of why not (both null for a cancel). */
export interface FolderPick {
    path: string | null;
    errorKey: string | null;
}

/** Open the native folder picker; resolves when it closes. Never rejects. */
export async function pickOutputFolder(): Promise<FolderPick> {
    try {
        const res = await fetch('/api/settings/select-folder', { method: 'POST' });
        if (!res.ok) {
            clientLog('output_folder_pick_failed', { reason: `http_${res.status}` });
            return { path: null, errorKey: outputDirErrorKey('failed') };
        }
        const body = (await res.json()) as { path?: unknown; error?: unknown } | null;
        if (typeof body?.path === 'string' && body.path) return { path: body.path, errorKey: null };
        if (body?.error !== undefined && body?.error !== null) {
            return { path: null, errorKey: outputDirErrorKey(body.error) };
        }
        return { path: null, errorKey: null };
    } catch (error) {
        clientLog('output_folder_pick_failed', { error_type: breadcrumbCode(error) });
        return { path: null, errorKey: outputDirErrorKey('failed') };
    }
}

/**
 * The i18n key for a refused `POST /api/settings`: the reason when the backend refused the
 * output folder (`{"detail": {"code": "output_dir_rejected", "reason": ...}}`), else the
 * generic save failure.
 */
export async function saveErrorKey(res: { json: () => Promise<unknown> }): Promise<string> {
    try {
        const body = (await res.json()) as { detail?: unknown } | null;
        const detail = body?.detail as { code?: unknown; reason?: unknown } | undefined;
        if (detail && typeof detail === 'object' && detail.code === 'output_dir_rejected') {
            return outputDirErrorKey(detail.reason);
        }
    } catch {
        // Not JSON: the generic message below.
    }
    return 'settings.saveFailed';
}
