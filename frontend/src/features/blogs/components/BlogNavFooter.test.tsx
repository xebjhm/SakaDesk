import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../../i18n';
import { BlogNavFooter } from './BlogNavFooter';
import type { BlogMeta } from '../../../types';

const post = (id: string, title: string): BlogMeta => ({
    id, title, published_at: '2026-10-25T09:00:00Z', url: '', thumbnail: null, cached: true,
});
const OLDER = post('141', '春の日記 41 🌸');
const NEWER = post('143', '春の日記 43 🌸');

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('BlogNavFooter', () => {
    it('ArrowLeft opens the older post and ArrowRight the newer one', () => {
        const onPrev = vi.fn();
        const onNext = vi.fn();
        render(<BlogNavFooter prevBlog={OLDER} nextBlog={NEWER} onPrev={onPrev} onNext={onNext} />);
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(onPrev).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('ignores an arrow toward a side without a post', () => {
        const onPrev = vi.fn();
        const onNext = vi.fn();
        render(<BlogNavFooter prevBlog={OLDER} nextBlog={null} onPrev={onPrev} onNext={onNext} />);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(onNext).not.toHaveBeenCalled();
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('opens a side on click', () => {
        const onPrev = vi.fn();
        const onNext = vi.fn();
        render(<BlogNavFooter prevBlog={OLDER} nextBlog={NEWER} onPrev={onPrev} onNext={onNext} />);
        fireEvent.click(screen.getByRole('button', { name: /春の日記 41/ }));
        fireEvent.click(screen.getByRole('button', { name: /春の日記 43/ }));
        expect(onPrev).toHaveBeenCalledTimes(1);
        expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('renders nothing without an older or a newer post', () => {
        const { container } = render(<BlogNavFooter prevBlog={null} nextBlog={null} onPrev={vi.fn()} onNext={vi.fn()} />);
        expect(container.firstChild).toBeNull();
    });
});

describe('BlogNavFooter look (D2b)', () => {
    it('floats older and newer as pills in a labelled navigation', () => {
        render(<BlogNavFooter prevBlog={OLDER} nextBlog={NEWER} onPrev={vi.fn()} onNext={vi.fn()} />);
        expect(screen.getByRole('navigation', { name: 'Post navigation' })).toBeInTheDocument();
        const older = screen.getByRole('button', { name: /^Older post: 春の日記 41/ });
        const newer = screen.getByRole('button', { name: /^Newer post: 春の日記 43/ });
        expect(older).toHaveClass('rounded-pill', 'bg-pill', 'shadow-pill');
        expect(newer).toHaveClass('rounded-pill', 'bg-pill', 'shadow-pill');
    });
});

describe('BlogNavFooter arrow keys aimed elsewhere (D2b fix)', () => {
    const setup = (extra: ReactNode) => {
        const onPrev = vi.fn();
        const onNext = vi.fn();
        render(<>{extra}<BlogNavFooter prevBlog={OLDER} nextBlog={NEWER} onPrev={onPrev} onNext={onNext} /></>);
        return { onPrev, onNext };
    };

    it('ignores arrows typed in a text field', () => {
        const { onPrev, onNext } = setup(<><input aria-label="search" /><textarea aria-label="note" /><select aria-label="pick"><option>a</option></select></>);
        fireEvent.keyDown(screen.getByLabelText('search'), { key: 'ArrowLeft' });
        fireEvent.keyDown(screen.getByLabelText('note'), { key: 'ArrowRight' });
        fireEvent.keyDown(screen.getByLabelText('pick'), { key: 'ArrowLeft' });
        expect(onPrev).not.toHaveBeenCalled();
        expect(onNext).not.toHaveBeenCalled();
    });

    it('ignores arrows inside a dialog or a content-editable element', () => {
        const { onPrev } = setup(
            <>
                <div role="dialog"><button type="button">in dialog</button></div>
                <div contentEditable suppressContentEditableWarning data-testid="editor">x</div>
            </>,
        );
        fireEvent.keyDown(screen.getByRole('button', { name: 'in dialog' }), { key: 'ArrowLeft' });
        fireEvent.keyDown(screen.getByTestId('editor'), { key: 'ArrowLeft' });
        expect(onPrev).not.toHaveBeenCalled();
    });

    it('ignores arrows a control already handled (the photo viewer does this)', () => {
        const { onPrev } = setup(<div tabIndex={0} data-testid="viewer" onKeyDown={(e) => e.preventDefault()} />);
        fireEvent.keyDown(screen.getByTestId('viewer'), { key: 'ArrowLeft' });
        expect(onPrev).not.toHaveBeenCalled();
    });

    it('still navigates for arrows from the page itself', () => {
        const { onPrev } = setup(null);
        fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
        expect(onPrev).toHaveBeenCalledTimes(1);
    });
});
