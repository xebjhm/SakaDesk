import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { clientLog } from '../../utils/clientLog';
import { LetterViewerModal } from './LetterViewerModal';
import type { Letter } from '../../features/messages/letters';
import { LetterRow } from '../../features/messages/components/LetterRow';
import { buildTimeline } from '../../features/messages/timeline/buildTimeline';
import { useAppStore } from '../../store/appStore';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import { downloadMedia } from '../../utils/download';
import { copyImageToClipboard } from '../../utils/clipboard';
import en from '../../i18n/locales/en.json';
import ja from '../../i18n/locales/ja.json';
import zhCN from '../../i18n/locales/zh-CN.json';
import zhTW from '../../i18n/locales/zh-TW.json';
import yue from '../../i18n/locales/yue.json';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../utils/download', () => ({ downloadMedia: vi.fn() }));
vi.mock('../../utils/clipboard', () => ({ copyImageToClipboard: vi.fn(() => Promise.resolve()), copyVideoToClipboard: vi.fn(() => Promise.resolve()) }));

const letter = (id: number, created_at: string, image_url: string | null, text = ''): Letter =>
    ({ id, text, created_at, image_url, width: 341, height: 512 });

const LONG_TEXT = '高井さんへ\nいつもありがとう🌸\n\n画像に入りきらない続きの文章です。💌';
const letters = [
    letter(1, '2024-01-01T03:00:00Z', '/l/1.jpg', 'ひとつめ'),
    letter(2, '2024-06-01T03:00:00Z', '/l/2.jpg', LONG_TEXT),
    letter(3, '2025-02-02T03:00:00Z', null, 'みっつめ'),
];

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(downloadMedia).mockClear();
    vi.mocked(copyImageToClipboard).mockClear();
    resetDialogStack();
    useAppStore.setState({ goldenFingerActive: false });
});

const renderViewer = (overrides: Partial<React.ComponentProps<typeof LetterViewerModal>> = {}) => {
    const props: React.ComponentProps<typeof LetterViewerModal> = {
        letters,
        letterId: 2,
        order: 'oldest_first',
        source: 'timeline',
        onNavigate: vi.fn(),
        onClose: vi.fn(),
        onJump: vi.fn(),
        ...overrides,
    };
    return { props, ...render(<LetterViewerModal {...props} />) };
};

