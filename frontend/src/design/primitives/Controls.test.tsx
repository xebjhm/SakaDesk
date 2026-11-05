import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { X, MessageCircle } from 'lucide-react';
import { Button, IconButton, RailItem } from './index';

describe('Button', () => {
    it('defaults to a secondary md button of type button', () => {
        render(<Button>保存</Button>);
        const b = screen.getByRole('button', { name: '保存' });
        expect(b).toHaveAttribute('type', 'button');
        expect(b).toHaveClass('bg-pill', 'h-10', 'rounded-md');
    });

    it('primary uses the accent gradient; ghost and secondary do not', () => {
        render(
            <>
                <Button variant="primary">answer</Button>
                <Button variant="ghost">cancel</Button>
                <Button variant="secondary">later</Button>
            </>,
        );
        expect(screen.getByRole('button', { name: 'answer' })).toHaveClass('bg-accent-gradient', 'text-inverse');
        expect(screen.getByRole('button', { name: 'cancel' }).className).not.toMatch(/accent-gradient/);
        expect(screen.getByRole('button', { name: 'later' }).className).not.toMatch(/accent-gradient/);
    });

    it('does not fire when disabled', async () => {
        const onClick = vi.fn();
        render(<Button disabled onClick={onClick}>x</Button>);
        await userEvent.click(screen.getByRole('button'));
        expect(onClick).not.toHaveBeenCalled();
    });
});

describe('IconButton', () => {
    it('is labelled by its required aria-label', async () => {
        const onClick = vi.fn();
        render(<IconButton aria-label="閉じる" icon={<X />} onClick={onClick} />);
        await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('requires aria-label at the type level', () => {
        // @ts-expect-error aria-label is required
        const el = <IconButton icon={<X />} />;
        expect(el).toBeTruthy();
    });
});

describe('RailItem', () => {
    it('shows icon and label and marks the current item', () => {
        render(
            <>
                <RailItem icon={<MessageCircle />} label="トーク" selected />
                <RailItem icon={<MessageCircle />} label="ブログ" />
            </>,
        );
        expect(screen.getByRole('button', { name: 'トーク' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'ブログ' })).not.toHaveAttribute('aria-current');
    });
});

describe('D2c button variants', () => {
    it('danger and overlay buttons use their tokens', () => {
        render(<><Button variant="danger">削除</Button><Button variant="overlay">保存</Button></>);
        expect(screen.getByRole('button', { name: '削除' })).toHaveClass('bg-status-danger', 'text-inverse');
        expect(screen.getByRole('button', { name: '保存' })).toHaveClass('bg-viewer-control', 'text-viewer');
    });

    it('the accent icon button is the gradient floating look', () => {
        render(<IconButton variant="accent" aria-label="未読へ" icon={<X />} />);
        const b = screen.getByRole('button', { name: '未読へ' });
        expect(b).toHaveClass('bg-accent-gradient', 'text-inverse', 'shadow-accent-glow', 'hover:brightness-106');
        expect(b).not.toHaveClass('bg-pill');
    });

    it('the overlay icon button is the viewer control', () => {
        render(<IconButton variant="overlay" aria-label="閉じる" icon={<X />} />);
        expect(screen.getByRole('button', { name: '閉じる' })).toHaveClass('bg-viewer-control', 'hover:bg-viewer-control-hover', 'text-viewer');
    });
});

describe('Button v2', () => {
    it('primary uses the accent gradient, glow and 12px radius', () => {
        render(<Button variant="primary">Save</Button>);
        const b = screen.getByRole('button', { name: 'Save' });
        expect(b.className).toContain('bg-accent-gradient');
        expect(b.className).toContain('shadow-accent-glow');
        expect(b.className).toContain('rounded-md');
        expect(b.className).not.toContain('rounded-pill');
    });
    it('tonal uses the tonal fill and text', () => {
        render(<Button variant="tonal">Mark all read</Button>);
        const b = screen.getByRole('button', { name: 'Mark all read' });
        expect(b.className).toContain('bg-accent-tonal');
        expect(b.className).toContain('text-accent-tonal');
    });
    it('danger stays semantic in every context', () => {
        render(<Button variant="danger">Delete</Button>);
        expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('bg-status-danger');
    });
    it('disabledReason keeps the button focusable, blocks clicks and exposes the reason', () => {
        const onClick = vi.fn();
        render(<Button variant="primary" disabledReason="Choose a group first" onClick={onClick}>Start</Button>);
        const b = screen.getByRole('button', { name: 'Start' });
        expect(b).toHaveAttribute('aria-disabled', 'true');
        expect(b).not.toBeDisabled();
        expect(b).toHaveAttribute('title', 'Choose a group first');
        expect(b).toHaveAccessibleDescription('Choose a group first');
        fireEvent.click(b);
        expect(onClick).not.toHaveBeenCalled();
        expect(b.className).toContain('aria-disabled:opacity-40');
        expect(b.className).not.toContain('grayscale');
    });
    it('loading shows a spinner, sets aria-busy and swallows clicks', () => {
        const onClick = vi.fn();
        render(<Button variant="primary" loading onClick={onClick}>Save</Button>);
        const b = screen.getByRole('button', { name: /Save/ });
        expect(b).toHaveAttribute('aria-busy', 'true');
        expect(b.querySelector('[data-spinner]')).not.toBeNull();
        fireEvent.click(b);
        expect(onClick).not.toHaveBeenCalled();
    });
    it('loading keeps the label in the a11y tree and overlays the spinner absolutely', () => {
        render(<Button variant="primary" loading>Save</Button>);
        const b = screen.getByRole('button', { name: 'Save' });
        expect(b.className).toContain('relative');
        expect(b).toHaveAttribute('data-loading', 'true');
        expect(b.querySelector('[data-spinner]')?.className).toContain('absolute');
        expect(screen.getByText('Save').className).toContain('opacity-0');
    });
    it('blocks form submit when disabledReason is set', () => {
        const submit = vi.fn((e: React.FormEvent) => e.preventDefault());
        render(<form onSubmit={submit}><Button type="submit" disabledReason="Fill the form">Go</Button></form>);
        fireEvent.click(screen.getByRole('button', { name: 'Go' }));
        expect(submit).not.toHaveBeenCalled();
    });
    it('treats an empty disabledReason as no reason', () => {
        render(<Button disabled disabledReason="">x</Button>);
        const b = screen.getByRole('button', { name: 'x' });
        expect(b).toBeDisabled();
        expect(b).not.toHaveAttribute('aria-disabled');
    });
    it('native disabled renders the disabled attribute and mutes hover/press', () => {
        render(<Button disabled>x</Button>);
        const b = screen.getByRole('button', { name: 'x' });
        expect(b).toBeDisabled();
        expect(b.className).toContain('disabled:active:scale-100');
    });
});
