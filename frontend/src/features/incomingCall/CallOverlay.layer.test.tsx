import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Fragment, StrictMode, useState } from 'react';
import type { IncomingCall } from './useIncomingCall';
import { CallOverlay } from './CallOverlay';
import { Modal } from '../../design/primitives/Modal';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import { Z_INDEX } from '../../constants/zIndex';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';

const theme = { accentColor: '#7cc7e8', answerStyle: 'solid' as const, groupLabel: '日向坂46' };

const call = (over: Partial<IncomingCall> = {}): IncomingCall => ({
    phase: 'ringing',
    message: { id: 10, timestamp: '2026-11-01T10:00:00Z', type: 'voice', is_favorite: false, content: null },
    name: '金村 美玖', photoUrl: '/img/phone.jpg', audioUrl: '/api/content/media/x/a.m4a', talkStartedAt: null,
    answer: vi.fn(), decline: vi.fn(), hangUp: vi.fn(), onPlaybackEnded: vi.fn(), onPlaybackError: vi.fn(),
    ...over,
});
const idle = (c: IncomingCall): IncomingCall => ({ ...c, phase: 'idle', message: null });

/** A dialog that closes itself on Escape / its close button. */
function Dialog({ title }: { title: string }) {
    const [open, setOpen] = useState(true);
    return <Modal isOpen={open} onClose={() => setOpen(false)} title={title} closeLabel="Close"><button>{`${title} OK`}</button></Modal>;
}

/**
 * The app: the open dialogs, then the chat frame (a positioned box the in-frame overlay and the
 * lifted call's anchor fill). One tree shape, so a rerender never remounts anything.
 */
function app(dialogs: string[], c: IncomingCall, strict = false) {
    const Wrap = strict ? StrictMode : Fragment;
    return (
        <Wrap>
            {dialogs.map((title) => <Dialog key={title} title={title} />)}
            <div data-testid="chat-frame" className="relative"><CallOverlay call={c} {...theme} /></div>
        </Wrap>
    );
}

/** Opens the dialogs first, then rings `c` (a call rings on a later fetch, not in the dialogs' render). */
function ringOver(dialogs: string[], c: IncomingCall, strict = false) {
    const view = render(app(dialogs, idle(c), strict));
    view.rerender(app(dialogs, c, strict));
    return view;
}

const backdropZ = (title: string) =>
    Number((screen.getByRole('dialog', { name: title }).closest('[data-testid="modal-backdrop"]') as HTMLElement).style.zIndex);
const overlayZ = () => Number(screen.getByTestId('call-overlay').style.zIndex);
const layerEvents = () => vi.mocked(clientLog).mock.calls.filter(([event]) => event === 'call_layer');

beforeEach(() => {
    resetDialogStack();
    vi.mocked(clientLog).mockClear();
});

