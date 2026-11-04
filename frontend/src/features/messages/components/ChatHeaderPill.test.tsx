import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatHeaderPill } from './ChatHeaderPill';

describe('ChatHeaderPill', () => {
    it('stands out on the white (light-style) header with a sunken surface and a border', () => {
        render(<ChatHeaderPill light>3 unread</ChatHeaderPill>);
        const pill = screen.getByText('3 unread');
        expect(pill).toHaveClass('bg-sunken', 'border', 'border-subtle', 'text-secondary');
        expect(pill).not.toHaveClass('bg-pill');
    });

    it('keeps the white pill on a gradient header', () => {
        render(<ChatHeaderPill light={false}>3 unread</ChatHeaderPill>);
        const pill = screen.getByText('3 unread');
        expect(pill).toHaveClass('bg-pill', 'shadow-pill', 'text-secondary');
        expect(pill).not.toHaveClass('bg-sunken');
        expect(pill).not.toHaveClass('border');
    });
});
