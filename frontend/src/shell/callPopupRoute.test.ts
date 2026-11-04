import { describe, it, expect } from 'vitest';
import { isCallPopupView } from './callPopupRoute';

describe('isCallPopupView', () => {
    it('is true for ?view=call-popup', () => {
        expect(isCallPopupView('?view=call-popup')).toBe(true);
    });

    it.each(['', '?view=other', '?x=call-popup'])('is false for %j', (search) => {
        expect(isCallPopupView(search)).toBe(false);
    });
});
