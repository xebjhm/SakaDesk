import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Canvas, Sheet, Card, Pill } from './index';

describe('surface primitives', () => {
    it.each([
        ['Canvas', Canvas, ['bg-group-canvas']],
        ['Sheet', Sheet, ['bg-sheet', 'rounded-sheet', 'shadow-sheet']],
        ['Card', Card, ['bg-card', 'rounded-card', 'shadow-card']],
    ] as const)('%s renders its level classes and merges className', (_name, Component, classes) => {
        render(<Component data-testid="s" className="p-4">日向坂 🌸</Component>);
        const el = screen.getByTestId('s');
        expect(el).toHaveTextContent('日向坂 🌸');
        for (const c of classes) expect(el).toHaveClass(c);
        expect(el).toHaveClass('p-4');
    });

    it('Canvas has no radius or shadow', () => {
        render(<Canvas data-testid="c" />);
        expect(screen.getByTestId('c').className).not.toMatch(/rounded|shadow/);
    });
});

describe('Pill', () => {
    it('is a button that reports its selected state', async () => {
        const onClick = vi.fn();
        render(
            <>
                <Pill onClick={onClick}>すべて</Pill>
                <Pill selected>未読</Pill>
            </>,
        );
        const all = screen.getByRole('button', { name: 'すべて' });
        const unread = screen.getByRole('button', { name: '未読' });
        expect(all).toHaveAttribute('type', 'button');
        expect(all).toHaveAttribute('aria-pressed', 'false');
        expect(unread).toHaveAttribute('aria-pressed', 'true');
        expect(all).toHaveClass('rounded-pill', 'shadow-pill');
        await userEvent.click(all);
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('never uses the group colour for the selected state', () => {
        render(<Pill selected>x</Pill>);
        const btn = screen.getByRole('button');
        expect(btn.className).not.toMatch(/\b(bg|text)-group-/);
        expect(btn).toHaveClass('focus-visible:ring-group');
    });
});
