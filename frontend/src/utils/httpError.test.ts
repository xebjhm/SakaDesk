import { describe, it, expect } from 'vitest';
import { parseErrorDetail } from './httpError';

// SD-CONTRACT-04: FastAPI validation errors return `detail` as an ARRAY of
// objects, so `errData.detail || fallback` rendered "[object Object]" to users.
// parseErrorDetail must turn any FastAPI error body into a readable string.
describe('parseErrorDetail', () => {
  it('returns a plain string detail unchanged', () => {
    expect(parseErrorDetail({ detail: 'Not authenticated' }, 'fallback')).toBe('Not authenticated');
  });

  it('joins the msg fields of a 422 detail array', () => {
    const body = {
      detail: [
        { type: 'missing', loc: ['query', 'service'], msg: 'Field required' },
      ],
    };
    expect(parseErrorDetail(body, 'fallback')).toBe('Field required');
  });

  it('joins multiple 422 messages', () => {
    const body = {
      detail: [
        { msg: 'Field required' },
        { msg: 'value is not a valid integer' },
      ],
    };
    expect(parseErrorDetail(body, 'fallback')).toBe('Field required; value is not a valid integer');
  });

  it('falls back when detail is missing', () => {
    expect(parseErrorDetail({}, 'fallback')).toBe('fallback');
    expect(parseErrorDetail(null, 'fallback')).toBe('fallback');
  });

  it('falls back when detail is an object without msg (never leaks [object Object])', () => {
    const result = parseErrorDetail({ detail: { unexpected: true } }, 'fallback');
    expect(result).toBe('fallback');
    expect(result).not.toContain('[object Object]');
  });

  it('falls back on an array of non-msg objects', () => {
    const result = parseErrorDetail({ detail: [{ nope: 1 }] }, 'fallback');
    expect(result).toBe('fallback');
    expect(result).not.toContain('[object Object]');
  });
});
