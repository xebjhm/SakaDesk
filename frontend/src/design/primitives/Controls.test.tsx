import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { X, MessageCircle } from 'lucide-react';
import { Button, IconButton, RailItem } from './index';

describe('Button', () => {
    it('defaults to a secondary md button of type button', () => {
        render(<Button>保存</Button>);
        const b = screen.getByRole('button', { name: '保存' });
        expect(b).toHaveAttribute('type', 'button');
        expect(b).toHaveClass('bg-pill', 'h-10', 'rounded-pill');
    });

    it('primary uses the group accent; ghost and secondary do not', () => {
        render(
            <>
                <Button variant="primary">answer</Button>
                <Button variant="ghost">cancel</Button>
                <Button variant="secondary">later</Button>
            </>,
        );
        expect(screen.getByRole('button', { name: 'answer' })).toHaveClass('bg-group-accent', 'text-inverse');
        expect(screen.getByRole('button', { name: 'cancel' }).className).not.toMatch(/group-accent/);
        expect(screen.getByRole('button', { name: 'later' }).className).not.toMatch(/group-accent/);
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

    it('the accent icon button is today’s unread-arrow look', () => {
        render(<IconButton variant="accent" aria-label="未読へ" icon={<X />} />);
        const b = screen.getByRole('button', { name: '未読へ' });
        expect(b).toHaveClass('bg-group-accent', 'text-inverse', 'shadow-card', 'hover:brightness-105');
        expect(b).not.toHaveClass('bg-pill');
    });

    it('the overlay icon button is the viewer control', () => {
        render(<IconButton variant="overlay" aria-label="閉じる" icon={<X />} />);
        expect(screen.getByRole('button', { name: '閉じる' })).toHaveClass('bg-viewer-control', 'hover:bg-viewer-control-hover', 'text-viewer');
    });
});
