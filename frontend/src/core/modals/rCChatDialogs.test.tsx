import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { CalendarModal } from './CalendarModal';
import { BackgroundModal } from './BackgroundModal';
import { FavoritesModal } from './FavoritesModal';
import { SentLettersModal } from './SentLettersModal';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import type { Message } from '../../types';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../utils/backgroundSettings', async (orig) => ({
    ...(await orig<typeof import('../../utils/backgroundSettings')>()),
    saveBackgroundSettings: vi.fn(),
}));

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    resetDialogStack();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

const msg = (over: Partial<Message>): Message => ({ id: 1, content: 'x', timestamp: '2026-06-10T03:00:00Z', type: 'text', is_favorite: false, ...over } as Message);

describe('CalendarModal (R-c)', () => {
    it('restores the modal accents: header icon, accent dots, accent hover and the ring on today', () => {
        render(<CalendarModal isOpen onClose={vi.fn()} messages={[msg({ media_file: 'p/1.jpg', type: 'picture' })]} onSelectDate={vi.fn()} />);
        expect(screen.getByTestId('modal-header-icon')).toBeInTheDocument();
        const today = screen.getAllByRole('button', { name: '10' })[0];
        expect(today).toHaveClass('ring-2', 'ring-inset', 'ring-accent', 'hover:bg-accent-subtle', 'focus-visible:ring-accent');
        expect(today).not.toHaveClass('bg-sunken');
        expect(today.querySelector('span[aria-hidden="true"]')).toHaveClass('h-1.5', 'w-1.5', 'bg-accent');
    });
});

describe('BackgroundModal (R-c)', () => {
    it('restores the accent selection, dashed upload, accent slider and the palette icon', () => {
        render(<BackgroundModal isOpen onClose={vi.fn()} conversationPath="p" onSettingsChange={vi.fn()} />);
        expect(screen.getByTestId('modal-header-icon')).toBeInTheDocument();
        fireEvent.click(screen.getByTitle('#FEE2E2'));
        expect(screen.getByTitle('#FEE2E2')).toHaveClass('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-surface');
        expect(screen.getByRole('button', { name: /Upload/ })).toHaveClass('border-dashed', 'hover:border-accent-border', 'hover:text-accent-strong');
        expect(screen.getByRole('slider')).toHaveClass('accent-accent');
    });
});

describe('FavoritesModal (R-c)', () => {
    const favs = [
        msg({ id: 1, content: '今日もありがとう🌸', is_favorite: true }),
        msg({ id: 2, type: 'picture', content: null as unknown as string, media_file: 'messages/a/picture/2.jpg', is_favorite: true, timestamp: '2026-06-09T03:00:00Z' }),
    ];

    it('marks a bookmarked message with the yellow semantic star, in every group', () => {
        render(<FavoritesModal isOpen onClose={vi.fn()} messages={favs} memberName="春野 ひなた" serviceId="sakurazaka46" />);
        const dialog = screen.getByRole('dialog', { name: 'Favorites' });
        const stars = dialog.querySelectorAll('svg.text-semantic-star');
        expect(stars.length).toBe(2);
        expect(stars[0]).toHaveClass('fill-current', 'drop-shadow-sm');
        expect(screen.getByTestId('modal-header-icon')).toBeInTheDocument();
    });

    it('marks member names and message text as Japanese content', () => {
        render(<FavoritesModal isOpen onClose={vi.fn()} messages={favs} memberName="春野 ひなた" serviceId="sakurazaka46" />);
        for (const name of screen.getAllByText('春野 ひなた')) expect(name).toHaveAttribute('lang', 'ja');
        expect(screen.getByText('今日もありがとう🌸')).toHaveAttribute('lang', 'ja');
    });

    it('opens the dark viewer with a circular close button', async () => {
        vi.useRealTimers();
        render(<FavoritesModal isOpen onClose={vi.fn()} messages={favs} memberName="春野 ひなた" serviceId="sakurazaka46" />);
        await userEvent.click(within(screen.getByRole('dialog', { name: 'Favorites' })).getAllByRole('button').find((b) => b.querySelector('img'))!);
        const viewer = screen.getByRole('dialog', { name: /media viewer/i });
        expect(within(viewer).getByRole('button', { name: 'Close' })).toHaveClass('rounded-full');
        expect(within(viewer).getByText('春野 ひなた')).toHaveAttribute('lang', 'ja');
    });
});

describe('SentLettersModal (R-c)', () => {
    const letters = [{ id: 1, text: 'ありがとう🌸', created_at: '2025-05-05T14:00:00Z', image_url: null, width: null, height: null }];

    it('has the mail icon, marks letter text ja and lights the card in the accent on hover (D4)', () => {
        render(<SentLettersModal isOpen onClose={vi.fn()} letters={letters} status="ready" onSelectLetter={vi.fn()} />);
        expect(screen.getByTestId('modal-header-icon')).toBeInTheDocument();
        expect(screen.getByText('ありがとう🌸')).toHaveAttribute('lang', 'ja');
        const card = screen.getByRole('button', { name: /^Letter sent/ });
        expect(card).toHaveClass('focus-visible:ring-accent');
        expect(card.firstElementChild).toHaveClass('group-hover:ring-accent-border', 'group-hover:shadow-accent-glow-hover');
        expect(card.querySelector('time')).toHaveClass('group-hover:text-accent-strong');
    });
});
