import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';
import i18n from '../../i18n';
import { AboutModal } from './AboutModal';

beforeAll(async () => { await i18n.changeLanguage('en'); });

afterEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); });

describe('AboutModal', () => {
    it('is a brand dialog with the aurora header and a serif wordmark (D7)', () => {
        render(<AboutModal isOpen onClose={vi.fn()} onOpenDiagnostics={vi.fn()} />);
        expect(screen.getByRole('dialog')).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByTestId('modal-header')).toHaveClass('bg-expressive-header');
        expect(screen.getByText('SakaDesk', { selector: 'h3' })).toHaveClass('font-display', 'font-bold');
        expect(screen.getByRole('link', { name: /github\.com/ })).toHaveClass('focus-visible:ring-accent');
    });

    it.each(['en', 'ja', 'zh-TW'])('names the heart button in %s', async (lang) => {
        await act(async () => { await i18n.changeLanguage(lang); });
        render(<AboutModal isOpen onClose={vi.fn()} onOpenDiagnostics={vi.fn()} />);
        const expected = i18n.t('about.madeWithLove');
        expect(expected).not.toBe('about.madeWithLove');
        expect(screen.getByRole('button', { name: expected })).toBeInTheDocument();
    });

    it('opens on a hero of brand orbs with the display wordmark (pending decision D8)', () => {
        render(<AboutModal isOpen onClose={vi.fn()} onOpenDiagnostics={vi.fn()} />);
        const hero = screen.getByTestId('about-hero');
        expect(hero.parentElement?.parentElement?.querySelectorAll('[data-testid="atmosphere-orb"]')).toHaveLength(3);
        expect(screen.getByText('SakaDesk', { selector: 'h3' })).toHaveClass('text-display');
    });

    it('shows only SakaDesk information: no archive stats, no stats request', async () => {
        const statsRequested = vi.fn();
        server.use(http.get('/api/archive/stats', () => {
            statsRequested();
            return HttpResponse.json({ messages: 12846, photos: 2301, first_message_at: null });
        }));
        render(<AboutModal isOpen onClose={vi.fn()} onOpenDiagnostics={vi.fn()} />);
        const dialog = screen.getByRole('dialog');
        expect(screen.queryByTestId('about-stats')).toBeNull();
        for (const label of ['Your archive', 'Messages', 'Photos', 'Days']) {
            expect(within(dialog).queryByText(label)).toBeNull();
        }
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(statsRequested).not.toHaveBeenCalled();
        expect(clientLog).not.toHaveBeenCalledWith('archive_stats_load', expect.anything());
        expect(within(dialog).getByText('SakaDesk', { selector: 'h3' })).toBeInTheDocument();
    });
});
