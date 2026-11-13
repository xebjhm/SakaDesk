import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { clientLog } from '../../utils/clientLog';
import en from '../../i18n/locales/en.json';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('../../utils/clientLog', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/clientLog')>()),
    clientLog: vi.fn(),
}));

const Boom = () => { throw new TypeError('boom'); };

describe('ErrorBoundary crash screen (UI health C-I1)', () => {
    beforeAll(async () => { await i18n.changeLanguage('ja'); });
    afterAll(async () => { await i18n.changeLanguage('en'); });

    it('speaks the UI language, uses the design system and leaves a breadcrumb', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { container } = render(<ErrorBoundary onReportIssue={vi.fn()}><Boom /></ErrorBoundary>);
        expect(screen.getByRole('heading', { name: '問題が発生しました' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /もう一度試す/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /問題を報告/ })).toBeInTheDocument();
        expect(container.innerHTML).not.toMatch(/(bg|text)-(gray|red|blue|white)/);
        // The error-state tile, not a solid danger header (DESIGN_SYSTEM "Semantic colours").
        expect(container.innerHTML).not.toContain('bg-status-danger');
        expect(container.querySelector('.bg-semantic-danger-icon.text-semantic-danger')).not.toBeNull();
        expect(container.firstElementChild).toHaveClass('items-safe-center');
        expect(clientLog).toHaveBeenCalledWith('app_load_failed', { target: 'render', error_type: 'typeerror' });
    });

    it('shows English, not raw keys, when i18n cannot resolve a key', async () => {
        await i18n.changeLanguage('en');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        // An uninitialised / failed i18n returns the key unless the call carries a defaultValue.
        const spy = vi.spyOn(i18n, 't').mockImplementation(((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never);
        try {
            const { container } = render(<ErrorBoundary onReportIssue={vi.fn()}><Boom /></ErrorBoundary>);
            expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Report issue/ })).toBeInTheDocument();
            // The inline defaults must stay equal to the English locale.
            expect(container.textContent).toContain(en.errorBoundary.body);
            expect(screen.getByRole('heading').textContent).toBe(en.errorBoundary.title);
            expect(container.textContent).not.toContain('errorBoundary.');
        } finally {
            spy.mockRestore();
            await i18n.changeLanguage('ja');
        }
    });
});
