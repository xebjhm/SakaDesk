import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Button } from './Button';

// Own file: the warn-once flag is module state, so it must not be tripped by other tests.
describe('Button disabled warning', () => {
    it('warns once in development when disabled has no reason', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        render(<><Button disabled>A</Button><Button disabled>B</Button></>);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('disabledReason');
        warn.mockRestore();
    });
});
