import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n from '../i18n';
import { Badge, EmptyState } from './primitives';
import { BLOG_PROSE } from '../features/blogs/components/blogProse';
import { cn } from '../utils/classnames';

const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

describe('type details (UI health C-Y5, C-Y6)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('draws unread counts with tabular figures', () => {
        const { container } = render(<Badge count={18} />);
        expect(container.firstElementChild).toHaveClass('tabular-nums');
    });

    it('balances empty-state titles', () => {
        const { getByRole } = render(<EmptyState icon={null} title="まだメッセージはありません" />);
        expect(getByRole('heading')).toHaveClass('text-balance');
    });

    it('wraps blog bodies pretty and defines phrase breaking for Japanese titles', () => {
        expect(BLOG_PROSE).toContain('text-pretty');
        expect(config).toContain("'.phrase-break': { wordBreak: 'auto-phrase' }");
    });

    it('keeps the new wrapping utilities through cn() next to the type tokens', () => {
        expect(cn('font-reading text-heading text-primary', 'phrase-break text-balance'))
            .toBe('font-reading text-heading text-primary phrase-break text-balance');
        expect(cn('break-words text-pretty text-reading text-primary'))
            .toBe('break-words text-pretty text-reading text-primary');
    });
});
