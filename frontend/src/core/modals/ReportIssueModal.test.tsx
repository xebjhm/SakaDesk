import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { ReportIssueModal } from './ReportIssueModal';

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('ReportIssueModal', () => {
    it('creating an issue needs a category', async () => {
        render(<ReportIssueModal isOpen onClose={vi.fn()} currentScreen="Home" />);
        const create = screen.getByRole('button', { name: /Create GitHub Issue/ });
        expect(create).toBeDisabled();
        const firstCategory = screen.getAllByRole('button').find((b) => b !== create && b.textContent && b.textContent.length > 0 && !/Cancel/.test(b.textContent))!;
        await userEvent.click(firstCategory);
        expect(create).toBeEnabled();
    });

    it('Cancel closes', async () => {
        const onClose = vi.fn();
        render(<ReportIssueModal isOpen onClose={onClose} currentScreen="Home" />);
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalled();
    });
});
