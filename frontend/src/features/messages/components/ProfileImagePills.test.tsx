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

    it('hovers in the accent and shows the version count on the accent', () => {
        render(
            <ProfileImagePills
                images={{ thumbnail: [{ url: 'a', first_seen: null, current: true }, { url: 'b', first_seen: null, current: false }] }}
                onOpen={vi.fn()}
            />,
        );
        const pill = screen.getByRole('button', { name: /Chat icon/ });
        expect(pill).toHaveClass('hover:bg-accent-subtle', 'hover:text-accent-strong', 'focus-visible:ring-accent');
        expect(screen.getByText('2')).toHaveClass('bg-accent', 'text-inverse');
    });
});
