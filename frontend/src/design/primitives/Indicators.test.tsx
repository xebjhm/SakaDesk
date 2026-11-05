import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

import i18n from '../../i18n';
import { clientLog } from '../../utils/clientLog';
import { Badge, Avatar, DatePill } from './index';

beforeAll(async () => {
    await i18n.changeLanguage('en');
});

describe('Badge', () => {
    it('renders nothing at zero', () => {
        const { container } = render(<Badge count={0} />);
        expect(container).toBeEmptyDOMElement();
    });

    it.each([
        [1, '1'],
        [99, '99'],
        [100, '99+'],
        [1234, '99+'],
    ])('shows %i as %s with an accessible label', (count, text) => {
        render(<Badge count={count} />);
        const badge = screen.getByText(text);
        expect(badge).toHaveAttribute('aria-label', `${count} unread`);
        expect(badge).toHaveClass('bg-accent', 'rounded-pill');
        expect(badge).toHaveClass('shadow-accent-unread'); // pending D7
    });
});

describe('Avatar', () => {
    beforeEach(() => vi.mocked(clientLog).mockClear());

    it('shows the image with the name as alt text', () => {
        render(<Avatar src="/a.jpg" name="小坂菜緒" />);
        expect(screen.getByRole('img', { name: '小坂菜緒' })).toHaveAttribute('src', '/a.jpg');
    });

    it('falls back to the first character and logs only the size', () => {
        render(<Avatar src="/missing.jpg" name="小坂菜緒" size="lg" />);
        fireEvent.error(screen.getByRole('img', { name: '小坂菜緒' }));
        expect(screen.getByText('小')).toBeInTheDocument();
        expect(clientLog).toHaveBeenCalledWith('avatar_fallback', { size: 'lg' });
    });

    it('takes a whole emoji as the initial', () => {
        render(<Avatar name="🌸さくら" />);
        expect(screen.getByText('🌸')).toBeInTheDocument();
        expect(clientLog).not.toHaveBeenCalled();
    });

    it('is hidden from assistive tech when decorative (a visible label follows)', () => {
        const { container, rerender } = render(<Avatar src="/a.jpg" name="小坂菜緒" decorative />);
        expect(screen.queryByRole('img', { name: '小坂菜緒' })).toBeNull();
        expect(container.querySelector('img')).toHaveAttribute('alt', '');
        rerender(<Avatar name="小坂菜緒" decorative />);
        expect(screen.queryByRole('img')).toBeNull();
        expect(screen.getByText('小')).toHaveAttribute('aria-hidden', 'true');
    });

    it('adds the accent ring with a white gap and the halo when selected (pending D3)', () => {
        const { container } = render(<Avatar name="A" selected />);
        expect(container.firstChild).toHaveClass('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-surface', 'shadow-accent-halo');
    });
});

describe('DatePill', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 10, 4, 12, 0));
    });
    afterEach(() => vi.useRealTimers());

    it('labels today and carries the machine-readable date', () => {
        render(<DatePill date={new Date(2026, 10, 4, 9, 0)} />);
        const time = screen.getByText('Today');
        expect(time.tagName).toBe('TIME');
        expect(time).toHaveAttribute('dateTime', '2026-11-04');
    });

    it('sticks to the top when asked', () => {
        const { container } = render(<DatePill date={new Date(2025, 0, 1)} sticky />);
        expect(container.firstChild).toHaveClass('sticky', 'top-0');
        expect(screen.getByText(/2025/)).toBeInTheDocument();
    });

    it('becomes a button with a tooltip when it has an action', async () => {
        const onClick = vi.fn();
        render(<DatePill date={new Date(2026, 10, 4, 9, 0)} onClick={onClick} actionLabel="Jump to a date" />);
        const button = screen.getByRole('button', { name: 'Today' });
        expect(button).toHaveAttribute('title', 'Jump to a date');
        expect(button).toHaveClass('rounded-pill', 'focus-visible:ring-accent');
        expect(button).toHaveClass('hover:text-accent-strong');
        expect(screen.getByText('Today').tagName).toBe('TIME');
        fireEvent.click(button);
        expect(onClick).toHaveBeenCalledOnce();
    });
});
