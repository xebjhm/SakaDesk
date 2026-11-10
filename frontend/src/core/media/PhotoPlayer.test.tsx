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
});
