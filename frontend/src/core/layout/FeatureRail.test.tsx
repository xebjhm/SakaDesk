import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { FeatureRail } from './FeatureRail';

const auth = vi.hoisted(() => ({ connected: true }));
vi.mock('../../shell/hooks/useAuth', () => ({
    useAuth: () => ({ isServiceConnected: () => auth.connected, checkAuth: vi.fn(), isServiceDisconnected: () => false }),
}));
vi.mock('../../shell/components/LoginModal', () => ({
    LoginModal: ({ featureId }: { featureId: string }) => <div data-testid="login">{featureId}</div>,
}));

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

    it('is a labelled nav', () => {
        render(<FeatureRail service="hinatazaka46" />);
        expect(screen.getByRole('navigation', { name: 'Features' })).toBeInTheDocument();
    });

    it('opens the login modal for a paid feature when not connected', async () => {
        auth.connected = false;
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'blogs' } });
        render(<FeatureRail service="hinatazaka46" />);
        await userEvent.click(screen.getByRole('button', { name: 'Messages' }));
        expect(screen.getByTestId('login')).toHaveTextContent('messages');
        expect(useAppStore.getState().getActiveFeature('hinatazaka46')).toBe('blogs');
        auth.connected = true;
    });

    it('resets the blog view when blogs is clicked', async () => {
        const triggerBlogViewReset = vi.fn();
        useAppStore.setState({ triggerBlogViewReset });
        render(<FeatureRail service="hinatazaka46" />);
        await userEvent.click(screen.getByRole('button', { name: 'Blogs' }));
        expect(triggerBlogViewReset).toHaveBeenCalledOnce();
    });
});
