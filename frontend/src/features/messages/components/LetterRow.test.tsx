import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../../i18n';
import { LetterRow } from './LetterRow';
import type { Letter } from '../letters';

const base: Letter = { id: 7, text: 'いつもありがとう🌸', created_at: '2025-10-31T16:19:35Z', image_url: '/l/7.jpg', width: 341, height: 512 };

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('LetterRow', () => {
    it('shows the full letter image at 180 px with its height reserved, and opens it', () => {
        const onOpenImage = vi.fn();
        render(<LetterRow letter={base} avatarUrl="/me.jpg" userName="ゆき" onOpenImage={onOpenImage} />);
        const button = screen.getByRole('button', { name: /^Open letter sent .*2025/ });
        expect(button).toHaveAttribute('title', 'Open letter');
        expect(button).toHaveStyle({ width: '180px', height: '270px' });
        fireEvent.click(button);
        expect(onOpenImage).toHaveBeenCalledWith(base);
        expect(screen.getByRole('img', { name: 'ゆき' })).toHaveAttribute('src', '/me.jpg');
        expect(screen.getByText('ゆき')).toBeInTheDocument();
    });

    it('shows the letter text when the image is missing or fails to load', () => {
        const { rerender, container } = render(<LetterRow letter={{ ...base, image_url: null }} avatarUrl={null} userName="ゆき" onOpenImage={vi.fn()} />);
        expect(screen.getByText('いつもありがとう🌸')).toBeInTheDocument();
        rerender(<LetterRow letter={base} avatarUrl={null} userName="ゆき" onOpenImage={vi.fn()} />);
        fireEvent.error(container.querySelector('button img')!);
        expect(screen.getByText('いつもありがとう🌸')).toBeInTheDocument();
    });

    it('carries no "sent letter" tag', () => {
        render(<LetterRow letter={base} avatarUrl={null} userName="ゆき" onOpenImage={vi.fn()} />);
        expect(screen.queryByText(/sent letter/i)).toBeNull();
    });

    it('names the open button by the send date and time, so same-day letters differ', () => {
        render(<>
            <LetterRow letter={base} avatarUrl={null} userName="ゆき" onOpenImage={vi.fn()} />
            <LetterRow letter={{ ...base, id: 8, created_at: '2025-10-31T18:45:00Z' }} avatarUrl={null} userName="ゆき" onOpenImage={vi.fn()} />
        </>);
        const [a, b] = screen.getAllByRole('button', { name: /^Open letter sent/ });
        expect(a.getAttribute('aria-label')).not.toBe(b.getAttribute('aria-label'));
    });
});
