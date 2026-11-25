import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { MediaGalleryModal } from './MediaGalleryModal';

describe('MediaGalleryModal tabs (UI health A-D5)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('moves between tabs with the arrow keys and labels the panel', async () => {
        render(<MediaGalleryModal isOpen onClose={() => {}} messages={[]} memberName="n" serviceId="hinatazaka46" />);
        const photos = screen.getByRole('tab', { name: 'Photos' });
        expect(photos).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('tab', { name: 'Videos' })).toHaveAttribute('tabindex', '-1');
        photos.focus();
        await userEvent.keyboard('{ArrowRight}');
        const videos = screen.getByRole('tab', { name: 'Videos' });
        expect(videos).toHaveFocus();
        expect(videos).toHaveAttribute('aria-selected', 'true');
        await userEvent.keyboard('{End}');
        expect(screen.getByRole('tab', { name: 'Voice messages' })).toHaveFocus();
        expect(screen.getByRole('tabpanel', { name: 'Voice messages' })).toBeInTheDocument();
    });
});
