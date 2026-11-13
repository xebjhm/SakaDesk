/**
 * Breadcrumb for each kind of Content-Security-Policy refusal (backend/security_headers.py
 * APP_CSP): `csp_violation` with the directive as its `target` code, once per directive per
 * page, so a refused loop cannot flood the log. Never the blocked URL or a sample.
 */
import { clientLog } from '../../utils/clientLog';

/** A directive name as a breadcrumb code (`img-src` → `img_src`). */
export function cspDirectiveCode(directive: string): string {
    return directive.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'unknown';
}

/** Starts logging refusals on `target`; returns the uninstall function. */
export function installCspViolationLog(
    target: Pick<Document, 'addEventListener' | 'removeEventListener'> = document,
): () => void {
    const seen = new Set<string>();
    const onViolation = (event: Event) => {
        const e = event as SecurityPolicyViolationEvent;
        const code = cspDirectiveCode(e.effectiveDirective || e.violatedDirective || '');
        if (seen.has(code)) return;
        seen.add(code);
        clientLog('csp_violation', { target: code });
    };
    target.addEventListener('securitypolicyviolation', onViolation);
    return () => target.removeEventListener('securitypolicyviolation', onViolation);
}
