import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PhotoPlayer } from './PhotoPlayer';

describe('PhotoPlayer', () => {
    it('resets the broken-image state when src changes (fullscreen navigation)', () => {
        const { queryByAltText, rerender } = render(
            <PhotoPlayer variant="fullscreen" src="/photo-a.jpg" alt="photo A" />
        );

        // A broken/missing photo trips the error fallback.
        const img = queryByAltText('photo A') as HTMLImageElement;
        expect(img).toBeTruthy();
        fireEvent.error(img);
        expect(queryByAltText('photo A')).toBeNull(); // fallback shown, img gone

        // Navigating to another photo (same instance, new src) must recover —
        // previously hasError latched and every later photo stayed broken.
        rerender(<PhotoPlayer variant="fullscreen" src="/photo-b.jpg" alt="photo B" />);
        expect(queryByAltText('photo B')).toBeTruthy();
    });

    it('switches to fallbackSrc when src fails, and only then shows the broken look', () => {
        const onError = vi.fn();
        const { getByAltText, queryByAltText } = render(
            <PhotoPlayer variant="bubble" src="/thumb.webp" fallbackSrc="/full.jpg" alt="photo" onError={onError} />
        );
        fireEvent.error(getByAltText('photo'));
        expect(getByAltText('photo')).toHaveAttribute('src', '/full.jpg');
        expect(onError).not.toHaveBeenCalled();
        fireEvent.error(getByAltText('photo'));
        expect(queryByAltText('photo')).toBeNull();
        expect(onError).toHaveBeenCalledTimes(1);
    });

    describe('bubble load state (L5)', () => {
        it('starts transparent, fades in on load and reports it once', () => {
            const onLoad = vi.fn();
            const { getByAltText } = render(<PhotoPlayer variant="bubble" src="/写真🌸.jpg" alt="photo" onLoad={onLoad} />);
            const img = getByAltText('photo');
            expect(img.className).toContain('opacity-0');
            expect(img.className).toContain('transition-opacity');
            expect(img.className).toContain('motion-reduce:transition-none');
            fireEvent.load(img);
            expect(img.className).toContain('opacity-100');
            expect(onLoad).toHaveBeenCalledTimes(1);
        });

        it('shows an already complete (cached) image at once and reports it', () => {
            const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
            const natural = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
            Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true });
            Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 640 });
            try {
                const onLoad = vi.fn();
                const { getByAltText } = render(<PhotoPlayer variant="bubble" src="/cached.jpg" alt="photo" onLoad={onLoad} />);
                expect(getByAltText('photo').className).toContain('opacity-100');
                expect(onLoad).toHaveBeenCalledTimes(1);
            } finally {
                if (complete) Object.defineProperty(HTMLImageElement.prototype, 'complete', complete);
                if (natural) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', natural);
                else delete (HTMLImageElement.prototype as { naturalWidth?: number }).naturalWidth;
            }
        });

        it('a complete but broken image (naturalWidth 0) is not treated as loaded', () => {
            const onLoad = vi.fn();
            const { getByAltText } = render(<PhotoPlayer variant="bubble" src="/broken.jpg" alt="photo" onLoad={onLoad} />);
            expect(getByAltText('photo').className).toContain('opacity-0');
            expect(onLoad).not.toHaveBeenCalled();
        });

        it('the fullscreen variant has no fade', () => {
            const { getByAltText } = render(<PhotoPlayer variant="fullscreen" src="/full.jpg" alt="photo" />);
            expect(getByAltText('photo').className).not.toContain('opacity-0');
        });
    });
});
