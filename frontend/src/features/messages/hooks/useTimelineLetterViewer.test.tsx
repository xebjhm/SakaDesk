import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { clientLog } from '../../../utils/clientLog';
import { resetDialogStack } from '../../../design/dialog/dialogStack';
import { LetterViewerModal } from '../../../core/modals/LetterViewerModal';
import { LetterRow } from '../components/LetterRow';
import type { Letter } from '../letters';
import { useTimelineLetterViewer } from './useTimelineLetterViewer';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));

const letter = (id: number, created_at: string, text: string): Letter =>
    ({ id, text, created_at, image_url: `/l/${id}.jpg`, width: 341, height: 512 });
const letters = [letter(1, '2024-01-01T03:00:00Z', 'ひとつめ🌸'), letter(2, '2024-06-01T03:00:00Z', 'ふたつめ💌')];

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    resetDialogStack();
});

/** MessagesFeature's wiring: the timeline (focusable, with letter rows) and the viewer over it. */
const Feature: React.FC<{ room: string; jumpToLetter: (id: number) => void }> = ({ room, jumpToLetter }) => {
    const timelineRef = React.useRef<HTMLDivElement>(null);
    const viewer = useTimelineLetterViewer(room, jumpToLetter, timelineRef);
    return (
        <>
            <div ref={timelineRef} tabIndex={0} data-testid="timeline">
                {letters.map((l) => (
                    <LetterRow key={l.id} letter={l} avatarUrl={null} userName="ゆき" onOpenImage={viewer.open} />
                ))}
            </div>
            <LetterViewerModal letters={letters} letterId={viewer.letterId} order="oldest_first" source="timeline"
                onNavigate={viewer.navigate} onClose={viewer.close} onJump={viewer.jump} />
        </>
    );
};

describe('useTimelineLetterViewer', () => {
    it('closes the viewer when the room changes, and coming back does not reopen it', async () => {
        const { rerender } = render(<Feature room="hinata/a" jumpToLetter={vi.fn()} />);
        await userEvent.click(screen.getAllByRole('button', { name: /^Open letter sent/ })[1]);
        expect(await screen.findByRole('dialog', { name: 'Sent letter' })).toBeInTheDocument();
        const viewerLogs = () => vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'letter_viewer');
        expect(viewerLogs()).toEqual([['letter_viewer', { phase: 'open', surface: 'timeline' }]]);

        rerender(<Feature room="hinata/b" jumpToLetter={vi.fn()} />);
        expect(screen.queryByRole('dialog', { name: 'Sent letter' })).toBeNull();
        rerender(<Feature room="hinata/a" jumpToLetter={vi.fn()} />);
        expect(screen.queryByRole('dialog', { name: 'Sent letter' })).toBeNull();
        // No second open breadcrumb.
        expect(viewerLogs()).toHaveLength(1);
    });

    it('jumps to the letter and then puts focus on the timeline', async () => {
        const jumpToLetter = vi.fn();
        render(<Feature room="hinata/a" jumpToLetter={jumpToLetter} />);
        await userEvent.click(screen.getAllByRole('button', { name: /^Open letter sent/ })[0]);
        const viewer = await screen.findByRole('dialog', { name: 'Sent letter' });
        await userEvent.click(within(viewer).getByRole('button', { name: /^Show letter sent/ }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(jumpToLetter).toHaveBeenCalledWith(1);
        // After the dialog layer settled its focus restore (a microtask), the timeline keeps focus.
        await Promise.resolve();
        expect(screen.getByTestId('timeline')).toHaveFocus();
    });
});
