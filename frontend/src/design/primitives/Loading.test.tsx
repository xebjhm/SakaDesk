import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

import i18n from '../../i18n';
import { clientLog } from '../../utils/clientLog';
import {
    BusyContent, Button, ProgressBar, SKELETON_PULSE, Skeleton, Spinner, StatusBlock, type StatusBlockProps,
} from './index';

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeAll(async () => {
    await i18n.changeLanguage('en');
});

beforeEach(() => {
    vi.mocked(clientLog).mockReset();
});

describe('Spinner', () => {
    it('is a status named by its label', () => {
        render(<Spinner label="Loading photos" />);
        expect(screen.getByRole('status', { name: 'Loading photos' })).toBeInTheDocument();
    });

    it('defaults its label to loading.label', () => {
        render(<Spinner />);
        expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
    });

    it('spins only without reduced motion', () => {
        const { container } = render(<Spinner />);
        const glyph = container.querySelector('svg');
        expect(glyph).toHaveClass('animate-spin', 'motion-reduce:animate-none');
        expect(glyph).toHaveAttribute('aria-hidden', 'true');
    });

    it.each([
        ['auto', ['sr-only', 'motion-reduce:not-sr-only'], []],
        ['always', [], ['sr-only']],
        ['compact', ['sr-only'], ['motion-reduce:not-sr-only']],
    ] as const)('labelVisibility %s', (visibility, has, hasNot) => {
        render(<Spinner label="待って" labelVisibility={visibility} />);
        const label = screen.getByText('待って');
        if (has.length) expect(label).toHaveClass(...has);
        for (const cls of hasNot) expect(label).not.toHaveClass(cls);
    });

    it('is hidden and unnamed when decorative', () => {
        const { container } = render(<Spinner decorative />);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        const root = container.firstElementChild as HTMLElement;
        expect(root).toHaveAttribute('aria-hidden', 'true');
        expect(root).not.toHaveAttribute('role');
        expect(container).not.toHaveTextContent('Loading');
    });

    it.each([
        ['accent', 'text-accent'], ['muted', 'text-muted'], ['current', 'text-current'], ['viewer', 'text-viewer'],
    ] as const)('tone %s -> %s', (tone, cls) => {
        const { container } = render(<Spinner tone={tone} />);
        expect(container.querySelector('svg')).toHaveClass(cls);
    });

    it.each([['sm', 'h-4'], ['md', 'h-6'], ['lg', 'h-8']] as const)('size %s -> %s', (size, cls) => {
        const { container } = render(<Spinner size={size} />);
        expect(container.querySelector('svg')).toHaveClass(cls);
    });

    it('renders a CJK and emoji label', () => {
        render(<Spinner label="読み込み中…🌸" />);
        expect(screen.getByRole('status', { name: '読み込み中…🌸' })).toBeInTheDocument();
    });
});

describe('Skeleton', () => {
    it('is hidden from assistive tech and pulses', () => {
        const { container } = render(<Skeleton shape="line" />);
        const el = container.firstElementChild as HTMLElement;
        expect(el).toHaveAttribute('aria-hidden', 'true');
        expect(SKELETON_PULSE).toBe('animate-pulse motion-reduce:animate-none');
        expect(el).toHaveClass('animate-pulse', 'motion-reduce:animate-none');
    });

    it.each([
        ['line', ['h-3', 'rounded-pill']],
        ['block', ['rounded-card']],
        ['circle', ['rounded-pill', 'aspect-square']],
        ['tile', ['aspect-square', 'rounded-sm']],
    ] as const)('shape %s', (shape, classes) => {
        const { container } = render(<Skeleton shape={shape} />);
        expect(container.firstElementChild).toHaveClass(...classes);
    });

    it.each([['sunken', 'bg-sunken'], ['paper', 'bg-skeleton']] as const)('tone %s -> %s', (tone, cls) => {
        const { container } = render(<Skeleton shape="block" tone={tone} />);
        expect(container.firstElementChild).toHaveClass(cls);
    });

    it('defaults to the sunken tone', () => {
        const { container } = render(<Skeleton shape="block" />);
        expect(container.firstElementChild).toHaveClass('bg-sunken');
    });

    it('lets data tone paint its own colour', () => {
        const { container } = render(<Skeleton shape="tile" tone="data" style={{ backgroundColor: 'red' }} />);
        const el = container.firstElementChild as HTMLElement;
        expect([...el.classList].filter((c) => c.startsWith('bg-'))).toEqual([]);
        expect(el.style.backgroundColor).toBe('red');
    });
});

