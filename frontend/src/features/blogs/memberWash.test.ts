import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memberWashStyle } from './memberWash';
import { getMemberPenlightHex } from '../../data/memberData';

vi.mock('../../data/memberData', () => ({
    // Known only without the space, as the API often sends "姓 名" while the data has "姓名".
    getMemberByName: vi.fn((name: string) => (name === '春野ひなた' ? { nameKanji: name } : null)),
    getMemberByBlogId: vi.fn(() => null),
    getMemberPenlightHex: vi.fn(() => ['#5bbee4', '#f2a0c0']),
}));

describe('memberWashStyle', () => {
    beforeEach(() => {
        vi.mocked(getMemberPenlightHex).mockReturnValue(['#5bbee4', '#f2a0c0']);
    });

    it('sets the two penlight colours as the wash variables', () => {
        expect(memberWashStyle({ id: '9901', name: '春野 ひなた' }, 'hinatazaka')).toEqual({
            '--ds-member-wash-1': '#5bbee4',
            '--ds-member-wash-2': '#f2a0c0',
        });
    });

    it('gives no wash for the mascot or an unknown member', () => {
        expect(memberWashStyle({ id: '000', name: 'ポカ' }, 'hinatazaka')).toBeUndefined();
        expect(memberWashStyle({ id: '1', name: '誰か' }, 'hinatazaka')).toBeUndefined();
    });

    it('replaces a malformed colour with transparent instead of passing it to CSS', () => {
        vi.mocked(getMemberPenlightHex).mockReturnValue(['red; background: url(x)', '#fff']);
        expect(memberWashStyle({ id: '9901', name: '春野 ひなた' }, 'hinatazaka')).toEqual({
            '--ds-member-wash-1': 'transparent',
            '--ds-member-wash-2': 'transparent',
        });
    });
});
