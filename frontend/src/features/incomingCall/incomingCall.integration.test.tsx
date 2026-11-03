import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { MemberInfo, Message } from '../../types';
import { useIncomingCall } from './useIncomingCall';
import { CallOverlay } from './CallOverlay';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

const DIR = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const member: MemberInfo = { id: 58, name: '金村 美玖', thumbnail_local: '/img/thumb.jpg' };
const voice: Message = {
    id: 10, timestamp: '2026-11-01T10:00:00Z', type: 'voice', is_favorite: false, content: null,
    media_file: 'messages/34 金村 美玖/58 金村 美玖/voice/10.m4a',
};

function Harness({ isGroupChat = false, enabled = true }: { isGroupChat?: boolean; enabled?: boolean }) {
    const call = useIncomingCall(
        {
            service: 'hinatazaka46', chatDir: DIR, isGroupChat, messages: [voice],
            member: isGroupChat ? undefined : member, name: '金村 美玖',
            enabled, isUnread: () => true, freshFetch: { seq: 1, dir: DIR },
            revealMessage: () => {}, scrollToMessage: () => {},
            logContext: { service: 'hinatazaka46', groupId: 34, memberId: 58 },
        },
        () => Promise.resolve(),
    );
    return <div className="relative"><CallOverlay call={call} /></div>;
}

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('incoming call wiring', () => {
    it('a 1:1 chat with an unheard voice shows the call (falls back to the chat icon)', async () => {
        render(<Harness />);
        await settle();
        expect(screen.getByTestId('call-overlay')).toBeInTheDocument();
        expect(screen.getByText('Incoming call…')).toBeInTheDocument();
    });

    it('a group chat never shows the call', async () => {
        render(<Harness isGroupChat />);
        await settle();
        expect(screen.queryByTestId('call-overlay')).toBeNull();
    });

    it('the setting off never shows the call', async () => {
        render(<Harness enabled={false} />);
        await settle();
        expect(screen.queryByTestId('call-overlay')).toBeNull();
    });
});
