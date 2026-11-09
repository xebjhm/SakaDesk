import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemberContextMenu } from './MemberContextMenu';

describe('MemberContextMenu', () => {
    it('clamps the position into the viewport for a click near the bottom-right', async () => {
        render(<MemberContextMenu x={window.innerWidth - 2} y={window.innerHeight - 2} onViewImages={vi.fn()} onClose={vi.fn()} />);
        const menu = await screen.findByRole('menu');
        const left = parseFloat(menu.style.left);
        const top = parseFloat(menu.style.top);
        expect(left).toBeLessThan(window.innerWidth - 100);
        expect(top).toBeLessThan(window.innerHeight - 40);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
    });

    it('keeps the click position when there is room', async () => {
        render(<MemberContextMenu x={40} y={60} onViewImages={vi.fn()} onClose={vi.fn()} />);
        const menu = await screen.findByRole('menu');
        expect(menu.style.left).toBe('40px');
        expect(menu.style.top).toBe('60px');
    });
});
