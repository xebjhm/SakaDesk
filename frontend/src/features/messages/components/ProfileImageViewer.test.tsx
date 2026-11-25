import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileImageViewer } from './ProfileImageViewer';
import type { ProfileImagesByKind } from '../profileImages';

const images: ProfileImagesByKind = {
    thumbnail: [
        { url: '/t-new.jpg', first_seen: '2026-07-05T12:00:00Z', current: true },
        { url: '/t-old.jpg', first_seen: '2026-03-14T12:00:00Z', current: false },
    ],
    phone_image: [{ url: '/p.jpg', first_seen: null, current: true }],
};

describe('ProfileImageViewer', () => {
    it('opens on the requested kind, newest first, and only shows tabs for kinds with images', () => {
        render(<ProfileImageViewer images={images} initialKind="thumbnail" onClose={vi.fn()} />);
        expect(screen.getByRole('tab', { name: /Chat icon/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByRole('tab', { name: /List icon/ })).toBeNull();
        expect(document.querySelector('img')?.getAttribute('src')).toBe('/t-new.jpg');
        expect(screen.getByText(/– Now$/)).toBeInTheDocument();
    });

    it('← goes to the older version and → back to the newer, with oldest = 1 in the tab counter; a tab click switches kind and resets to newest', () => {
        render(<ProfileImageViewer images={images} initialKind="thumbnail" onClose={vi.fn()} />);
        fireEvent.keyDown(document.querySelector('[tabindex="-1"]')!, { key: 'ArrowRight' });
        expect(document.querySelector('img')?.getAttribute('src')).toBe('/t-new.jpg');
        fireEvent.keyDown(document.querySelector('[tabindex="-1"]')!, { key: 'ArrowLeft' });
        expect(document.querySelector('img')?.getAttribute('src')).toBe('/t-old.jpg');
        expect(screen.getByRole('tab', { name: /Chat icon 1\/2/ })).toBeInTheDocument();
        fireEvent.keyDown(document.querySelector('[tabindex="-1"]')!, { key: 'ArrowRight' });
        expect(document.querySelector('img')?.getAttribute('src')).toBe('/t-new.jpg');
        expect(screen.getByRole('tab', { name: /Chat icon 2\/2/ })).toBeInTheDocument();
        fireEvent.keyDown(document.querySelector('[tabindex="-1"]')!, { key: 'ArrowLeft' });
        fireEvent.click(screen.getByRole('tab', { name: /Call screen/ }));
        expect(document.querySelector('img')?.getAttribute('src')).toBe('/p.jpg');
    });

    it('falls back to the first available kind and clicking a tab does not close', () => {
        const onClose = vi.fn();
        render(<ProfileImageViewer images={images} initialKind="group_thumbnail" onClose={onClose} />);
        expect(screen.getByRole('tab', { name: /Chat icon/ })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('tab', { name: /Call screen/ }));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('follows the tabs pattern: roving tabindex, arrows and End move between kinds without stepping photos (UI health A-D5)', async () => {
        render(<ProfileImageViewer images={images} initialKind="thumbnail" onClose={vi.fn()} />);
        const chat = screen.getByRole('tab', { name: /Chat icon/ });
        const call = screen.getByRole('tab', { name: /Call screen/ });
        expect(chat).toHaveAttribute('tabindex', '0');
        expect(call).toHaveAttribute('tabindex', '-1');
        chat.focus();
        await userEvent.keyboard('{ArrowRight}');
        expect(call).toHaveFocus();
        expect(call).toHaveAttribute('aria-selected', 'true');
        expect(document.querySelector('img')?.getAttribute('src')).toBe('/p.jpg');
        await userEvent.keyboard('{ArrowRight}');
        expect(chat).toHaveFocus(); // wraps; the photo list was not stepped
        expect(document.querySelector('img')?.getAttribute('src')).toBe('/t-new.jpg');
        await userEvent.keyboard('{End}');
        expect(call).toHaveFocus();
        await userEvent.keyboard('{Home}');
        expect(chat).toHaveFocus();
    });
});
