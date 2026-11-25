import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { installMediaTileHarness } from '../../../__tests__/mediaTileHarness';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { OnThisDayCard } from './OnThisDayCard';
import { hubMoment } from './__fixtures__';
import { memoryMessage, MEMBER_PATH } from '../__fixtures__/memories';
import { NicknameProvider } from '../shared/useNickname';

beforeAll(async () => { await i18n.changeLanguage('en'); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('OnThisDayCard', () => {
    it('labels a today moment by its years ago, with her name, words and photo', () => {
        render(<NicknameProvider nickname="みくちゃん"><OnThisDayCard moment={hubMoment()} go={vi.fn()} /></NicknameProvider>);
        const card = screen.getByTestId('memories-hub-otd');
        expect(card).toHaveTextContent('2 years ago today');
        expect(screen.getByText('金村 美玖')).toHaveAttribute('lang', 'ja');
        const words = screen.getByTestId('memory-text');
        expect(words).toHaveAttribute('lang', 'ja');
        expect(words).toHaveTextContent('みくちゃん、おはよう🌸');
        expect(words).toHaveClass('line-clamp-3');
        expect(within(card).getByTestId('memory-thumb')).toBeInTheDocument();
    });

    it('uses the singular for one year ago', () => {
        render(<OnThisDayCard moment={hubMoment({ years_ago: 1, year: 2025 })} go={vi.fn()} />);
        expect(screen.getByTestId('memories-hub-otd')).toHaveTextContent('1 year ago today');
    });

    it('never calls a week moment "today"', () => {
        render(<OnThisDayCard moment={hubMoment({ rule: 'week', date: '2024-11-08' })} go={vi.fn()} />);
        const card = screen.getByTestId('memories-hub-otd');
        expect(card).toHaveTextContent('This week, 2 years ago');
        expect(card).not.toHaveTextContent(/today/i);
    });

    it('gives a first moment its own copy and never "0 years"', () => {
        render(<OnThisDayCard moment={hubMoment({ rule: 'first', year: 2026, years_ago: 0, date: '2026-02-01' })} go={vi.fn()} />);
        const card = screen.getByTestId('memories-hub-otd');
        expect(card).toHaveTextContent('From the early days');
        expect(card).not.toHaveTextContent(/today|years? ago|\b0\b/i);
    });

    it('shows a photo-only moment as its photo, without words', () => {
        const photo = memoryMessage({ id: 9, type: 'picture', text: null, media_url: '/api/content/media/hinatazaka46/q.jpg' });
        render(<OnThisDayCard moment={hubMoment({ message: photo, photo: null })} go={vi.fn()} />);
        expect(screen.queryByTestId('memory-text')).toBeNull();
        expect(within(screen.getByTestId('memories-hub-otd')).getByTestId('memory-thumb')).toBeInTheDocument();
    });

    it('shows a text moment without a photo as words only', () => {
        render(<OnThisDayCard moment={hubMoment({ photo: null })} go={vi.fn()} />);
        expect(within(screen.getByTestId('memories-hub-otd')).queryByTestId('memory-thumb')).toBeNull();
    });

    it.each([
        ['today', '2024-11-10', { page: 'onThisDay' }],
        ['week', '2024-11-08', { page: 'onThisDay', monthDay: '11-08' }],
        ['first', '2019-03-01', { page: 'memoir', memberPath: MEMBER_PATH }],
    ] as const)('a %s moment routes to its page', async (rule, date, route) => {
        const go = vi.fn();
        render(<OnThisDayCard moment={hubMoment({ rule, date })} go={go} />);
        await userEvent.click(screen.getByTestId('memories-hub-otd'));
        expect(go).toHaveBeenCalledWith(route);
    });

    it('hides the photo frame when the photo cannot load at all', async () => {
        const h = installMediaTileHarness();
        render(<OnThisDayCard moment={hubMoment()} go={vi.fn()} />);
        expect(screen.getByTestId('memories-hub-otd-photo')).toBeInTheDocument();
        // The thumbnail fails (falls back to the full file), then the full file fails too.
        await waitFor(() => expect(h.requested()).toHaveLength(1));
        await h.fail();
        await waitFor(() => expect(h.requested()).toHaveLength(2));
        expect(screen.getByTestId('memories-hub-otd-photo')).toBeInTheDocument();
        await h.fail();
        await waitFor(() => expect(screen.queryByTestId('memories-hub-otd-photo')).toBeNull());
        expect(screen.queryByTestId('memories-hub-otd-photo')).toBeNull();
        expect(screen.getByTestId('memory-text')).toBeInTheDocument();
    });
});
