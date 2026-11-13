import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../../store/appStore';
import { ServiceRail } from './ServiceRail';
import { clientLog } from '../../utils/clientLog';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

vi.mock('../../shell/hooks/useAuth', () => ({ useAuth: () => ({ isServiceDisconnected: () => false }) }));
vi.mock('../common/SettingsMenu', () => ({ SettingsMenu: () => null }));
vi.mock('./UpgradeIcon', () => ({ UpgradeIcon: () => null }));
vi.mock('./AddServiceModal', () => ({ AddServiceModal: () => null }));

const cb = { add: vi.fn(), settings: vi.fn(), search: vi.fn() };
const renderRail = (services = ['hinatazaka46', 'sakurazaka46']) => render(
    <ServiceRail
        services={services}
        onAddService={cb.add}
        onOpenSettings={vi.fn()}
        onReportIssue={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenSearch={cb.search}
    />,
);

describe('ServiceRail', () => {
    it('is a neutral rail; the active group gets the logo ring and the group halo', () => {
        useAppStore.setState({ activeService: 'hinatazaka46' });
        const { container } = renderRail();
        const rail = container.firstChild as HTMLElement;
        expect(rail).toHaveClass('bg-elevated');
        expect(rail.className).not.toMatch(/border-r/);
        const logos = container.querySelectorAll('.rounded-pill.bg-card');
        expect(logos[0]).toHaveClass('ring-2', 'ring-group-logo', 'ring-offset-2', 'shadow-accent-halo');
        expect(logos[1]).not.toHaveClass('shadow-accent-halo');
        // Only the brand scope around the bottom actions carries inline (custom property) styles.
        const styled = [...container.querySelectorAll('[style]')];
        expect(styled.length).toBe(1);
        expect(styled[0]).toHaveAttribute('data-scope', 'brand');
    });

    it('puts add and search in the brand scope as soft ink circles', () => {
        const { container } = renderRail();
        const scope = container.querySelector('[data-scope="brand"]') as HTMLElement;
        for (const name of [/^Search/, 'Add Service']) {
            const b = screen.getByRole('button', { name });
            expect(scope).toContainElement(b);
            expect(b).toHaveClass('bg-accent-subtle', 'text-accent', 'rounded-full');
        }
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
    it('right-click on a group offers Remove Service', async () => {
        renderRail();
        fireEvent.contextMenu(screen.getAllByRole('button', { name: /46/ })[0]);
        expect(await screen.findByText('Remove Service')).toBeInTheDocument();
    });
});

describe('ServiceRail reorder from the menu (UI health A-K6)', () => {
    const order = ['hinatazaka46', 'sakurazaka46', 'nogizaka46', 'yodel'];

    it('moves a group down from its context menu and logs it', async () => {
        useAppStore.setState({ selectedServices: ['hinatazaka46', 'sakurazaka46'], serviceOrder: order });
        renderRail();
        fireEvent.contextMenu(screen.getAllByRole('button', { name: /46/ })[0]);
        expect(screen.queryByRole('menuitem', { name: 'Move up' })).toBeNull(); // already first
        await userEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
        expect(useAppStore.getState().serviceOrder.slice(0, 2)).toEqual(['sakurazaka46', 'hinatazaka46']);
        expect(clientLog).toHaveBeenCalledWith('rail_reorder', { target: 'move_down', outcome: 'moved' });
    });

    it('moves a group up, and offers no Move down at the bottom', async () => {
        useAppStore.setState({ selectedServices: ['hinatazaka46', 'sakurazaka46'], serviceOrder: order });
        renderRail();
        fireEvent.contextMenu(screen.getAllByRole('button', { name: /46/ })[1]);
        expect(screen.queryByRole('menuitem', { name: 'Move down' })).toBeNull();
        await userEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
        expect(useAppStore.getState().serviceOrder.slice(0, 2)).toEqual(['sakurazaka46', 'hinatazaka46']);
    });

    it('opens the menu at the button when the event has no pointer position', () => {
        // Chromium's keyboard contextmenu (Shift+F10, the Menu key) usually carries the element's
        // coordinates, so this (0, 0) path rarely runs there; it is pinned here so it stays correct.
        renderRail();
        const button = screen.getAllByRole('button', { name: /46/ })[1];
        vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
            { left: 8, right: 72, top: 140, bottom: 196, width: 64, height: 56, x: 8, y: 140, toJSON: () => ({}) } as DOMRect,
        );
        fireEvent.contextMenu(button, { clientX: 0, clientY: 0 });
        const menu = screen.getByRole('menu');
        expect(menu.style.left).toBe('72px');
        expect(menu.style.top).toBe('140px');
        expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeInTheDocument();
    });

    it('opens on the first move item, never on Remove Service (Task 7)', () => {
        renderRail();
        fireEvent.contextMenu(screen.getAllByRole('button', { name: /46/ })[0]);
        expect(screen.getByRole('menuitem', { name: 'Move down' })).toHaveFocus();
        expect(screen.getByRole('menuitem', { name: 'Remove Service' })).toHaveAttribute('data-destructive');
    });

    it('with one group the menu has only Remove Service and opens on its container', () => {
        renderRail(['hinatazaka46']);
        fireEvent.contextMenu(screen.getAllByRole('button', { name: /46/ })[0]);
        expect(screen.queryByRole('menuitem', { name: /Move/ })).toBeNull();
        expect(screen.getByRole('menu')).toHaveFocus();
    });

    it('returns focus to the moved group button after a keyboard move', async () => {
        useAppStore.setState({ selectedServices: ['hinatazaka46', 'sakurazaka46'], serviceOrder: order });
        renderRail();
        const moved = screen.getAllByRole('button', { name: /46/ })[0];
        fireEvent.contextMenu(moved);
        await userEvent.keyboard('{Enter}'); // Move down, the first item
        expect(useAppStore.getState().serviceOrder.slice(0, 2)).toEqual(['sakurazaka46', 'hinatazaka46']);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(moved).toHaveFocus();
    });

    it('returns focus to the group button on Escape', async () => {
        renderRail();
        const trigger = screen.getAllByRole('button', { name: /46/ })[1];
        fireEvent.contextMenu(trigger);
        expect(screen.getByRole('menu')).toBeInTheDocument();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger).toHaveFocus();
    });
});
