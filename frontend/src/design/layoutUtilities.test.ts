import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cn } from '../utils/classnames';

const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

describe('layout utilities (UI health C-L1, C-L5)', () => {
    it('defines safe centring and a stable scrollbar gutter', () => {
        expect(config).toContain("'.justify-safe-center': { justifyContent: 'safe center' }");
        expect(config).toContain("'.items-safe-center': { alignItems: 'safe center' }");
        expect(config).toContain("'.scrollbar-stable': { scrollbarGutter: 'stable' }");
    });

    it('merges them with the plain centring classes', () => {
        expect(cn('justify-center', 'justify-safe-center')).toBe('justify-safe-center');
        expect(cn('items-center', 'items-safe-center')).toBe('items-safe-center');
    });
});
