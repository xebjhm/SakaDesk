import { describe, it, expect } from 'vitest';
import { staggerDelay } from './stagger';

describe('staggerDelay', () => {
    it('steps 50 ms per card and stops after 8 steps', () => {
        expect([0, 1, 7, 8, 9, 120].map(staggerDelay)).toEqual([0, 50, 350, 400, 400, 400]);
    });
});
