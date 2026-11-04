import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { FeatureRail } from './FeatureRail';

vi.mock('../../shell/hooks/useAuth', () => ({
    useAuth: () => ({ isServiceConnected: () => true, checkAuth: vi.fn(), isServiceDisconnected: () => false }),
}));
vi.mock('../../shell/components/LoginModal', () => ({ LoginModal: () => null }));

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('FeatureRail', () => {
    it('shows icon + translated label entries and marks the active one', async () => {
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'messages' } });
        const { container } = render(<FeatureRail service="hinatazaka46" />);
        expect(screen.getByRole('button', { name: 'Messages' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'Blogs' })).not.toHaveAttribute('aria-current');
        expect(container.querySelector('[style]')).toBeNull(); // no inline group colour
        await userEvent.click(screen.getByRole('button', { name: 'Blogs' }));
        expect(useAppStore.getState().getActiveFeature('hinatazaka46')).toBe('blogs');
    });
});
