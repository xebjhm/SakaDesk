import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, act, within, waitFor } from '@testing-library/react';
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

    it('shows the archive stats in the display face with tabular numerals (pending decision D9)', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 10, 6, 12));
        server.use(http.get('/api/archive/stats', () => HttpResponse.json({
            messages: 12846, photos: 2301, first_message_at: new Date(2026, 10, 1, 12).toISOString(),
        })));
        render(<AboutModal isOpen onClose={vi.fn()} onOpenDiagnostics={vi.fn()} />);
        const stats = screen.getByTestId('about-stats');
        expect(within(stats).getByRole('heading', { name: 'Your archive' })).toBeInTheDocument();
        const messages = await within(stats).findByText('12,846');
        expect(messages).toHaveClass('font-display', 'tabular-nums');
        expect(within(stats).getByText('2,301')).toBeInTheDocument();
        expect(within(stats).getByText('6')).toBeInTheDocument();
        expect(within(stats).getByText('Days')).toBeInTheDocument();
        expect(clientLog).toHaveBeenCalledWith('archive_stats_load', { outcome: 'ok' });
        vi.useRealTimers();
    });

    it('hides the stats when they cannot be loaded', async () => {
        server.use(http.get('/api/archive/stats', () => new HttpResponse(null, { status: 500 })));
        render(<AboutModal isOpen onClose={vi.fn()} onOpenDiagnostics={vi.fn()} />);
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('archive_stats_load', { outcome: 'failed' }));
        expect(screen.queryByTestId('about-stats')).toBeNull();
    });
});
