import { describe, it, expect } from 'vitest';
import { memberWashStyle } from './memberWash';
import { getMemberByName, getMemberPenlightHex } from '../../data/memberData';

// No mock here: a real member from data/members/hinatazaka.json.
describe('memberWashStyle with real member data', () => {
    it('sets the wash variables to the real member penlight hex colours', () => {
        const data = getMemberByName('金村 美玖', 'hinatazaka');
        expect(data).not.toBeNull();
        const [first, second] = getMemberPenlightHex(data!, 'hinatazaka');
        expect(first).toMatch(/^#[0-9a-f]{6}$/i);
        expect(memberWashStyle({ id: '12', name: '金村 美玖' }, 'hinatazaka')).toEqual({
            '--ds-member-wash-1': first,
            '--ds-member-wash-2': second,
        });
    });

    it('finds the same member by blog id when the name does not match', () => {
        expect(memberWashStyle({ id: '12', name: '誰か' }, 'hinatazaka')).toBeDefined();
    });
});
