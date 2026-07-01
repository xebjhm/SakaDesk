import { describe, it, expect } from 'vitest';
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
});
