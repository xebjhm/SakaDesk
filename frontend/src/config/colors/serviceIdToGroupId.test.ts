import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

import { clientLog } from '../../utils/clientLog';
import { serviceIdToGroupId } from './css-variables';

describe('serviceIdToGroupId', () => {
    beforeEach(() => vi.mocked(clientLog).mockClear());

    it.each([
        ['hinatazaka46', 'hinatazaka'],
        ['sakurazaka46', 'sakurazaka'],
        ['nogizaka46', 'nogizaka'],
        ['yodel', 'yodel'],
    ])('maps %s to %s without logging', (service, group) => {
        expect(serviceIdToGroupId(service)).toBe(group);
        expect(clientLog).not.toHaveBeenCalled();
    });

    it('falls back to hinatazaka for an unknown service and logs without the raw id', () => {
        expect(serviceIdToGroupId('未知の service 🌸')).toBe('hinatazaka');
        expect(clientLog).toHaveBeenCalledWith('design_tokens_fallback', { reason: 'unknown_service' });
    });
});
