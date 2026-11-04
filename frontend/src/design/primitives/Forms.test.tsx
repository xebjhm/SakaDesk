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
});
