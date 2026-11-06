import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatHeaderPill } from './ChatHeaderPill';

// The pre-D2 header pills, through tokens.
describe('ChatHeaderPill', () => {
    it('on a gradient header the count is white glass and the status a dark shade, both white text', () => {
        render(<><ChatHeaderPill light={false}>3 unread</ChatHeaderPill><ChatHeaderPill light={false} tone="status">同期中</ChatHeaderPill></>);
        expect(screen.getByText('3 unread')).toHaveClass('bg-header-glass', 'text-inverse');
        expect(screen.getByText('同期中')).toHaveClass('bg-header-shade', 'text-inverse');
    });

    it('on the light (white) header both are tinted with the official title text colour', () => {
        render(<><ChatHeaderPill light>3 unread</ChatHeaderPill><ChatHeaderPill light tone="status">同期中</ChatHeaderPill></>);
        expect(screen.getByText('3 unread')).toHaveClass('bg-group-title-tint', 'text-group-title');
        expect(screen.getByText('同期中')).toHaveClass('bg-group-title-wash', 'text-group-title');
        expect(screen.getByText('3 unread')).not.toHaveClass('bg-sunken');
    });
});
