import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CallScreen } from './CallScreen';
import { formatTalkTime } from './formatTalkTime';

const props = {
    name: '金村 美玖', photoUrl: '/img/phone.jpg', talkSeconds: 0,
    onAnswer: vi.fn(), onDecline: vi.fn(), onHangUp: vi.fn(),
};

describe('CallScreen', () => {
    it('sizes the phone by height at 1:2, capped at 560px and the available height', () => {
        const { container } = render(<CallScreen {...props} phase="ringing" />);
        const phone = container.firstElementChild as HTMLElement;
        expect(phone).toHaveClass('aspect-[1/2]', 'w-auto', 'h-[min(560px,calc(100%-32px))]');
    });

    it('ringing shows the name, the incoming text and answer/decline', () => {
        render(<CallScreen {...props} phase="ringing" />);
        expect(screen.getByText('金村 美玖')).toBeInTheDocument();
        expect(screen.getByText('Incoming call…')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
        fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
        expect(props.onAnswer).toHaveBeenCalledTimes(1);
        expect(props.onDecline).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Hang up' })).toBeNull();
    });

    it('connected shows the timer and only a hang-up button', () => {
        render(<CallScreen {...props} phase="connected" talkSeconds={75} />);
        expect(screen.getByText('1:15')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Hang up' }));
        expect(props.onHangUp).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    });

    it('ended shows the ended text and no buttons', () => {
        render(<CallScreen {...props} phase="ended" />);
        expect(screen.getByText('Call ended')).toBeInTheDocument();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('formats talk time as m:ss', () => {
        expect(formatTalkTime(0)).toBe('0:00');
        expect(formatTalkTime(9)).toBe('0:09');
        expect(formatTalkTime(600)).toBe('10:00');
    });
});
