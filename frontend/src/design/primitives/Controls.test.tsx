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

    it('ghost is neutral: secondary text, sunken hover, never the group colour', () => {
        render(<Button variant="ghost">cancel</Button>);
        const b = screen.getByRole('button', { name: 'cancel' });
        expect(b).toHaveClass('text-secondary', 'hover:bg-sunken', 'hover:text-primary');
        expect(b.className).not.toMatch(/(^|\s)(hover:)?(bg|text|border)-accent/);
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
    it('is icon-only: the label is the accessible name and an aria-hidden tooltip, not visible text', () => {
        render(<RailItem icon={<MessageCircle />} label="トーク" />);
        const b = screen.getByRole('button', { name: 'トーク' });
        expect(b).toHaveAttribute('aria-label', 'トーク');
        expect(b).not.toHaveAttribute('title');
        const tip = screen.getByText('トーク');
        expect(tip).toHaveAttribute('role', 'tooltip');
        expect(tip).toHaveAttribute('aria-hidden', 'true');
        expect(tip).toHaveClass('bg-viewer-control', 'text-viewer', 'pointer-events-none', 'left-full');
        expect(tip.className).not.toMatch(/accent/);
        expect(b).toHaveClass('h-10', 'w-10');
    });
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
    it('the selected entry is a white card with the accent icon and bar', () => {
        render(
            <>
                <RailItem icon={<MessageCircle />} label="トーク" selected />
                <RailItem icon={<MessageCircle />} label="ブログ" />
            </>,
        );
        const on = screen.getByRole('button', { name: 'トーク' });
        expect(on).toHaveClass('bg-sheet', 'shadow-card');
        expect(on.querySelector('[data-rail-bar]')).toHaveClass('bg-accent');
        expect(on.querySelector('[data-rail-icon]')).toHaveClass('text-accent');
        expect(screen.getByRole('button', { name: 'ブログ' }).querySelector('[data-rail-bar]')).toBeNull();
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
    it('warning stays semantic in every context', () => {
        render(<Button variant="warning">Careful</Button>);
        expect(screen.getByRole('button', { name: 'Careful' })).toHaveClass('bg-status-attention', 'text-inverse');
    });
    it('a blocked click does not reach a parent handler', () => {
        const parent = vi.fn();
        render(<div onClick={parent}><Button disabledReason="Not yet">Go</Button></div>);
        fireEvent.click(screen.getByRole('button', { name: /Go/ }));
        expect(parent).not.toHaveBeenCalled();
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
        const spinner = b.querySelector('[data-spinner]')?.className ?? '';
        expect(spinner).toContain('absolute');
        expect(spinner).toContain('inset-0');
        expect(spinner).toContain('m-auto');
        expect(spinner).not.toContain('-translate-x-1/2');
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

describe('IconButton shape (floating = circle, inline = 12 px)', () => {
    it.each(['overlay', 'accent'] as const)('%s is a circle by default (floating)', (variant) => {
        render(<IconButton variant={variant} aria-label="浮動" icon={<X />} />);
        const b = screen.getByRole('button', { name: '浮動' });
        expect(b).toHaveClass('rounded-full');
        expect(b).not.toHaveClass('rounded-md');
        expect(b).toHaveAttribute('data-shape', 'circle');
    });

    it.each(['ghost', 'secondary', 'soft'] as const)('%s keeps the button radius by default (inline)', (variant) => {
        render(<IconButton variant={variant} aria-label="閉じる" icon={<X />} />);
        const b = screen.getByRole('button', { name: '閉じる' });
        expect(b).toHaveClass('rounded-md');
        expect(b).not.toHaveClass('rounded-full');
        expect(b).toHaveAttribute('data-shape', 'rounded');
    });

    it('shape overrides the default both ways', () => {
        render(
            <>
                <IconButton variant="ghost" shape="circle" aria-label="丸" icon={<X />} />
                <IconButton variant="overlay" shape="rounded" aria-label="角" icon={<X />} />
            </>,
        );
        expect(screen.getByRole('button', { name: '丸' })).toHaveClass('rounded-full');
        expect(screen.getByRole('button', { name: '角' })).toHaveClass('rounded-md');
    });

    it('soft is the accent on a subtle tint and fills on hover', () => {
        render(<IconButton variant="soft" aria-label="検索" icon={<X />} />);
        expect(screen.getByRole('button', { name: '検索' })).toHaveClass(
            'bg-accent-subtle', 'text-accent', 'hover:bg-accent', 'hover:text-inverse',
        );
    });
});
