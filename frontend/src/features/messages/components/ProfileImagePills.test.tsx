import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileImagePills } from './ProfileImagePills';

describe('ProfileImagePills', () => {
    it('renders one pill per kind that has images, with a count only for history', () => {
        const onOpen = vi.fn();
        render(
            <ProfileImagePills
                images={{
                    thumbnail: [
                        { url: 'a', first_seen: null, current: true },
                        { url: 'b', first_seen: null, current: false },
                        { url: 'c', first_seen: null, current: false },
                    ],
                    phone_image: [{ url: 'p', first_seen: null, current: true }],
                }}
                onOpen={onOpen}
            />,
        );
        expect(screen.queryByText('List icon')).toBeNull();
        expect(screen.getByRole('button', { name: /Chat icon/ })).toHaveTextContent('3');
        expect(screen.getByRole('button', { name: /Call screen/ })).not.toHaveTextContent(/\d/);
        fireEvent.click(screen.getByRole('button', { name: /Call screen/ }));
        expect(onOpen).toHaveBeenCalledWith('phone_image');
    });

    it('renders nothing without images', () => {
        const { container } = render(<ProfileImagePills images={{}} onOpen={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('hovers neutral and shows the version count as neutral metadata', () => {
        render(
            <ProfileImagePills
                images={{ thumbnail: [{ url: 'a', first_seen: null, current: true }, { url: 'b', first_seen: null, current: false }] }}
                onOpen={vi.fn()}
            />,
        );
        const pill = screen.getByRole('button', { name: /Chat icon/ });
        expect(pill).toHaveClass('hover:bg-sunken', 'hover:text-primary', 'focus-visible:ring-accent');
        expect(pill.className).not.toContain('hover:bg-accent');
        expect(pill.className).not.toContain('hover:text-accent');
        const badge = screen.getByText('2');
        expect(badge).toHaveClass('bg-sunken', 'text-secondary', 'ring-1', 'ring-strong');
        expect(badge.className).not.toContain('bg-accent');
    });
});
