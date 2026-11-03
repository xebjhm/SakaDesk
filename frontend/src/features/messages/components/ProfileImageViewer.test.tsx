import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

    it('arrow keys move within the kind; a tab click switches kind and resets to newest', () => {
        render(<ProfileImageViewer images={images} initialKind="thumbnail" onClose={vi.fn()} />);
        fireEvent.keyDown(document.querySelector('[tabindex="-1"]')!, { key: 'ArrowRight' });
        expect(document.querySelector('img')?.getAttribute('src')).toBe('/t-old.jpg');
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
});
