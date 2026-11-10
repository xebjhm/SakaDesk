import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));

import i18n from '../i18n';
import { serviceThemes } from '../config/serviceThemes';
import { GROUP_IDS, SCALE_STEPS, groupRoles, groupTokens } from './tokens';
import { DesignPage } from './DesignPage';

beforeAll(async () => {
    await i18n.changeLanguage('en');
});

const groupLabel = (id: (typeof GROUP_IDS)[number]) => serviceThemes[id].name || id;

describe('DesignPage', () => {
    it('renders every section', () => {
        render(<DesignPage />);
        expect(screen.getByTestId('design-page')).toBeInTheDocument();
        for (const name of ['Design system', 'Colors', 'Radius', 'Shadow', 'Type', 'Motion', 'Loading states', 'Primitives', 'Rules']) {
            expect(screen.getByRole('heading', { name })).toBeInTheDocument();
        }
    });

    it('shows the calendar weekend and holiday swatches and no Sunday decor swatch', () => {
        render(<DesignPage />);
        expect(screen.getByText('calendar.holiday')).toBeInTheDocument();
        expect(screen.getByText('calendar.saturday')).toBeInTheDocument();
        expect(screen.queryByText('decor.sunday')).not.toBeInTheDocument();
    });

    it('shows the Hinatazaka logo colour and action colour contrast', () => {
        render(<DesignPage />);
        expect(screen.getAllByText('White text 1.9:1').length).toBeGreaterThan(0);
        expect(screen.getAllByText('White text 3.0:1').length).toBeGreaterThan(0);
    });

    it.each(GROUP_IDS)('switching to %s applies its tokens', async (id) => {
        render(<DesignPage />);
        await userEvent.click(screen.getByRole('button', { name: groupLabel(id) }));
        expect(screen.getByRole('button', { name: groupLabel(id) })).toHaveAttribute('aria-pressed', 'true');
        expect(document.documentElement.style.getPropertyValue('--ds-group-badge')).toBe(groupRoles(id).action);
    });

    it('opens the sample modal', async () => {
        render(<DesignPage />);
        await userEvent.click(screen.getByRole('button', { name: 'Open modal' }));
        expect(await screen.findByRole('dialog', { name: 'Sample modal' })).toBeInTheDocument();
    });
});

describe('DesignPage colour system', () => {
    it('shows the selected group scale with the logo step marked', async () => {
        render(<DesignPage />);
        expect(screen.getByRole('heading', { name: 'Scale' })).toBeInTheDocument();
        for (const step of SCALE_STEPS) {
            expect(screen.getAllByText(groupTokens.hinatazaka.scale[step]).length).toBeGreaterThan(0);
        }
        expect(screen.getByText('Logo color')).toBeInTheDocument();
    });

    it('lists the role map', () => {
        render(<DesignPage />);
        expect(screen.getByRole('heading', { name: 'Roles' })).toBeInTheDocument();
        for (const role of ['action', 'strong', 'subtle', 'subtleBorder', 'linkUnderline', 'highlight']) {
            expect(screen.getAllByText(role).length).toBeGreaterThan(0);
        }
    });
});

describe('DesignPage language', () => {
    afterEach(async () => {
        window.history.replaceState(null, '', '/');
        await i18n.changeLanguage('en');
    });

    it('switches the UI language from the language pills', async () => {
        render(<DesignPage />);
        await userEvent.click(screen.getByRole('button', { name: '繁體中文' }));
        expect(await screen.findByRole('heading', { name: '設計系統' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '繁體中文' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('honours ?lang= in the URL', async () => {
        window.history.replaceState(null, '', '/?view=design&lang=zh-TW');
        render(<DesignPage />);
        expect(await screen.findByRole('heading', { name: '設計系統' })).toBeInTheDocument();
    });

    it('ignores an unsupported ?lang=', async () => {
        window.history.replaceState(null, '', '/?view=design&lang=xx');
        render(<DesignPage />);
        expect(screen.getByRole('heading', { name: 'Design system' })).toBeInTheDocument();
    });

    it('keeps the menu demo behind its trigger: no focus grab, Escape still closes the Modal demo', async () => {
        render(<DesignPage />);
        expect(screen.queryByRole('menu')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Open modal' }));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens the menu demo from its trigger and returns focus on Escape', async () => {
        render(<DesignPage />);
        const trigger = screen.getByRole('button', { name: 'Open menu' });
        await userEvent.click(trigger);
        expect(screen.getByRole('menu')).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger).toHaveFocus();
    });
});

describe('DesignPage v2', () => {
    it('switching to the brand context wraps the page in a brand scope', async () => {
        render(<DesignPage />);
        await userEvent.click(screen.getByRole('button', { name: /SakaDesk brand/ }));
        expect(document.querySelector('[data-scope="brand"]')).not.toBeNull();
    });
    it('scopes the sample dialog to the brand context', async () => {
        render(<DesignPage />);
        await userEvent.click(screen.getByRole('button', { name: /SakaDesk brand/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Open modal' }));
        expect(await screen.findByRole('dialog')).toHaveAttribute('data-scope', 'brand');
    });
    it('leaves the sample dialog unscoped in a group context', async () => {
        render(<DesignPage />);
        await userEvent.click(screen.getByRole('button', { name: 'Open modal' }));
        expect(await screen.findByRole('dialog')).not.toHaveAttribute('data-scope');
    });
    it('shows the v2 sections', () => {
        render(<DesignPage />);
        for (const name of ['Brand', 'Semantic colours', 'Buttons', 'Expression tiers', 'Brand moments']) {
            expect(screen.getByRole('heading', { name })).toBeInTheDocument();
        }
    });
    it('renders every button variant and a disabled button with its reason', () => {
        render(<DesignPage />);
        expect(screen.getAllByRole('button', { name: /^primary$/ }).length).toBeGreaterThan(0);
        expect(screen.getAllByRole('button', { name: /^tonal$/ }).length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: /disabled/ })).toHaveAccessibleDescription('Choose a group first');
    });
});

describe('DesignPage loading states', () => {
    afterEach(() => vi.useRealTimers());

    it('previews every StatusBlock kind and the progress bars', () => {
        render(<DesignPage />);
        const section = screen.getByRole('heading', { name: 'Loading states' }).closest('section') as HTMLElement;
        expect(section).toHaveTextContent('Still loading…');
        expect(section).toHaveTextContent('This is taking longer than usual. Thanks for waiting.');
        expect(section).toHaveTextContent("Couldn't load this");
        expect(section).toHaveTextContent('This is taking too long');
        expect(section.querySelector('[role="progressbar"][aria-valuenow="40"]')).not.toBeNull();
    });

    it('plays a live wait through every stage', () => {
        vi.useFakeTimers();
        render(<DesignPage />);
        const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
        fireEvent.click(screen.getByRole('button', { name: 'Play a wait' }));
        const stage = () => screen.getByTestId('live-wait').getAttribute('data-stage');
        advance(199);
        expect(stage()).toBe('hidden');
        advance(1);
        expect(stage()).toBe('shown');
        advance(2800);
        expect(stage()).toBe('slow');
        advance(7000);
        expect(stage()).toBe('verySlow');
        advance(2000);
        expect(screen.queryByTestId('live-wait')).not.toBeInTheDocument();
    });
});
