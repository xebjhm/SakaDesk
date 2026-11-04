import { describe, it, expect } from 'vitest';
import { isDesignView } from './designRoute';

describe('isDesignView', () => {
    it.each([
        ['?view=design', true],
        ['?view=design&x=1', true],
        ['?view=call-popup', false],
        ['', false],
    ])('%s -> %s', (search, want) => {
        expect(isDesignView(search)).toBe(want);
    });
});
