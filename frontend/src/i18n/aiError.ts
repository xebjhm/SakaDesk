// Stable error codes the backend attaches to translation/transcription failures.
// Keep in sync with backend/api/errors.py + backend/services/ai_errors.py.
const KNOWN_AI_ERROR_CODES = new Set([
    'no_provider',
    'no_api_key',
    'no_model',
    'invalid_key',
    'wrong_provider',
    'rate_limit',
    'unavailable',
    'timeout',
    'network',
    'model_not_found',
    'safety_blocked',
    'incomplete',
    'bad_response',
    'unknown_provider',
]);

/**
 * i18n key for an AI (translation/transcription) error code. Unknown/absent
 * codes fall back to a generic, retryable message so the user never sees a raw
 * English backend string.
 */
export function aiErrorKey(code?: string | null): string {
    return `aiError.${code && KNOWN_AI_ERROR_CODES.has(code) ? code : 'unknown'}`;
}

/** Extract the backend error `code` from a failed fetch Response. */
export async function readErrorCode(res: Response): Promise<string | null> {
    try {
        const body = await res.json();
        return typeof body?.code === 'string' ? body.code : null;
    } catch {
        return null;
    }
}
