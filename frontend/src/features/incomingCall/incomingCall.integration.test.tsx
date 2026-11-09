import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import type { MemberInfo, Message } from '../../types';
import { useIncomingCall } from './useIncomingCall';
import { CallOverlay } from './CallOverlay';
import { Modal } from '../../design/primitives/Modal';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import { clientLog } from '../../utils/clientLog';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

const DIR = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const member: MemberInfo = { id: 58, name: '金村 美玖', thumbnail_local: '/img/thumb.jpg' };
const voice: Message = {
    id: 10, timestamp: '2026-11-01T10:00:00Z', type: 'voice', is_favorite: false, content: null,
    media_file: 'messages/34 金村 美玖/58 金村 美玖/voice/10.m4a',
};

function Harness({
    isGroupChat = false, enabled = true, freshFetch = { seq: 1, dir: DIR },
}: { isGroupChat?: boolean; enabled?: boolean; freshFetch?: { seq: number; dir: string } | null }) {
    const call = useIncomingCall(
        {
            service: 'hinatazaka46', chatDir: DIR, isGroupChat, messages: [voice],
            member: isGroupChat ? undefined : member, name: '金村 美玖',
            enabled, isUnread: () => true, freshFetch,
            revealMessage: () => {}, scrollToMessage: () => {},
            logContext: { service: 'hinatazaka46', groupId: 34, memberId: 58 },
        },
        () => Promise.resolve(),
    );
    return <div className="relative"><CallOverlay call={call} accentColor="#7cc7e8" answerStyle="solid" groupLabel="日向坂46" /></div>;
}

function DialogHarness() {
    const [open, setOpen] = useState(true);
    return <Modal isOpen={open} onClose={() => setOpen(false)} title="設定">x</Modal>;
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

    it('Esc closes an open design-system Modal and does not also decline the call', async () => {
        resetDialogStack();
        render(<><Harness /><DialogHarness /></>);
        await settle();
        const dialog = screen.getByRole('dialog', { name: '設定' });
        expect(dialog).toHaveFocus();
        // dispatched on the page (as when focus left the dialog): only the dialog layer's claim
        // keeps the overlay from declining too
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: '設定' })).toBeNull();
        expect(screen.getByTestId('call-overlay')).toBeInTheDocument();
        // the next Esc, with nothing else open, declines
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        expect(screen.queryByTestId('call-overlay')).toBeNull();
    });

    it('a call with no dialog open stays in the chat frame', async () => {
        vi.mocked(clientLog).mockClear();
        const { container } = render(<Harness />);
        await settle();
        const overlay = screen.getByTestId('call-overlay');
        expect(overlay).toHaveAttribute('data-layer', 'frame');
        expect(container).toContainElement(overlay);
        expect(clientLog).toHaveBeenCalledWith('call_layer', { phase: 'in_frame', count: 0 });
    });

    it('a call that rings over an open dialog is lifted above it; a dialog opened later goes above the call', async () => {
        resetDialogStack();
        vi.mocked(clientLog).mockClear();
        const { container, rerender } = render(<><Harness /><DialogHarness /></>);
        await settle();
        const overlay = screen.getByTestId('call-overlay');
        expect(overlay).toHaveAttribute('data-layer', 'lifted');
        expect(container).not.toContainElement(overlay);
        expect(clientLog).toHaveBeenCalledWith('call_layer', { phase: 'lifted', count: 1 });
        const below = screen.getByRole('dialog', { name: '設定' }).closest('[data-testid="modal-backdrop"]') as HTMLElement;
        expect(Number(overlay.style.zIndex)).toBeGreaterThan(Number(below.style.zIndex));

        rerender(<><Harness /><DialogHarness /><Modal isOpen onClose={vi.fn()} title="確認">z</Modal></>);
        const above = screen.getByRole('dialog', { name: '確認' }).closest('[data-testid="modal-backdrop"]') as HTMLElement;
        expect(Number(above.style.zIndex)).toBeGreaterThan(Number(overlay.style.zIndex));
    });

    it('Escape pressed inside a lifted call declines it and leaves the dialog below open', async () => {
        resetDialogStack();
        render(<><Harness /><DialogHarness /></>);
        await settle();
        const decline = screen.getByRole('button', { name: 'Decline' });
        act(() => decline.focus());
        fireEvent.keyDown(decline, { key: 'Escape' });
        expect(screen.queryByTestId('call-overlay')).toBeNull();
        expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
    });

    it('a fresh fetch for another chat never rings (freshFetch.dir !== chatDir)', async () => {
        render(<Harness freshFetch={{ seq: 1, dir: 'other/dir' }} />);
        await settle();
        expect(screen.queryByTestId('call-overlay')).toBeNull();
    });

    it('bumping freshFetch.seq after a decline does not re-ring', async () => {
        const { rerender } = render(<Harness />);
        await settle();
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(screen.queryByTestId('call-overlay')).toBeNull();
        rerender(<Harness freshFetch={{ seq: 2, dir: DIR }} />);
        await settle();
        expect(screen.queryByTestId('call-overlay')).toBeNull();
    });
});
