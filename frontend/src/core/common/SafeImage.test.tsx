import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SafeImage } from './SafeImage';

describe('SafeImage skeleton', () => {
    it('shows a pulsing placeholder until the image loads', () => {
        const { container } = render(<SafeImage src="/a.jpg" skeletonClassName="h-48 w-64" />);
        const sk = screen.getByTestId('image-skeleton');
        expect(sk.className).toContain('animate-pulse');
        expect(sk.className).toContain('motion-reduce:animate-none');
        // Phrasing content, so it is valid inside a <button>; block so it keeps its size.
        expect(sk.tagName).toBe('SPAN');
        expect(sk.className).toMatch(/(^|\s)block(\s|$)/);
        const img = container.querySelector('img')!;
        // Must stay laid out (not display:none) or a lazy image never loads.
        expect(img.className).not.toMatch(/(^|\s)hidden(\s|$)/);
        expect(img.className).toContain('opacity-0');
        fireEvent.load(img);
        expect(screen.queryByTestId('image-skeleton')).toBeNull();
        expect(img.className).not.toContain('opacity-0');
    });

    it('replaces the placeholder with the fallback when the image fails', () => {
        const { container } = render(<SafeImage src="/a.jpg" skeletonClassName="h-48 w-64" fallbackText="oops" />);
        fireEvent.error(container.querySelector('img')!);
        expect(screen.queryByTestId('image-skeleton')).toBeNull();
        expect(screen.getByText('oops')).toBeTruthy();
    });

    it('draws the fallback with design tokens in spans (valid inside a button)', () => {
        const { container } = render(
            <button type="button"><SafeImage src="/a.jpg" className="h-10 w-10" /></button>,
        );
        fireEvent.error(container.querySelector('img')!);
        const fb = screen.getByTestId('image-fallback');
        expect(fb.tagName).toBe('SPAN');
        expect(fb.className).toContain('bg-sunken');
        expect(fb.className).toContain('h-10');
        expect(fb.querySelector('svg')!.getAttribute('class')).toContain('text-muted');
        expect(container.querySelector('button div')).toBeNull();
        expect(container.innerHTML).not.toMatch(/gray-\d/);
    });

    it('shows fallback text in the secondary text token', () => {
        const { container } = render(<SafeImage src="/a.jpg" fallbackText="oops" />);
        fireEvent.error(container.querySelector('img')!);
        const text = screen.getByText('oops');
        expect(text.tagName).toBe('SPAN');
        expect(text.className).toContain('text-secondary');
    });

    it('renders no placeholder without skeletonClassName', () => {
        render(<SafeImage src="/a.jpg" />);
        expect(screen.queryByTestId('image-skeleton')).toBeNull();
    });

    it('resets loaded/failed state when src changes', () => {
        const { container, rerender } = render(<SafeImage src="/a.jpg" skeletonClassName="h-48 w-64" fallbackText="oops" />);
        fireEvent.error(container.querySelector('img')!);
        expect(screen.getByText('oops')).toBeTruthy();
        rerender(<SafeImage src="/b.jpg" skeletonClassName="h-48 w-64" fallbackText="oops" />);
        expect(screen.getByTestId('image-skeleton')).toBeTruthy();
        fireEvent.load(container.querySelector('img')!);
        rerender(<SafeImage src="/c.jpg" skeletonClassName="h-48 w-64" />);
        expect(screen.getByTestId('image-skeleton')).toBeTruthy();
    });
});