describe('LetterViewerModal', () => {
    it('renders nothing when no letter is open', () => {
        const { props } = renderViewer({ letterId: null });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(props.onClose).not.toHaveBeenCalled();
        expect(clientLog).not.toHaveBeenCalled();
    });

    it('closes and logs a skip once when the open letter is no longer in the list', () => {
        const { rerender, props } = renderViewer({ letterId: 99 });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(props.onClose).toHaveBeenCalledOnce();
        expect(clientLog).toHaveBeenCalledWith('letter_viewer', { phase: 'skip', surface: 'timeline', reason: 'not_found' });
        // A re-render with the same missing id (before the parent cleared it) does not log again.
        rerender(<LetterViewerModal {...props} letters={[...letters]} letterId={99} />);
        expect(vi.mocked(clientLog).mock.calls.filter(([, f]) => (f as { phase?: string }).phase === 'skip')).toHaveLength(1);
        expect(props.onClose).toHaveBeenCalledOnce();
    });

    it('shows the letter image beside its full text in a sheet dialog', async () => {
        renderViewer();
        const dialog = await screen.findByRole('dialog', { name: 'Sent letter' });
        expect(dialog).toHaveClass('bg-sheet');
        const img = dialog.querySelector('img');
        expect(img).toHaveAttribute('src', '/l/2.jpg');
        expect(img).toHaveClass('object-contain');
        expect(img?.closest('.bg-sunken')).not.toBeNull();
        const text = within(dialog).getByRole('region', { name: 'Letter text' });
        expect(text).toHaveAttribute('lang', 'ja');
        expect(text).toHaveClass('whitespace-pre-wrap', 'overflow-y-auto', 'text-body', 'text-primary');
        // The full text, line breaks and all: nothing is clamped.
        expect(text.textContent).toBe(LONG_TEXT);
        expect(text.className).not.toMatch(/line-clamp/);
    });

    it('stacks the image above the text below 900 px and puts them side by side above', async () => {
        renderViewer();
        const dialog = await screen.findByRole('dialog');
        const body = within(dialog).getByTestId('modal-body');
        expect(body).toHaveClass('flex-col', 'min-[900px]:flex-row');
        // Stacked: the image takes at most 45% of the body, the text keeps the rest and scrolls.
        const stage = within(dialog).getByTestId('letter-image-stage');
        expect(stage).toHaveClass('max-h-[45%]', 'min-[900px]:max-h-none');
        const text = within(dialog).getByRole('region', { name: 'Letter text' });
        expect(text).toHaveClass('overflow-y-auto', 'pb-4');
    });

    it('shows the missing-media fallback when the letter has no image, and logs it', async () => {
        renderViewer({ letterId: 3 });
        const dialog = await screen.findByRole('dialog');
        expect(dialog.querySelector('img')).toBeNull();
        expect(within(dialog).getByRole('img', { name: 'Letter image unavailable' })).toHaveClass('bg-sunken');
        expect(within(dialog).getByRole('region', { name: 'Letter text' })).toHaveTextContent('みっつめ');
        expect(clientLog).toHaveBeenCalledWith('letter_viewer', { phase: 'fallback', surface: 'timeline', reason: 'no_image' });
    });

    it('falls back when the image fails to load, and logs it', async () => {
        renderViewer();
        const dialog = await screen.findByRole('dialog');
        fireEvent.error(dialog.querySelector('img')!);
        expect(within(dialog).getByRole('img', { name: 'Letter image unavailable' })).toBeInTheDocument();
        expect(clientLog).toHaveBeenCalledWith('letter_viewer', { phase: 'fallback', surface: 'timeline', reason: 'image_error' });
    });

    it('logs the open with its source', async () => {
        renderViewer({ source: 'sent_letters', order: 'newest_first' });
        await screen.findByRole('dialog');
        expect(clientLog).toHaveBeenCalledWith('letter_viewer', { phase: 'open', surface: 'sent_letters' });
    });

    it('jumps to the letter from the neutral timestamp link, closing first', async () => {
        const { props } = renderViewer({ source: 'sent_letters' });
        const dialog = await screen.findByRole('dialog');
        const link = within(dialog).getByRole('button', { name: /^Show letter sent 2024\/06\/01 .* in the chat$/ });
        expect(link).toHaveTextContent(/^2024\/06\/01 \d\d:\d\d$/);
        expect(link).toHaveAttribute('title', 'Jump to letter in chat');
        expect(link).toHaveClass('text-secondary', 'hover:underline', 'hover:text-primary');
        expect(link.className).not.toMatch(/text-accent/);
        await userEvent.click(link);
        expect(props.onClose).toHaveBeenCalledOnce();
        expect(props.onJump).toHaveBeenCalledWith(2);
        expect(vi.mocked(props.onClose).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(props.onJump).mock.invocationCallOrder[0]);
        expect(clientLog).toHaveBeenCalledWith('letter_jump', { surface: 'sent_letters' });
    });

    it('moves between letters with the buttons, in list order', async () => {
        const { props } = renderViewer();
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Older letter' }));
        expect(props.onNavigate).toHaveBeenLastCalledWith(1);
        await userEvent.click(within(dialog).getByRole('button', { name: 'Newer letter' }));
        expect(props.onNavigate).toHaveBeenLastCalledWith(3);
    });

    it('moves between letters with ← / → and stops at the ends', async () => {
        const { props, rerender } = renderViewer();
        const dialog = await screen.findByRole('dialog');
        fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
        expect(props.onNavigate).toHaveBeenLastCalledWith(1);
        fireEvent.keyDown(dialog, { key: 'ArrowRight' });
        expect(props.onNavigate).toHaveBeenLastCalledWith(3);

        vi.mocked(props.onNavigate).mockClear();
        rerender(<LetterViewerModal {...props} letterId={1} />);
        expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Older letter' })).toBeDisabled();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
        rerender(<LetterViewerModal {...props} letterId={3} />);
        expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Newer letter' })).toBeDisabled();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
        expect(props.onNavigate).not.toHaveBeenCalled();
    });

    it('moves in time order whichever way the list is sorted (→ / › newer, ← / ‹ older)', async () => {
        const newestFirst = [...letters].reverse();
        const { props } = renderViewer({ letters: newestFirst, order: 'newest_first', source: 'sent_letters' });
        const dialog = await screen.findByRole('dialog');
        fireEvent.keyDown(dialog, { key: 'ArrowRight' });
        expect(props.onNavigate).toHaveBeenLastCalledWith(3);
        fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
        expect(props.onNavigate).toHaveBeenLastCalledWith(1);
        await userEvent.click(within(dialog).getByRole('button', { name: 'Newer letter' }));
        expect(props.onNavigate).toHaveBeenLastCalledWith(3);
        await userEvent.click(within(dialog).getByRole('button', { name: 'Older letter' }));
        expect(props.onNavigate).toHaveBeenLastCalledWith(1);
    });

    it('disables the arrows at the oldest and newest ends of a newest-first list', async () => {
        const newestFirst = [...letters].reverse();
        const { props, rerender } = renderViewer({ letters: newestFirst, order: 'newest_first', letterId: 3 });
        expect(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Newer letter' })).toBeDisabled();
        rerender(<LetterViewerModal {...props} letters={newestFirst} order="newest_first" letterId={1} />);
        expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Older letter' })).toBeDisabled();
    });

    it('counts letters oldest = 1, like the photo viewer, whatever the list order', async () => {
        const { rerender, props } = renderViewer();
        expect(await screen.findByText('2 / 3')).toBeInTheDocument();
        rerender(<LetterViewerModal {...props} letters={[...letters].reverse()} order="newest_first" letterId={3} />);
        expect(screen.getByText('3 / 3')).toBeInTheDocument();
    });

    it('leaves ← / → to the caret and selection while focus is in the letter text', async () => {
        const { props } = renderViewer();
        const dialog = await screen.findByRole('dialog');
        const text = within(dialog).getByRole('region', { name: 'Letter text' });
        text.focus();
        const left = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
        text.dispatchEvent(left);
        const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true, shiftKey: true });
        text.dispatchEvent(right);
        expect(left.defaultPrevented).toBe(false);
        expect(right.defaultPrevented).toBe(false);
        expect(props.onNavigate).not.toHaveBeenCalled();
    });

    it('opens the letter image in the dark media viewer on top, and Escape returns to the letter', async () => {
        const { props } = renderViewer();
        const dialog = await screen.findByRole('dialog', { name: 'Sent letter' });
        await userEvent.click(within(dialog).getByRole('button', { name: 'View the letter image larger' }));
        const media = await screen.findByRole('dialog', { name: 'Media viewer' });
        const img = media.querySelector('img');
        expect(img).toHaveAttribute('src', '/l/2.jpg');
        expect(screen.getByRole('dialog', { name: 'Sent letter' })).toBeInTheDocument();
        // ↑ zooms the image as before; ← / → in the media viewer do not move the letter viewer.
        fireEvent.keyDown(media, { key: 'ArrowUp' });
        expect(img).toHaveStyle({ transform: 'scale(1.25)' });
        fireEvent.keyDown(media, { key: 'ArrowLeft' });
        fireEvent.keyDown(media, { key: 'ArrowRight' });
        expect(props.onNavigate).not.toHaveBeenCalled();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'Media viewer' })).toBeNull();
        expect(screen.getByRole('dialog', { name: 'Sent letter' })).toBeInTheDocument();
        expect(props.onClose).not.toHaveBeenCalled();
        // Focus goes back to the image button that opened the dark viewer.
        expect(within(screen.getByRole('dialog', { name: 'Sent letter' })).getByRole('button', { name: 'View the letter image larger' })).toHaveFocus();
    });

    it('offers the media viewer\'s golden-finger Download (and Ctrl+C copy) for the letter image', async () => {
        useAppStore.setState({ goldenFingerActive: true });
        renderViewer();
        const dialog = await screen.findByRole('dialog', { name: 'Sent letter' });
        await userEvent.click(within(dialog).getByRole('button', { name: 'View the letter image larger' }));
        const media = await screen.findByRole('dialog', { name: 'Media viewer' });
        expect(within(media).getByRole('button', { name: 'Download' })).toBeInTheDocument();
        // Ctrl+C with the dark viewer open copies the letter image.
        const copy = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
        act(() => { media.dispatchEvent(copy); });
        expect(copyImageToClipboard).toHaveBeenCalledExactlyOnceWith('/l/2.jpg');
        expect(copy.defaultPrevented).toBe(true);
    });

    it('leaves Ctrl+C in the letter text to the browser (copies the selected text, not the image)', async () => {
        useAppStore.setState({ goldenFingerActive: true });
        renderViewer();
        const dialog = await screen.findByRole('dialog', { name: 'Sent letter' });
        const text = within(dialog).getByRole('region', { name: 'Letter text' });
        text.focus();
        const copy = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
        act(() => { text.dispatchEvent(copy); });
        expect(copyImageToClipboard).not.toHaveBeenCalled();
        expect(copy.defaultPrevented).toBe(false);
    });

    it('shows Download in the footer only with golden finger and an image', async () => {
        const { rerender, props } = renderViewer();
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).queryByRole('button', { name: 'Download' })).toBeNull();

        act(() => useAppStore.setState({ goldenFingerActive: true }));
        rerender(<LetterViewerModal {...props} />);
        await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Download' }));
        expect(downloadMedia).toHaveBeenCalledWith('/l/2.jpg', expect.stringMatching(/\.jpg$/));

        // No image (null, or failed to load): no Download and no image button.
        rerender(<LetterViewerModal {...props} letterId={3} />);
        expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Download' })).toBeNull();
        rerender(<LetterViewerModal {...props} letterId={1} />);
        fireEvent.error(screen.getByRole('dialog').querySelector('img')!);
        expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Download' })).toBeNull();
        expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'View the letter image larger' })).toBeNull();
    });

    it('hides the counter and the arrows for a single letter', async () => {
        renderViewer({ letters: [letters[0]], letterId: 1 });
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).queryByRole('button', { name: 'Older letter' })).toBeNull();
        expect(within(dialog).queryByText('1 / 1')).toBeNull();
    });
});

