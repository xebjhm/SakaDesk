import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { MediaGalleryModal } from './MediaGalleryModal';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import type { Message } from '../../types';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    resetDialogStack();
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
});
afterEach(() => vi.unstubAllGlobals());

const older = { id: 3, content: null, timestamp: '2026-10-01T04:00:00Z', type: 'voice', is_favorite: false, media_file: 'messages/a/voice/3.m4a', media_duration: 34 } as unknown as Message;
const voice = { id: 7, content: null, timestamp: '2026-11-03T04:00:00Z', type: 'voice', is_favorite: false, media_file: 'messages/a/voice/7.m4a', media_duration: 12 } as unknown as Message;

describe('MediaGalleryModal (R-c)', () => {
    it('has the image icon and an accent tab selection (e4e4118: accent text, accent-border bar)', () => {
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[voice]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        expect(screen.getByTestId('modal-header-icon')).toBeInTheDocument();
        const photos = screen.getByRole('tab', { name: 'Photos' });
        expect(photos).toHaveClass('text-accent-strong', 'focus-visible:ring-accent');
        expect(photos.querySelector('span[aria-hidden="true"]')).toHaveClass('bg-accent-border');
        const videos = screen.getByRole('tab', { name: 'Videos' });
        expect(videos).toHaveClass('text-muted', 'hover:text-secondary');
        expect(videos).not.toHaveClass('text-accent-strong');
        expect(videos.querySelector('span[aria-hidden="true"]')).toBeNull();
    });

    it('flips voice row selection to the accent roles and marks the name ja', async () => {
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[voice, older]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        await userEvent.click(screen.getByRole('tab', { name: 'Voice messages' }));
        const rowFor = (duration: string) => screen.getAllByRole('button', { name: /春野 ひなた/ }).find((b) => b.textContent?.includes(duration))!;
        const newer = rowFor('00:12');
        const old = rowFor('00:34');
        // The newest voice is selected by default; the older one is not.
        expect(newer).toHaveAttribute('aria-pressed', 'true');
        expect(old).toHaveAttribute('aria-pressed', 'false');
        expect(old).toHaveClass('hover:bg-sunken');
        expect(old).not.toHaveClass('bg-accent-subtle');
        expect(within(old).getByText('春野 ひなた')).toHaveClass('text-primary');
        expect(within(old).getByText('00:34')).toHaveClass('text-muted');

        await userEvent.click(old);
        expect(old).toHaveAttribute('aria-pressed', 'true');
        expect(old).toHaveClass('bg-accent-subtle', 'focus-visible:ring-accent');
        expect(old).not.toHaveClass('hover:bg-sunken');
        const name = within(old).getByText('春野 ひなた');
        expect(name).toHaveAttribute('lang', 'ja');
        expect(name).toHaveClass('text-accent-strong');
        expect(within(old).getByText('00:34')).toHaveClass('text-accent-strong');

        expect(newer).toHaveAttribute('aria-pressed', 'false');
        expect(newer).toHaveClass('hover:bg-sunken');
        expect(newer).not.toHaveClass('bg-accent-subtle');
        expect(within(newer).getByText('春野 ひなた')).toHaveClass('text-primary');
    });
});
