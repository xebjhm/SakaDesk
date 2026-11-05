import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { staticTokenVars } from './cssVars';

const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

describe('D2d tokens', () => {
    it('write the window base (today’s #F0F2F5)', () => {
        expect(staticTokenVars()['--ds-surface-window']).toBe('#F0F2F5');
    });

    it('expose bg-window and bg-status-success', () => {
        expect(config).toContain("window: 'var(--ds-surface-window)'");
        expect(config).toContain("'status-success': 'var(--ds-semantic-success-solid)'");
    });
});
