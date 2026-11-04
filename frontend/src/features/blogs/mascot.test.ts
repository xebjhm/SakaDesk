import { describe, it, expect } from 'vitest';
import { isMascot, MASCOT_THUMBNAIL_URL } from './mascot';

describe('mascot', () => {
    it('recognises ポカ by id or name', () => {
        expect(isMascot({ id: '000', name: 'x' })).toBe(true);
        expect(isMascot({ id: '12', name: 'ポカ' })).toBe(true);
        expect(isMascot({ id: '12', name: '春野 ひなた' })).toBe(false);
    });

    it('keeps the official thumbnail URL', () => {
        expect(MASCOT_THUMBNAIL_URL).toBe('https://cdn.hinatazaka46.com/images/14/98b/e96b48f630edc3119806a1b40bc10/400_320_102400.jpg');
    });
});
