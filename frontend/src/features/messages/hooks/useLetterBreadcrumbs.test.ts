import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLetterBreadcrumbs } from './useLetterBreadcrumbs';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

const calls = (event: string) => vi.mocked(clientLog).mock.calls.filter(([e]) => e === event);

beforeEach(() => vi.mocked(clientLog).mockClear());

describe('useLetterBreadcrumbs', () => {
    it('logs letter_avatar once per room, not on every refetch', () => {
        const { rerender } = renderHook(
            ({ room, n }) => useLetterBreadcrumbs(room, { count: n, history: n, fallback: 0 }, true, 0),
            { initialProps: { room: 'a', n: 2 } },
        );
        rerender({ room: 'a', n: 3 }); // a sync refetch brought a new letter
        expect(calls('letter_avatar')).toEqual([['letter_avatar', { count: 2, history: 2, fallback: 0 }]]);
        rerender({ room: 'b', n: 1 });
        rerender({ room: 'a', n: 3 }); // a new visit logs again
        expect(calls('letter_avatar')).toHaveLength(3);
    });

    it('waits for the profile and for rendered letters', () => {
        const { rerender } = renderHook(
            ({ profile, n }) => useLetterBreadcrumbs('a', { count: n, history: 0, fallback: n }, profile, 0),
            { initialProps: { profile: false, n: 1 } },
        );
        rerender({ profile: true, n: 0 });
        expect(calls('letter_avatar')).toEqual([]);
        rerender({ profile: true, n: 1 });
        expect(calls('letter_avatar')).toEqual([['letter_avatar', { count: 1, history: 0, fallback: 1 }]]);
    });

    it('logs the dropped letters count once per room, only when some were dropped', () => {
        const avatars = { count: 0, history: 0, fallback: 0 };
        const { rerender } = renderHook(
            ({ room, dropped }) => useLetterBreadcrumbs(room, avatars, false, dropped),
            { initialProps: { room: 'a' as string | null, dropped: 0 } },
        );
        expect(calls('letters_load')).toEqual([]);
        rerender({ room: 'a', dropped: 2 });
        rerender({ room: 'a', dropped: 2 });
        expect(calls('letters_load')).toEqual([['letters_load', { outcome: 'dropped', count: 2 }]]);
        rerender({ room: null, dropped: 2 });
        expect(calls('letters_load')).toHaveLength(1);
    });
});