describe('ProgressBar', () => {
    it('reports a determinate value', () => {
        const { container } = render(<ProgressBar value={0.4} label="Syncing" valueText="4 / 10" />);
        const bar = screen.getByRole('progressbar', { name: 'Syncing' });
        expect(bar).toHaveAttribute('aria-valuenow', '40');
        expect(bar).toHaveAttribute('aria-valuetext', '4 / 10');
        const fill = container.querySelector('[data-progress-fill]') as HTMLElement;
        expect(fill.style.width).toBe('40%');
        expect(fill).toHaveClass('bg-expressive-progress', 'motion-reduce:transition-none');
    });

    it('clamps out-of-range values', () => {
        render(<ProgressBar value={1.7} label="x" />);
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    });

    it('is indeterminate without a value', () => {
        const { container } = render(<ProgressBar label="準備中…" />);
        const bar = screen.getByRole('progressbar', { name: '準備中…' });
        expect(bar).not.toHaveAttribute('aria-valuenow');
        const fill = container.querySelector('[data-progress-fill]');
        expect(fill).toHaveClass('w-1/3', 'animate-progress-indeterminate', 'motion-reduce:animate-none');
        expect(screen.getByText('準備中…')).toHaveClass('sr-only', 'motion-reduce:not-sr-only');
    });

    it('shows its label when asked', () => {
        render(<ProgressBar value={0.5} label="Exporting" showLabel />);
        expect(screen.getByText('Exporting')).not.toHaveClass('sr-only');
    });

    it.each([['thin', 'h-0.5'], ['sm', 'h-2'], ['md', 'h-4']] as const)('size %s -> %s', (size, cls) => {
        render(<ProgressBar value={0.1} label="x" size={size} />);
        expect(screen.getByRole('progressbar')).toHaveClass(cls, 'bg-sunken', 'rounded-full');
    });
});

