// frontend/src/features/ai/aiErrorCode.ts
//
// Shared client-side mapping from the KB-chatbot's stable backend error
// `code` to an `ai.error.<code>` i18n key. Two surfaces key off this same
// taxonomy:
//   - `ChatWindow.tsx`'s `event: error` turns from `/api/ai/ask`'s SSE
//     stream (`backend/api/ai.py`'s `_serialize_error_event`).
//   - `SetupChecklist.tsx`'s non-2xx responses from `POST /api/ai/index/
//     rebuild` (P-4 review, Finding 1: that handler used to only catch
//     network failures and silently swallow a 409's `not_configured`/
//     `already_running`/`kb_disabled` `code`).
//
// Extracted to its own module (rather than left local to `ChatWindow.tsx`,
// where it originally lived) so `SetupChecklist.tsx` can reuse it without a
// circular import -- `ChatWindow.tsx` itself renders `<SetupChecklist />` in
// its empty state, so the dependency can only run one way.

// Known `ai.error.*` codes -- an unrecognized/absent code falls back to
// `ai.error.unknown` so the user never sees a raw/untranslated string.
export const KNOWN_AI_ERROR_CODES = new Set([
    // `/api/ai/ask` SSE `event: error` codes (`LLMBackendError.kind`, plus
    // `misconfigured`/`kb_disabled`/`embedding_model_missing`/`network`).
    'quota_exhausted',
    'auth',
    'model_not_found',
    'model_incompatible',
    'unreachable',
    'timeout',
    'malformed_response',
    'misconfigured',
    'kb_disabled',
    'embedding_model_missing',
    'network',
    // `POST /api/ai/index/rebuild` 409 codes (P-4 review, Finding 1).
    'not_configured',
    'already_running',
]);

/** i18n key for a KB-chatbot error `code` -- see `KNOWN_AI_ERROR_CODES`. */
export function errorMessageKey(code: string): string {
    return `ai.error.${KNOWN_AI_ERROR_CODES.has(code) ? code : 'unknown'}`;
}
