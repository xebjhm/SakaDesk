import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useAppStore } from '../../store/appStore';
import { ServiceRail } from './ServiceRail';

vi.mock('../../shell/hooks/useAuth', () => ({ useAuth: () => ({ isServiceDisconnected: () => false }) }));
vi.mock('../common/SettingsMenu', () => ({ SettingsMenu: () => null }));
vi.mock('./UpgradeIcon', () => ({ UpgradeIcon: () => null }));
vi.mock('./AddServiceModal', () => ({ AddServiceModal: () => null }));

const renderRail = () => render(
    <ServiceRail
        services={['hinatazaka46', 'sakurazaka46']}
        onAddService={vi.fn()}
        onOpenSettings={vi.fn()}
        onReportIssue={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenSearch={vi.fn()}
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
        expect(logos[0]).toHaveClass('ring-2', 'ring-white', 'shadow-group-glow');
        expect(logos[1]).not.toHaveClass('shadow-group-glow');
        expect(container.querySelector('[style]')).toBeNull();
    });

    it('has no group-coloured hovers and no divider line', () => {
        const { container } = renderRail();
        expect(container.innerHTML).not.toMatch(/green-|blue-|bg-gray-300/);
    });
});
