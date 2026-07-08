// src/utils/httpError.ts
// Helpers for turning a backend (FastAPI) error body into a readable message.

interface ValidationErrorItem {
  msg?: unknown;
}

/**
 * Extract a human-readable message from a parsed FastAPI error body.
 *
 * SD-CONTRACT-04: FastAPI's `detail` is a plain string for `HTTPException`, but
 * a 422 validation error returns `detail` as an ARRAY of objects
 * (`[{ type, loc, msg, ... }]`). Doing `errData.detail || fallback` then
 * rendered "[object Object]" to the user. This normalizes both shapes and
 * always returns a string — never a stringified object.
 */
export function parseErrorDetail(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const detail = (body as { detail?: unknown }).detail;

  if (typeof detail === 'string' && detail.length > 0) return detail;

  if (Array.isArray(detail)) {
    const msgs = detail
      .map((item) => {
        const msg = (item as ValidationErrorItem)?.msg;
        return typeof msg === 'string' ? msg : null;
      })
      .filter((m): m is string => m !== null && m.length > 0);
    if (msgs.length > 0) return msgs.join('; ');
  }

  return fallback;
}
