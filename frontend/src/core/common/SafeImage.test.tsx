import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SafeImage } from './SafeImage';

describe('SafeImage skeleton', () => {
    it('shows a pulsing placeholder until the image loads', () => {
        const { container } = render(<SafeImage src="/a.jpg" skeletonClassName="h-48 w-64" />);
        const sk = screen.getByTestId('image-skeleton');
        expect(sk.className).toContain('animate-pulse');
        expect(sk.className).toContain('motion-reduce:animate-none');
        const img = container.querySelector('img')!;
        expect(img.className).toContain('hidden');
        fireEvent.load(img);
        expect(screen.queryByTestId('image-skeleton')).toBeNull();
        expect(img.className).not.toContain('hidden');
    });

    it('replaces the placeholder with the fallback when the image fails', () => {
        const { container } = render(<SafeImage src="/a.jpg" skeletonClassName="h-48 w-64" fallbackText="oops" />);
        fireEvent.error(container.querySelector('img')!);
        expect(screen.queryByTestId('image-skeleton')).toBeNull();
        expect(screen.getByText('oops')).toBeTruthy();
    });

    it('renders no placeholder without skeletonClassName', () => {
        render(<SafeImage src="/a.jpg" />);
        expect(screen.queryByTestId('image-skeleton')).toBeNull();
    });
});
