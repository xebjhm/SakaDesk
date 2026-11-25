import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { SkipLink } from './SkipLink';

describe('SkipLink', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('is the first Tab stop and moves focus to the target', async () => {
        render(<><SkipLink targetId="sd-main" /><button type="button">rail</button><main id="sd-main" tabIndex={-1}>content</main></>);
        await userEvent.tab();
        const link = screen.getByRole('button', { name: 'Skip to content' });
        expect(link).toHaveFocus();
        expect(link).toHaveClass('sr-only', 'focus-visible:not-sr-only');
        await userEvent.keyboard('{Enter}');
        expect(screen.getByRole('main')).toHaveFocus();
    });
});
