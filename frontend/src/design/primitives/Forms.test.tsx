import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './Switch';
import { Input, Select } from './Field';

describe('Switch', () => {
    it('is a named switch that reports the next value', async () => {
        const onCheckedChange = vi.fn();
        render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="着信 📞" />);
        const sw = screen.getByRole('switch', { name: '着信 📞' });
        expect(sw).toHaveAttribute('aria-checked', 'false');
        expect(sw).toHaveClass('bg-control-off');
        await userEvent.click(sw);
        expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('is the group action colour when on, and can be disabled', () => {
        render(<Switch checked onCheckedChange={vi.fn()} aria-label="a" disabled />);
        const sw = screen.getByRole('switch', { name: 'a' });
        expect(sw).toHaveClass('bg-group-accent');
        expect(sw).toBeDisabled();
    });
});

describe('Switch behaviour', () => {
    it('toggles off, with the keyboard, and not when disabled', async () => {
        const onCheckedChange = vi.fn();
        const { rerender } = render(<Switch checked onCheckedChange={onCheckedChange} aria-label="s" />);
        await userEvent.click(screen.getByRole('switch'));
        expect(onCheckedChange).toHaveBeenLastCalledWith(false);
        screen.getByRole('switch').focus();
        await userEvent.keyboard(' ');
        expect(onCheckedChange).toHaveBeenCalledTimes(2);
        rerender(<Switch checked onCheckedChange={onCheckedChange} aria-label="s" disabled />);
        await userEvent.click(screen.getByRole('switch'));
        expect(onCheckedChange).toHaveBeenCalledTimes(2);
    });

    it('forwards its ref, does not let a caller onClick replace the toggle, and keeps a visible ring offset', async () => {
        const ref = createRef<HTMLButtonElement>();
        const onCheckedChange = vi.fn();
        const stray = vi.fn();
        // @ts-expect-error onClick is not part of the Switch props
        render(<Switch ref={ref} checked onCheckedChange={onCheckedChange} aria-label="s" onClick={stray} />);
        expect(ref.current).toBe(screen.getByRole('switch'));
        await userEvent.click(screen.getByRole('switch'));
        expect(onCheckedChange).toHaveBeenCalledWith(false);
        expect(stray).not.toHaveBeenCalled();
        expect(screen.getByRole('switch')).toHaveClass('focus-visible:ring-offset-2', 'focus-visible:ring-offset-surface');
    });
});

describe('Input and Select', () => {
    it('share the pill field look and the group focus ring', () => {
        render(
            <>
                <Input aria-label="フォルダ" defaultValue="C:\\データ" />
                <Select aria-label="言語"><option>日本語</option></Select>
            </>,
        );
        for (const el of [screen.getByRole('textbox', { name: 'フォルダ' }), screen.getByRole('combobox', { name: '言語' })]) {
            expect(el).toHaveClass('rounded-pill', 'bg-sunken', 'focus-visible:ring-group');
        }
    });

    it('forward their refs', () => {
        const i = createRef<HTMLInputElement>();
        const sel = createRef<HTMLSelectElement>();
        render(<><Input ref={i} aria-label="a" /><Select ref={sel} aria-label="b"><option>x</option></Select></>);
        expect(i.current).toBeInstanceOf(HTMLInputElement);
        expect(sel.current).toBeInstanceOf(HTMLSelectElement);
    });
});