describe('CallOverlay layering (spec D2d decisions 20, 21)', () => {
    it('with no dialog open, stays in the chat frame at z-30 with no inline placement', () => {
        render(app([], call()));
        const overlay = screen.getByTestId('call-overlay');
        expect(overlay).toHaveAttribute('data-layer', 'frame');
        expect(screen.getByTestId('chat-frame')).toContainElement(overlay);
        expect(overlay).toHaveClass('absolute', 'inset-0', 'z-30');
        expect(overlay.style.zIndex).toBe('');
        expect(overlay.style.left).toBe('');
        expect(layerEvents()).toEqual([['call_layer', { phase: 'in_frame', count: 0 }]]);
    });

    it('rings over two dialogs: lifted above both, below POPOVER, logged once with count 2', () => {
        ringOver(['設定', '確認'], call());
        const overlay = screen.getByTestId('call-overlay');
        expect(overlay).toHaveAttribute('data-layer', 'lifted');
        expect(screen.getByTestId('chat-frame')).not.toContainElement(overlay);
        expect(overlay).toHaveClass('fixed', 'rounded-b-sheet');
        expect(overlay).not.toHaveClass('z-30');
        expect(overlayZ()).toBeGreaterThan(backdropZ('設定'));
        expect(overlayZ()).toBeGreaterThan(backdropZ('確認'));
        expect(overlayZ()).toBeLessThan(Z_INDEX.POPOVER);
        expect(layerEvents()).toEqual([['call_layer', { phase: 'lifted', count: 2 }]]);
    });

    it('is drawn over the chat frame rectangle, measured from an in-frame anchor', () => {
        const rect = { left: 80, top: 64, width: 600, height: 400, right: 680, bottom: 464, x: 80, y: 64, toJSON: () => ({}) } as DOMRect;
        const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
        try {
            ringOver(['設定'], call());
            const overlay = screen.getByTestId('call-overlay');
            expect(overlay.style.left).toBe('80px');
            expect(overlay.style.top).toBe('64px');
            expect(overlay.style.width).toBe('600px');
            expect(overlay.style.height).toBe('400px');
            const anchor = screen.getByTestId('chat-frame').querySelector('[aria-hidden="true"]');
            expect(anchor).toHaveClass('pointer-events-none', 'absolute', 'inset-0');
        } finally {
            spy.mockRestore();
        }
    });

    it('never takes focus from the dialog; Escape there closes the dialog, the next declines the call', () => {
        const c = call();
        ringOver(['設定'], c);
        expect(screen.getByRole('dialog', { name: '設定' })).toHaveFocus();
        fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: '設定' })).toBeNull();
        expect(c.decline).not.toHaveBeenCalled();
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        expect(c.decline).toHaveBeenCalledOnce();
    });

    it('Escape and Enter pressed inside the lifted call go to the call, not the dialog below', () => {
        const c = call();
        ringOver(['設定'], c);
        const overlay = screen.getByTestId('call-overlay');
        act(() => overlay.focus());
        expect(overlay).toHaveFocus(); // the layer allows focus in an off-layer dialog
        fireEvent.keyDown(overlay, { key: 'Enter' });
        expect(c.answer).toHaveBeenCalledOnce();
        fireEvent.keyDown(overlay, { key: 'Escape' });
        expect(c.decline).toHaveBeenCalledOnce();
        expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
    });

    it('stays lifted for its whole life: the overlay and audio never remount, the z-index follows the stack', () => {
        const c = call();
        const { rerender } = ringOver(['設定'], c);
        const overlay = screen.getByTestId('call-overlay');
        expect(overlay.style.zIndex).toBe(String(Z_INDEX.DIALOG + Z_INDEX.DIALOG_STEP / 2));
        rerender(app(['設定'], { ...c, phase: 'connected', talkStartedAt: Date.now() }));
        const audio = screen.getByTestId('call-audio');
        fireEvent.keyDown(screen.getByRole('dialog', { name: '設定' }), { key: 'Escape' }); // the dialog below closes
        expect(screen.queryByRole('dialog', { name: '設定' })).toBeNull();
        expect(screen.getByTestId('call-overlay')).toBe(overlay);
        expect(overlay).toHaveAttribute('data-layer', 'lifted');
        expect(overlay.style.zIndex).toBe(String(Z_INDEX.DIALOG - Z_INDEX.DIALOG_STEP / 2));
        rerender(app(['設定'], { ...c, phase: 'ended', talkStartedAt: Date.now() }));
        expect(screen.getByTestId('call-overlay')).toBe(overlay);
        expect(screen.getByTestId('call-audio')).toBe(audio);
        expect(layerEvents()).toHaveLength(1);
    });

    it('a lifted call that ends with focus inside it hands focus back to the top-most dialog', () => {
        const c = call();
        const { rerender } = ringOver(['設定'], c);
        const decline = screen.getByRole('button', { name: 'Decline' });
        act(() => decline.focus());
        rerender(app(['設定'], idle(c)));
        expect(screen.queryByTestId('call-overlay')).toBeNull();
        expect(screen.getByRole('dialog', { name: '設定' })).toHaveFocus();
        expect(layerEvents()).toContainEqual(['call_layer', { phase: 'focus', outcome: 'restored' }]);
    });

    it('a lifted call that ends leaves focus alone when it is already in the dialog', () => {
        const c = call();
        const { rerender } = ringOver(['設定'], c);
        const ok = screen.getByRole('button', { name: '設定 OK' });
        act(() => ok.focus());
        rerender(app(['設定'], idle(c)));
        expect(ok).toHaveFocus();
        expect(layerEvents()).toContainEqual(['call_layer', { phase: 'focus', outcome: 'kept' }]);
    });

    it('a dialog opened above a lifted call keeps Escape and Tab; the call keeps ringing', () => {
        const c = call();
        const { rerender } = ringOver(['設定'], c);
        rerender(app(['設定', '確認'], c));
        const top = screen.getByRole('dialog', { name: '確認' });
        expect(top).toHaveFocus();
        expect(backdropZ('確認')).toBeGreaterThan(overlayZ());

        // Tab from the last control wraps inside the top dialog.
        const last = screen.getByRole('button', { name: '確認 OK' });
        act(() => last.focus());
        const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        act(() => { last.dispatchEvent(tab); });
        expect(tab.defaultPrevented).toBe(true);
        expect(top).toContainElement(document.activeElement as HTMLElement);

        fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: '確認' })).toBeNull();
        expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
        expect(c.decline).not.toHaveBeenCalled();
        expect(screen.getByTestId('call-overlay')).toHaveAttribute('data-layer', 'lifted');
    });

    it('decides the layer afresh for each call, even when the same message rings again', () => {
        const c = call();
        const { rerender } = ringOver(['設定'], c);
        expect(screen.getByTestId('call-overlay')).toHaveAttribute('data-layer', 'lifted');
        rerender(app(['設定'], idle(c)));
        rerender(app([], idle(c))); // the dialog closes between the calls
        rerender(app([], c));
        expect(screen.getByTestId('call-overlay')).toHaveAttribute('data-layer', 'frame');
        expect(layerEvents()).toEqual([
            ['call_layer', { phase: 'lifted', count: 1 }],
            ['call_layer', { phase: 'focus', outcome: 'kept' }],
            ['call_layer', { phase: 'in_frame', count: 0 }],
        ]);
    });

    it('works under StrictMode: lifted above the dialog, keys inside go to the call, focus is restored', () => {
        const c = call();
        const { rerender } = ringOver(['設定'], c, true);
        const overlay = screen.getByTestId('call-overlay');
        expect(overlay).toHaveAttribute('data-layer', 'lifted');
        expect(overlayZ()).toBeGreaterThan(backdropZ('設定'));
        expect(screen.getByRole('dialog', { name: '設定' })).toHaveFocus();
        const decline = screen.getByRole('button', { name: 'Decline' });
        act(() => decline.focus());
        fireEvent.keyDown(decline, { key: 'Escape' });
        expect(c.decline).toHaveBeenCalledOnce();
        expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
        rerender(app(['設定'], idle(c), true));
        expect(screen.getByRole('dialog', { name: '設定' })).toHaveFocus();
        // A dialog opened afterwards still stacks normally.
        rerender(app(['設定', '確認'], idle(c), true));
        expect(backdropZ('確認')).toBeGreaterThan(backdropZ('設定'));
    });
});
