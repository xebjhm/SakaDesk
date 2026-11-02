import { describe, it, expect } from 'vitest';
import { getServiceDisplayName } from './services';

describe('getServiceDisplayName (service rail tooltip)', () => {
    it.each([
        ['nogizaka46', '乃木坂46'],
        ['sakurazaka46', '櫻坂46'],
        ['hinatazaka46', '日向坂46'],
        ['yodel', 'Yodel'],
    ])('%s -> %s', (id, name) => {
        expect(getServiceDisplayName(id)).toBe(name);
    });
});
