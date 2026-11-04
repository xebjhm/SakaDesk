import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { MemberProfilePopup } from './MemberProfilePopup';

beforeAll(async () => { await i18n.changeLanguage('en'); });

/** Where clientLog posts breadcrumbs (utils/clientLog.ts): the only fetch the popup may make. */
const CLIENT_LOG_URL = '/api/client-log';

describe('MemberProfilePopup streak', () => {
    it('shows the shared streak and retries through the callback', async () => {
        const onRetry = vi.fn();
        const { rerender } = render(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="A" streak={{ status: 'ready', days: 128 }} />);
        expect(screen.getByText('128')).toBeInTheDocument();
        rerender(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="A" streak={{ status: 'error', message: 'boom' }} onRetryStreak={onRetry} />);
        expect(screen.getByText('boom')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(onRetry).toHaveBeenCalledOnce();
    });

    it('shows no streak line without a streak (group chat)', () => {
        render(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="A" />);
        expect(screen.queryByText(/Subscribed for/)).toBeNull();
        expect(screen.queryByText(i18n.t('memberProfile.startSubscription'))).toBeNull();
    });

    it('never fetches the streak itself', () => {
        const spy = vi.spyOn(globalThis, 'fetch');
        render(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="A" />);
        // The dialog's own breadcrumb goes to client-log; nothing else may be fetched.
        expect(spy.mock.calls.filter(([url]) => String(url) !== CLIENT_LOG_URL)).toEqual([]);
        spy.mockRestore();
    });
});
