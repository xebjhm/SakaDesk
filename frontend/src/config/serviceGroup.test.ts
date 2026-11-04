import { describe, it, expect } from 'vitest';
import { serviceGroupId } from './serviceGroup';
import { getServiceTheme } from './serviceThemes';

describe('serviceGroupId', () => {
    it.each([
        ['hinatazaka46', 'hinatazaka'], ['Sakurazaka46', 'sakurazaka'], ['nogi', 'nogizaka'],
        ['yodel', 'yodel'], ['akb48', 'default'], [null, 'default'], ['', 'default'],
    ] as const)('%s → %s, as the legacy theme lookup', (service, group) => {
        expect(serviceGroupId(service)).toBe(group);
        expect(getServiceTheme(service).id).toBe(group);
    });
});
