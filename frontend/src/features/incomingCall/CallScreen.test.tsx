import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CallScreen } from './CallScreen';
import { formatTalkTime } from './formatTalkTime';

const base = {
    name: '金村 美玖', groupLabel: '日向坂46', photoUrl: '/img/phone.jpg', talkSeconds: 0,
    answerStyle: 'solid' as const,
    onAnswer: vi.fn(), onDecline: vi.fn(), onHangUp: vi.fn(),
};

describe('CallScreen', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('fills its parent and exposes phase and answer style for styling', () => {
        const { container } = render(<CallScreen {...base} phase="ringing" answerStyle="light" />);
        const root = container.firstElementChild as HTMLElement;
        expect(root).toHaveClass('sd-call-screen');
        expect(root).toHaveAttribute('data-phase', 'ringing');
        expect(root).toHaveAttribute('data-answer-style', 'light');
        expect(root.querySelector('img')).toHaveAttribute('src', '/img/phone.jpg');
    });

    it('ringing shows the group, the name, the incoming text and labelled answer/decline', () => {
        render(<CallScreen {...base} phase="ringing" />);
        expect(screen.getByText('日向坂46')).toBeInTheDocument();
        expect(screen.getByText('金村 美玖')).toBeInTheDocument();
        expect(screen.getByText('Incoming call…')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
        fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
        expect(base.onAnswer).toHaveBeenCalledTimes(1);
        expect(base.onDecline).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Hang up' })).toBeNull();
    });

    it('decline and hang-up share the same button style; answer has its own', () => {
        const { rerender } = render(<CallScreen {...base} phase="ringing" />);
        expect(screen.getByRole('button', { name: 'Decline' })).toHaveClass('sd-call-btn--decline');
        expect(screen.getByRole('button', { name: 'Answer' })).toHaveClass('sd-call-btn--answer');
        rerender(<CallScreen {...base} phase="connected" />);
        expect(screen.getByRole('button', { name: 'Hang up' })).toHaveClass('sd-call-btn--decline');
    });

    it('connected shows the name, the timer and only a hang-up button', () => {
        render(<CallScreen {...base} phase="connected" talkSeconds={75} />);
        expect(screen.getByText('金村 美玖')).toBeInTheDocument();
        expect(screen.getByText('1:15')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Hang up' }));
        expect(base.onHangUp).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    });

    it('ended shows the ended text with the talk time and no buttons', () => {
        render(<CallScreen {...base} phase="ended" talkSeconds={31} />);
        expect(screen.getByText('Call ended')).toBeInTheDocument();
        expect(screen.getByText('0:31')).toBeInTheDocument();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('never shows recording cues (no progress bar, no duration while ringing)', () => {
        render(<CallScreen {...base} phase="ringing" talkSeconds={136} />);
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.queryByText('2:16')).toBeNull();
    });

    it('hides the visible button labels from assistive tech (the buttons carry aria-labels)', () => {
        const { container, rerender } = render(<CallScreen {...base} phase="ringing" />);
        const check = () => {
            const labels = container.querySelectorAll('.sd-call-act-label');
            expect(labels.length).toBeGreaterThan(0);
            labels.forEach(l => expect(l).toHaveAttribute('aria-hidden', 'true'));
        };
        check();
        rerender(<CallScreen {...base} phase="connected" />);
        check();
    });

    it('formats talk time as m:ss', () => {
        expect(formatTalkTime(0)).toBe('0:00');
        expect(formatTalkTime(9)).toBe('0:09');
        expect(formatTalkTime(600)).toBe('10:00');
    });
});
