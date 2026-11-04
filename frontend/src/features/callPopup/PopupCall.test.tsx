import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { groupRoles } from '../../design/tokens';
import { PopupCall } from './PopupCall';

vi.mock('../incomingCall/useIncomingCall', () => ({
    useIncomingCall: () => ({
        phase: 'ringing',
        message: { id: 10, timestamp: '2026-11-01T10:00:00Z', type: 'voice', is_favorite: false, content: null },
        name: '山下 瞳月', photoUrl: null, audioUrl: null, talkStartedAt: null,
        answer: vi.fn(), decline: vi.fn(), hangUp: vi.fn(), onPlaybackEnded: vi.fn(), onPlaybackError: vi.fn(),
    }),
}));

const PATH = '櫻坂46/messages/1 山下 瞳月/2 山下 瞳月';
const INFO = {
    call_id: 1, service: 'sakurazaka46', path: PATH, is_group_chat: false,
    group_id: '1', member_id: '2', message_id: 10,
};
const MESSAGE = {
    id: 10, timestamp: '2026-11-01T10:00:00Z', type: 'voice', is_favorite: false, content: null,
    media_file: 'messages/1 山下 瞳月/2 山下 瞳月/voice/10.m4a',
};

describe('PopupCall', () => {
    it('uses the group action colour as the call accent for a light-header group', async () => {
        const { container } = render(
            <PopupCall
                info={INFO}
                settings={{ call_popup_enabled: true } as never}
                messages={[MESSAGE] as never}
                member={{ id: 2, name: '山下 瞳月' } as never}
                readState={{} as never}
                post={vi.fn()}
                preload={() => Promise.resolve()}
            />,
        );
        const el = container.querySelector('.sd-call-popup') as HTMLElement;
        expect(el.style.getPropertyValue('--sd-accent')).toBe(groupRoles('sakurazaka').action);
        expect(groupRoles('sakurazaka').action).toBe('#c84575');
        expect(screen.getAllByText('山下 瞳月').length).toBeGreaterThan(0);
    });
});
