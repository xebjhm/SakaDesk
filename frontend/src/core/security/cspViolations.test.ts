import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

import { clientLog } from '../../utils/clientLog';
import { cspDirectiveCode, installCspViolationLog } from './cspViolations';

function violation(effectiveDirective: string): Event {
    return Object.assign(new Event('securitypolicyviolation'), { effectiveDirective, blockedURI: 'https://evil.example/x' });
}

describe('installCspViolationLog', () => {
    beforeEach(() => vi.mocked(clientLog).mockClear());

    it('logs each refused directive once, as a code, never the blocked URL', () => {
        const uninstall = installCspViolationLog(document);
        document.dispatchEvent(violation('img-src'));
        document.dispatchEvent(violation('img-src'));
        document.dispatchEvent(violation('script-src-elem'));
        expect(vi.mocked(clientLog).mock.calls).toEqual([
            ['csp_violation', { target: 'img_src' }],
            ['csp_violation', { target: 'script_src_elem' }],
        ]);
        uninstall();
        document.dispatchEvent(violation('style-src'));
        expect(clientLog).toHaveBeenCalledTimes(2);
    });

    it('turns a directive into a breadcrumb code', () => {
        expect(cspDirectiveCode('frame-ancestors')).toBe('frame_ancestors');
        expect(cspDirectiveCode('')).toBe('unknown');
    });
});
