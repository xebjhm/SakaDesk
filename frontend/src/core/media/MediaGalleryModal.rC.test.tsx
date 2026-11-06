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

const voice = { id: 7, content: null, timestamp: '2026-11-03T04:00:00Z', type: 'voice', is_favorite: false, media_file: 'messages/a/voice/7.m4a', media_duration: 12 } as unknown as Message;

describe('MediaGalleryModal (R-c)', () => {
    it('has the image icon and an accent tab selection (e4e4118: accent text, accent-border bar)', () => {
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[voice]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        expect(screen.getByTestId('modal-header-icon')).toBeInTheDocument();
        const photos = screen.getByRole('tab', { name: 'Photos' });
        expect(photos).toHaveClass('text-accent-strong', 'focus-visible:ring-accent');
        expect(photos.querySelector('span[aria-hidden="true"]')).toHaveClass('bg-accent-border');
    });

    it('selects a voice row with the accent roles and marks the name ja', async () => {
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[voice]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        await userEvent.click(screen.getByRole('tab', { name: 'Voice messages' }));
        const row = screen.getByRole('button', { name: /春野 ひなた/ });
        // The newest voice is selected by default; clicking keeps it selected.
        await userEvent.click(row);
        expect(row).toHaveAttribute('aria-pressed', 'true');
        expect(row).toHaveClass('bg-accent-subtle', 'focus-visible:ring-accent');
        const name = within(row).getByText('春野 ひなた');
        expect(name).toHaveAttribute('lang', 'ja');
        expect(name).toHaveClass('text-accent-strong');
    });
});
