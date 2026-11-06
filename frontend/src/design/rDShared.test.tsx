import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../utils/clientLog';
import { aurora, brandAccent, groupAccent, groupTokens } from './tokens';
import { accentTokenVars } from './cssVars';
import { EmptyState } from './primitives';
import { Modal } from './primitives/Modal';
import { useGroupMarker } from './useGroupMarker';
import { ScopeContext } from './scopeContext';
import { groupScopeStyle } from './groupScope';
import { resetDialogStack } from './dialog/dialogStack';

afterEach(() => {
    vi.mocked(clientLog).mockClear();
    resetDialogStack();
});

describe('progress role (R-d)', () => {
    it('is the aurora in brand context (e4e4118 sync bar: the pastel from-[#b4dcff] to-[#f0bede])', () => {
        expect(brandAccent().progress).toBe(aurora.gradient);
        expect(accentTokenVars(brandAccent())['--ds-expressive-progress']).toBe(aurora.gradient);
    });

    it('is the title gradient on a gradient header and the official bar on a light header (e4e4118 InlineSyncView)', () => {
        const t = groupTokens.hinatazaka.official.title;
        expect(groupAccent('hinatazaka').progress).toBe(`linear-gradient(to right, ${t.gradient.from}, ${t.gradient.via}, ${t.gradient.to})`);
        expect(groupAccent('sakurazaka').progress).toBe(groupTokens.sakurazaka.official.title.bar);
    });
});

describe('group scope through a portal (R-d)', () => {
    it('an inheriting Modal takes a group scope from ScopeContext', () => {
        render(
            <ScopeContext.Provider value={{ scope: 'group', style: groupScopeStyle('yodel') }}>
                <Modal isOpen onClose={vi.fn()} title="確認 ✅">x</Modal>
            </ScopeContext.Provider>,
        );
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('data-scope', 'group');
        expect(dialog.style.getPropertyValue('--ds-accent')).toBe(groupAccent('yodel').accent);
    });
});

describe('group marker targets (R-d)', () => {
    it.each(['landing', 'tos_link', 'sync_row'] as const)('%s leaves an unknown service in brand and logs it', (target) => {
        const { result } = renderHook(() => useGroupMarker('unknown', target));
        expect(result.current).toBeUndefined();
        expect(clientLog).toHaveBeenCalledWith('group_marker_fallback', { target, reason: 'unknown_service' });
    });
});

describe('EmptyState icon (R-d, pending decision D6)', () => {
    it('draws the line icon in the muted neutral on the soft circle, sized by the circle', () => {
        render(<EmptyState icon={<Inbox className="h-10 w-10" />} title="空です 📭" />);
        const circle = screen.getByTestId('empty-state-circle');
        expect(circle).toHaveClass('bg-expressive-soft', 'text-muted');
        expect(circle).not.toHaveClass('text-accent-strong');
        expect(circle.firstElementChild).toHaveClass('[&>svg]:h-7', '[&>svg]:w-7');
    });
});
