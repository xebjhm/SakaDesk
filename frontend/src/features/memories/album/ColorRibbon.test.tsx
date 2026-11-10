import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { ColorRibbon } from './ColorRibbon';

beforeAll(async () => { await i18n.changeLanguage('en'); });

const MONTHS = [
    { month: '2026-10', color: 'coral' },
    { month: '2026-09', color: null },
    { month: '2025-01', color: 'teal' },
];

describe('ColorRibbon', () => {
    it('draws one labelled segment per month, newest at the top, in the ribbon colours', () => {
        render(<ColorRibbon months={MONTHS} onSelect={vi.fn()} />);
        const segments = screen.getAllByRole('button');
        expect(segments.map((s) => s.getAttribute('aria-label'))).toEqual(['Go to October 2026', 'Go to September 2026', 'Go to January 2025']);
        expect(segments[0].style.backgroundColor).toBe('coral');
        // a month without a colour falls back to a neutral segment
        expect(segments[1].style.backgroundColor).toBe('');
        expect(segments[1]).toHaveClass('bg-sunken');
    });

    it('selects a month on click', async () => {
        const onSelect = vi.fn();
        render(<ColorRibbon months={MONTHS} onSelect={onSelect} />);
        await userEvent.click(screen.getByRole('button', { name: 'Go to September 2026' }));
        expect(onSelect).toHaveBeenCalledWith('2026-09');
    });

    it('moves between months with the up and down keys', () => {
        const onSelect = vi.fn();
        render(<ColorRibbon months={MONTHS} onSelect={onSelect} />);
        const first = screen.getByRole('button', { name: 'Go to October 2026' });
        first.focus();
        fireEvent.keyDown(first, { key: 'ArrowDown' });
        expect(onSelect).toHaveBeenLastCalledWith('2026-09');
        expect(screen.getByRole('button', { name: 'Go to September 2026' })).toHaveFocus();
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
        expect(onSelect).toHaveBeenLastCalledWith('2026-10');
        // stops at the ends
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
        expect(onSelect).toHaveBeenCalledTimes(2);
    });

    it('scrubs by dragging along the ribbon', () => {
        const onSelect = vi.fn();
        render(<ColorRibbon months={MONTHS} onSelect={onSelect} />);
        const ribbon = screen.getByTestId('album-ribbon');
        ribbon.getBoundingClientRect = () => ({ top: 0, height: 300, bottom: 300, left: 0, right: 12, width: 12, x: 0, y: 0, toJSON: () => ({}) });
        ribbon.setPointerCapture = vi.fn();
        fireEvent.pointerDown(ribbon, { clientY: 10, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(ribbon, { clientY: 250, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(ribbon, { clientY: 260, pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(ribbon, { clientY: 260, pointerId: 1 });
        expect(onSelect.mock.calls.map((c) => c[0])).toEqual(['2026-10', '2025-01']);
    });
});