describe('BusyContent', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('marks the content busy, dims it and adds the top bar after the reveal delay', () => {
        const { container } = render(<BusyContent busy><p>前の内容</p></BusyContent>);
        const root = container.firstElementChild as HTMLElement;
        expect(root).toHaveAttribute('aria-busy', 'true');
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        advance(199);
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        advance(1);
        expect(screen.getByRole('progressbar', { name: 'Loading…' })).toBeInTheDocument();
        expect(screen.getByText('前の内容').parentElement).toHaveClass('opacity-60');
    });

    it('puts the reduced-motion label on a token pill so it never paints over the content', () => {
        render(<BusyContent busy label="次の月を読み込み中…"><p>前の内容</p></BusyContent>);
        advance(200);
        const label = screen.getByText('次の月を読み込み中…');
        expect(label).toHaveClass('motion-reduce:not-sr-only', 'bg-sheet', 'rounded-pill', 'shadow-pill', 'self-start');
    });

    it('with inertWhileBusy, makes the kept content inert and unclickable at once, and live again when ready', () => {
        const onClick = vi.fn();
        const { rerender } = render(<BusyContent busy inertWhileBusy><button type="button" onClick={onClick}>前の日 🌸</button></BusyContent>);
        const content = screen.getByText('前の日 🌸').parentElement as HTMLElement;
        expect(content).toHaveAttribute('inert');
        expect(content).toHaveClass('pointer-events-none');
        rerender(<BusyContent busy={false} inertWhileBusy><button type="button" onClick={onClick}>前の日 🌸</button></BusyContent>);
        expect(content).not.toHaveAttribute('inert');
        expect(content).not.toHaveClass('pointer-events-none');
        fireEvent.click(screen.getByText('前の日 🌸'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('stays interactive while busy by default (backward compatible)', () => {
        render(<BusyContent busy><button type="button">kept</button></BusyContent>);
        const content = screen.getByText('kept').parentElement as HTMLElement;
        expect(content).not.toHaveAttribute('inert');
        expect(content).not.toHaveClass('pointer-events-none');
    });

    it('is plain content when idle', () => {
        const { container } = render(<BusyContent busy={false}><p>ready</p></BusyContent>);
        expect(container.firstElementChild).not.toHaveAttribute('aria-busy');
        advance(1000);
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(screen.getByText('ready').parentElement).not.toHaveClass('opacity-60');
    });
});

describe('StatusBlock loading', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('is an empty status box until the reveal delay', () => {
        const { container } = render(<StatusBlock kind="loading" surface="dialog_search" />);
        advance(199);
        const box = screen.getByRole('status');
        expect(box).toHaveAttribute('aria-busy', 'true');
        expect(container.querySelector('svg')).toBeNull();
        expect(box).not.toHaveTextContent('Loading');
    });

    it('drops aria-busy once revealed so its label and hints are announced', () => {
        render(<StatusBlock kind="loading" surface="chat_room" label="トークを読み込み中…" />);
        advance(200);
        const region = screen.getByRole('status', { name: 'トークを読み込み中…' });
        expect(region).not.toHaveAttribute('aria-busy');
        expect(region).toHaveTextContent('トークを読み込み中…');
        advance(2800);
        expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy');
        expect(screen.getByRole('status')).toHaveTextContent('Still loading…');
        advance(7000);
        expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy');
        expect(screen.getByRole('status')).toHaveTextContent('This is taking longer than usual. Thanks for waiting.');
    });

    it('does not repeat its label on the very-slow bar', () => {
        render(<StatusBlock kind="loading" surface="chat_room" stage="verySlow" />);
        const visibleLabels = screen.getAllByText('Loading…').filter((el) => !el.classList.contains('hidden'));
        expect(visibleLabels).toHaveLength(1);
    });

    it('shows the spinner with its label at 200 ms', () => {
        const { container } = render(<StatusBlock kind="loading" surface="dialog_search" label="検索中…🔍" />);
        advance(200);
        expect(container.querySelector('svg')).toHaveClass('animate-spin');
        expect(screen.getByRole('status', { name: '検索中…🔍' })).toBeInTheDocument();
    });

    it('shows the skeleton instead of a spinner when given', () => {
        const { container } = render(
            <StatusBlock kind="loading" surface="chat_room" skeleton={<div data-testid="sk" />} />,
        );
        advance(199);
        expect(screen.queryByTestId('sk')).not.toBeInTheDocument();
        advance(1);
        expect(screen.getByTestId('sk')).toBeInTheDocument();
        expect(container.querySelector('svg')).toBeNull();
        expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
    });

    it('shows the skeleton label under reduced motion from reveal (screen-reader only otherwise)', () => {
        render(<StatusBlock kind="loading" surface="chat_room" label="読み込み中…🌸" skeleton={<div data-testid="sk" />} />);
        advance(200);
        const label = screen.getByText('読み込み中…🌸');
        expect(label).toHaveClass('sr-only');
        expect(label).toHaveClass('motion-reduce:not-sr-only');
    });

    it('keeps an always-visible skeleton label visible', () => {
        render(<StatusBlock kind="loading" surface="chat_room" label="写真" labelVisibility="always" skeleton={<div />} />);
        advance(200);
        expect(screen.getByText('写真')).not.toHaveClass('sr-only');
    });

    it('adds the slow hint at 3 s and the very-slow hint with an indeterminate bar at 10 s', () => {
        render(<StatusBlock kind="loading" surface="chat_room" />);
        advance(2999);
        expect(screen.queryByText('Still loading…')).not.toBeInTheDocument();
        advance(1);
        expect(screen.getByText('Still loading…')).toHaveClass('text-small', 'text-secondary');
        advance(6999);
        expect(screen.queryByText('This is taking longer than usual. Thanks for waiting.')).not.toBeInTheDocument();
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        advance(1);
        expect(screen.getByText('This is taking longer than usual. Thanks for waiting.')).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('uses custom slow and very-slow hints', () => {
        render(<StatusBlock kind="loading" surface="chat_room" slowHint="思い出を準備しています…" verySlowHint="索引を作っています" />);
        advance(3000);
        expect(screen.getByText('思い出を準備しています…')).toBeInTheDocument();
        advance(7000);
        expect(screen.getByText('索引を作っています')).toBeInTheDocument();
    });

    it('logs ui_wait for slow and very slow once', () => {
        render(<StatusBlock kind="loading" surface="chat_room" />);
        advance(20000);
        expect(vi.mocked(clientLog).mock.calls).toEqual([
            ['ui_wait', { surface: 'chat_room', phase: 'slow', wait_ms: 3000 }],
            ['ui_wait', { surface: 'chat_room', phase: 'very_slow', wait_ms: 10000 }],
        ]);
    });

    it('offers Cancel from 10 s, which logs cancelled and calls onCancel', () => {
        const onCancel = vi.fn();
        render(<StatusBlock kind="loading" surface="login" onCancel={onCancel} />);
        advance(9999);
        expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
        advance(1);
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        advance(500);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenLastCalledWith('ui_wait', { surface: 'login', phase: 'cancelled', wait_ms: 10500 });
    });

    it('uses a custom cancel label', () => {
        render(<StatusBlock kind="loading" surface="login" onCancel={() => {}} cancelLabel="ログインをやめる" stage="verySlow" />);
        expect(screen.getByRole('button', { name: 'ログインをやめる' })).toBeInTheDocument();
    });

    it('shows a determinate bar for known progress', () => {
        render(<StatusBlock kind="loading" surface="sync_scan" progress={0.5} />);
        advance(10000);
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    });

    it('renders a stage override at once without logging', () => {
        render(<StatusBlock kind="loading" surface="chat_room" stage="slow" />);
        expect(screen.getByText('Still loading…')).toBeInTheDocument();
        advance(20000);
        expect(screen.queryByText('This is taking longer than usual. Thanks for waiting.')).not.toBeInTheDocument();
        expect(clientLog).not.toHaveBeenCalled();
    });
});

describe('StatusBlock error, timeout and empty', () => {
    it('error is an alert with a default title and a Retry', () => {
        const onRetry = vi.fn();
        render(<StatusBlock kind="error" surface="blog_feed" onRetry={onRetry} />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load this");
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('error takes a custom title, hint and retry label', () => {
        render(<StatusBlock kind="error" surface="blog_feed" title="ブログを読み込めませんでした" hint="後でもう一度" onRetry={() => {}} retryLabel="再読み込み" retryVariant="primary" />);
        expect(screen.getByText('ブログを読み込めませんでした')).toBeInTheDocument();
        expect(screen.getByText('後でもう一度')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '再読み込み' })).toHaveClass('bg-accent-gradient');
    });

    it('timeout is a neutral alert with its own copy and a Retry', () => {
        const onRetry = vi.fn();
        const { container } = render(<StatusBlock kind="timeout" surface="memories_hub" onRetry={onRetry} />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('This is taking too long');
        expect(alert).toHaveTextContent('It may still be working in the background. Wait a moment, then try again.');
        expect(container.querySelector('svg.lucide-clock')).not.toBeNull();
        expect(container.innerHTML).not.toMatch(/danger/);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('timeout copy never equals error copy', () => {
        const { container: a } = render(<StatusBlock kind="error" surface="x" onRetry={() => {}} />);
        const { container: b } = render(<StatusBlock kind="timeout" surface="x" onRetry={() => {}} />);
        expect(a.textContent).not.toBe(b.textContent);
    });

    it('empty is the EmptyState with its action', () => {
        render(
            <StatusBlock kind="empty" surface="dialog_favorites" icon={<Inbox />} title="お気に入りはまだありません" hint="★をつけるとここに並びます" action={<button type="button">Go</button>} />,
        );
        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.getByTestId('empty-state-circle')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'お気に入りはまだありません' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
    });

    it.each([
        ['pane', ['flex-1', 'p-6']],
        ['dialog', ['px-6', 'py-12']],
        ['block', ['h-72']],
        ['fill', ['h-full', 'min-h-96']],
        ['inline', ['flex-row', 'text-small', 'text-secondary']],
    ] as const)('variant %s', (variant, classes) => {
        render(<StatusBlock kind="error" surface="x" variant={variant} onRetry={() => {}} />);
        expect(screen.getByRole('alert')).toHaveClass(...classes);
    });

    it('shows an error with no Retry when there is nothing to retry (no onRetry)', () => {
        render(<StatusBlock kind="error" surface="media_gallery" />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load this");
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('requires onRetry for timeout and a title for empty; an error may omit Retry', () => {
        // @ts-expect-error: a timeout always offers Retry.
        const late: StatusBlockProps = { kind: 'timeout', surface: 'x' };
        // @ts-expect-error: an empty state always has a title.
        const blank: StatusBlockProps = { kind: 'empty', surface: 'x' };
        const bare: StatusBlockProps = { kind: 'error', surface: 'x' };
        expect([late.kind, blank.kind, bare.kind]).toEqual(['timeout', 'empty', 'error']);
    });
});

describe('Button loading', () => {
    it('stays busy with a decorative spinner and a label that only dims under reduced motion', () => {
        const { container } = render(<Button loading>Log in</Button>);
        const button = screen.getByRole('button', { name: 'Log in' });
        expect(button).toHaveAttribute('aria-busy', 'true');
        const glyph = container.querySelector('svg') as SVGElement;
        expect(glyph).toHaveAttribute('aria-hidden', 'true');
        expect(glyph).not.toHaveAttribute('role');
        expect(glyph).toHaveClass('animate-spin', 'motion-reduce:animate-none', 'motion-reduce:right-auto');
        const label = screen.getByText('Log in');
        expect(label).toHaveClass('opacity-0', 'motion-reduce:opacity-60');
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});
