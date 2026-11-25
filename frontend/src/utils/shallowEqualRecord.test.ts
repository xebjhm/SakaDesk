import { describe, it, expect } from 'vitest';
import { shallowEqualRecord } from './shallowEqualRecord';

describe('shallowEqualRecord', () => {
    it('compares keys and values one level deep', () => {
        expect(shallowEqualRecord({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
        expect(shallowEqualRecord({ a: 1 }, { a: 2 })).toBe(false);
        expect(shallowEqualRecord({ a: 1 }, { a: 1, b: 0 })).toBe(false);
        expect(shallowEqualRecord({}, {})).toBe(true);
    });
});