/** MessagesFeature's wiring: a timeline letter row opens the viewer over the timeline's letters. */
const TimelineHarness: React.FC<{ onJump: (id: number) => void }> = ({ onJump }) => {
    const timeline = buildTimeline([], [letters[2], letters[0], letters[1]]);
    const [openId, setOpenId] = React.useState<number | null>(null);
    return (
        <>
            {timeline.letters.map((l) => (
                <LetterRow key={l.id} letter={l} avatarUrl={null} userName="ゆき" onOpenImage={(x) => setOpenId(x.id)} />
            ))}
            <LetterViewerModal letters={timeline.letters} letterId={openId} order="oldest_first" source="timeline"
                onNavigate={setOpenId} onClose={() => setOpenId(null)} onJump={onJump} />
        </>
    );
};

describe('LetterViewerModal from the chat timeline', () => {
    it('opens from a letter image, walks the letters chronologically and jumps', async () => {
        const onJump = vi.fn();
        render(<TimelineHarness onJump={onJump} />);
        await userEvent.click(screen.getAllByRole('button', { name: /^Open letter sent/ })[0]);
        const viewer = await screen.findByRole('dialog', { name: 'Sent letter' });
        expect(viewer.querySelector('img')).toHaveAttribute('src', '/l/1.jpg');
        expect(clientLog).toHaveBeenCalledWith('letter_viewer', { phase: 'open', surface: 'timeline' });
        fireEvent.keyDown(viewer, { key: 'ArrowRight' });
        expect(within(screen.getByRole('dialog')).getByRole('region', { name: 'Letter text' }).textContent).toBe(LONG_TEXT);
        await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Show letter sent/ }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(onJump).toHaveBeenCalledWith(2);
    });
});

describe('letter viewer strings', () => {
    const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;
    const KEYS = ['title', 'older', 'newer', 'jumpToLetter', 'jumpToLetterAt', 'imageMissing', 'openImage', 'fullText'] as const;

    it.each(Object.entries(locales))('%s has every letterViewer key', (_code, data) => {
        const section = (data as unknown as Record<string, Record<string, string> | undefined>).letterViewer;
        for (const key of KEYS) {
            expect(typeof section?.[key], key).toBe('string');
            expect(section?.[key].trim().length, key).toBeGreaterThan(0);
        }
        expect(section?.jumpToLetterAt).toContain('{{date}}');
    });
});
