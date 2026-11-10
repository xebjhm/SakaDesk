import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryThumb } from './MemoryThumb';

describe('MemoryThumb', () => {
    it('shows a picture as an image', () => {
        const { container } = render(<MemoryThumb message={{ type: 'picture', media_url: '/p.jpg' }} />);
        expect(container.querySelector('img')).toHaveAttribute('src', '/p.jpg');
    });

    it('never puts a video into an image', () => {
        const { container } = render(<MemoryThumb message={{ type: 'video', media_url: '/v.mp4' }} />);
        expect(container.querySelector('img')).toBeNull();
        const video = screen.getByTestId('memory-thumb-video') as HTMLVideoElement;
        expect(video).toHaveAttribute('src', '/v.mp4');
        expect(video.muted).toBe(true);
        expect(video).toHaveAttribute('preload', 'metadata');
    });

    it('shows a film tile for a video without a file and nothing for text', () => {
        render(<MemoryThumb message={{ type: 'video', media_url: null }} />);
        expect(screen.getByTestId('memory-thumb-video-tile')).toBeInTheDocument();
        const { container } = render(<MemoryThumb message={{ type: 'text', media_url: null }} />);
        expect(container).toBeEmptyDOMElement();
    });
});
