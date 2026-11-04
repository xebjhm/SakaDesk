import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { VideoPlayer } from './VideoPlayer';

function escape(): KeyboardEvent {
    return new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
}

function openMenu(container: HTMLElement) {
    const menuButton = container.querySelector('button.text-white\\/60')!;
    fireEvent.click(menuButton);
}

describe('VideoPlayer menu Escape', () => {
    beforeEach(() => {
        window.HTMLMediaElement.prototype.play = (() => Promise.resolve()) as never;
        window.HTMLMediaElement.prototype.pause = (() => undefined) as never;
        window.HTMLMediaElement.prototype.load = (() => undefined) as never;
    });

    it('claims Escape (defaultPrevented) when it closes the open menu', () => {
        const { container } = render(<VideoPlayer src="/api/media/v.mp4" />);
        openMenu(container);
        expect(screen.getByText('Loop')).toBeInTheDocument();

        const ev = escape();
        act(() => { document.dispatchEvent(ev); });

        expect(ev.defaultPrevented).toBe(true);
        expect(screen.queryByText('Loop')).toBeNull();
    });

    it('leaves Escape unclaimed when no menu is open', () => {
        render(<VideoPlayer src="/api/media/v.mp4" />);
        const ev = escape();
        act(() => { document.dispatchEvent(ev); });
        expect(ev.defaultPrevented).toBe(false);
    });

    it('ignores other keys while the menu is open', () => {
        const { container } = render(<VideoPlayer src="/api/media/v.mp4" />);
        openMenu(container);
        const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
        act(() => { document.dispatchEvent(ev); });
        expect(ev.defaultPrevented).toBe(false);
        expect(screen.getByText('Loop')).toBeInTheDocument();
    });
});

describe('VideoPlayer shortcuts', () => {
    beforeEach(() => {
        window.HTMLMediaElement.prototype.play = (() => Promise.resolve()) as never;
        window.HTMLMediaElement.prototype.pause = (() => undefined) as never;
        window.HTMLMediaElement.prototype.load = (() => undefined) as never;
    });

    it('does not run player shortcuts for keys pressed inside its menu', () => {
        const { container } = render(<VideoPlayer src="/api/media/v.mp4" viewerMode />);
        openMenu(container);
        const item = screen.getByRole('menuitemradio', { name: '1x' });
        for (const key of ['m', 'f']) {
            const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
            act(() => { item.dispatchEvent(ev); });
            expect(ev.defaultPrevented).toBe(false);
        }
    });

    it('still runs the shortcut outside the menu', () => {
        render(<VideoPlayer src="/api/media/v.mp4" viewerMode />);
        const ev = new KeyboardEvent('keydown', { key: 'm', bubbles: true, cancelable: true });
        act(() => { document.body.dispatchEvent(ev); });
        expect(ev.defaultPrevented).toBe(true);
    });
});
