import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '../../store/appStore';
import { ServiceRail } from './ServiceRail';

vi.mock('../../shell/hooks/useAuth', () => ({ useAuth: () => ({ isServiceDisconnected: () => false }) }));
vi.mock('../common/SettingsMenu', () => ({ SettingsMenu: () => null }));
vi.mock('./UpgradeIcon', () => ({ UpgradeIcon: () => null }));
vi.mock('./AddServiceModal', () => ({ AddServiceModal: () => null }));

const cb = { add: vi.fn(), settings: vi.fn(), search: vi.fn() };
const renderRail = () => render(
    <ServiceRail
        services={['hinatazaka46', 'sakurazaka46']}
        onAddService={cb.add}
        onOpenSettings={vi.fn()}
        onReportIssue={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenSearch={cb.search}
    />,
);

describe('ServiceRail', () => {
    it('is a neutral rail; the active group gets a white ring and the group glow', () => {
        useAppStore.setState({ activeService: 'hinatazaka46' });
        const { container } = renderRail();
        const rail = container.firstChild as HTMLElement;
        expect(rail).toHaveClass('bg-elevated');
        expect(rail.className).not.toMatch(/border-r/);
        const logos = container.querySelectorAll('.rounded-pill.bg-card');
        expect(logos[0]).toHaveClass('ring-2', 'ring-group-logo', 'ring-offset-2', 'shadow-group-glow');
        expect(logos[1]).not.toHaveClass('shadow-group-glow');
        expect(container.querySelector('[style]')).toBeNull();
    });

    it('has no group-coloured hovers and no divider line', () => {
        const { container } = renderRail();
        expect(container.innerHTML).not.toMatch(/green-|blue-|bg-gray-300/);
    });

    it('is a labelled nav; service buttons are named and the active one is current', () => {
        useAppStore.setState({ activeService: 'hinatazaka46' });
        renderRail();
        expect(screen.getByRole('navigation', { name: 'Groups' })).toBeInTheDocument();
        const buttons = screen.getAllByRole('button', { name: /46/ });
        expect(buttons[0]).toHaveAttribute('aria-current', 'page');
        expect(buttons[1]).not.toHaveAttribute('aria-current');
    });

    it('fires the search action and opens the add-service modal', async () => {
        renderRail();
        await userEvent.click(screen.getByRole('button', { name: /^Search/ }));
        expect(cb.search).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Add Service' })).toBeInTheDocument();
    });
});
