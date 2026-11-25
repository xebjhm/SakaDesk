import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import i18n from '../../i18n';
import type { Message } from '../../types';
import * as timeOrder from '../../utils/timeOrder';
import { FavoritesModal } from './FavoritesModal';

vi.mock('../../utils/timeOrder', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils/timeOrder')>();
    return { ...actual, sortNewestFirst: vi.fn(actual.sortNewestFirst) };
});

const fav = (id: number): Message => ({ id, timestamp: `2024-01-0${id}T00:00:00Z`, type: 'text', content: `m${id}`, is_favorite: true });

describe('FavoritesModal while closed (UI health P-B3)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('sorts nothing while closed and the favourites once open', () => {
        const props = { onClose: () => {}, memberName: 'n', serviceId: 'hinatazaka46' };
        const { rerender } = render(<FavoritesModal {...props} isOpen={false} messages={[fav(1)]} />);
        rerender(<FavoritesModal {...props} isOpen={false} messages={[fav(1), fav(2), fav(3)]} />);
        const sorted = vi.mocked(timeOrder.sortNewestFirst).mock.calls.map(([items]) => items.length);
        expect(sorted.every((n) => n === 0)).toBe(true);
        rerender(<FavoritesModal {...props} isOpen messages={[fav(1), fav(2), fav(3)]} />);
        expect(vi.mocked(timeOrder.sortNewestFirst).mock.calls.some(([items]) => items.length === 3)).toBe(true);
    });
});
