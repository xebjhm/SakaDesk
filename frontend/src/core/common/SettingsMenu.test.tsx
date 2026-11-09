import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { SettingsMenu } from './SettingsMenu';

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('SettingsMenu', () => {
    it.each([
        ['Settings', 'onOpenSettings'],
        ['Report Issue', 'onReportIssue'],
        ['About', 'onOpenAbout'],
    ] as const)('the %s item calls %s and closes the menu', async (text, prop) => {
        const handlers = { onOpenSettings: vi.fn(), onReportIssue: vi.fn(), onOpenAbout: vi.fn() };
        render(<SettingsMenu {...handlers} />);
        await userEvent.click(screen.getByTitle('Settings'));
        await userEvent.click(screen.getByText(text, { exact: true }));
        expect(handlers[prop]).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('About', { exact: true })).toBeNull();
    });

    it('the trigger is a named menu button and the items are menuitems', async () => {
        render(<SettingsMenu onOpenSettings={vi.fn()} onReportIssue={vi.fn()} onOpenAbout={vi.fn()} />);
        const trigger = screen.getByRole('button', { name: 'Settings' });
        expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
        await userEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getAllByRole('menuitem')).toHaveLength(4);
    });
});
