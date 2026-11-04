import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));

import i18n from '../i18n';
import { serviceThemes } from '../config/serviceThemes';
import { GROUP_IDS, groupTokens } from './tokens';
import { DesignPage } from './DesignPage';

beforeAll(async () => {
    await i18n.changeLanguage('en');
});

const groupLabel = (id: (typeof GROUP_IDS)[number]) => serviceThemes[id].name || id;

describe('DesignPage', () => {
    it('renders every section', () => {
        render(<DesignPage />);
        expect(screen.getByTestId('design-page')).toBeInTheDocument();
        for (const name of ['Design system', 'Colors', 'Radius', 'Shadow', 'Type', 'Motion', 'Primitives', 'Rules']) {
            expect(screen.getByRole('heading', { name })).toBeInTheDocument();
        }
    });

    it('shows the Hinatazaka badge contrast', () => {
        render(<DesignPage />);
        expect(screen.getAllByText('White text 1.9:1').length).toBeGreaterThan(0);
    });

    it.each(GROUP_IDS)('switching to %s applies its tokens', async (id) => {
        render(<DesignPage />);
        await userEvent.click(screen.getByRole('button', { name: groupLabel(id) }));
        expect(screen.getByRole('button', { name: groupLabel(id) })).toHaveAttribute('aria-pressed', 'true');
        expect(document.documentElement.style.getPropertyValue('--ds-group-badge')).toBe(groupTokens[id].badge);
    });

    it('opens the sample modal', async () => {
        render(<DesignPage />);
        await userEvent.click(screen.getByRole('button', { name: 'Open modal' }));
        expect(await screen.findByRole('dialog', { name: 'Sample modal' })).toBeInTheDocument();
    });
});
