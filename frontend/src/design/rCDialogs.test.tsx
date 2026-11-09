import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { Calendar } from 'lucide-react';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../utils/clientLog';
import { Modal } from './primitives/Modal';
import { useGroupMarker } from './useGroupMarker';
import { groupRoles } from './tokens';
import { resetDialogStack } from './dialog/dialogStack';

beforeEach(() => resetDialogStack());
afterEach(() => vi.mocked(clientLog).mockClear());

describe('Modal header (R-c)', () => {
    it('draws the title bold, as the pre-D2 dialog header did', () => {
        render(<Modal isOpen onClose={vi.fn()} title="日付検索 📅" closeLabel="閉じる">x</Modal>);
        expect(screen.getByRole('heading', { level: 2, name: '日付検索 📅' })).toHaveClass('text-title', 'font-bold');
    });

    it('shows a decorative icon before the title, in the header text colour', () => {
        render(<Modal isOpen onClose={vi.fn()} title="t" icon={<Calendar />}>x</Modal>);
        const slot = screen.getByTestId('modal-header-icon');
        expect(slot).toHaveAttribute('aria-hidden', 'true');
        expect(slot.querySelector('svg')).not.toBeNull();
        expect(screen.getByTestId('modal-header')).toContainElement(slot);
        expect(slot.nextElementSibling?.tagName).toBe('H2');
        expect(slot.className).not.toMatch(/text-/);
    });

    it('has no icon slot without an icon, and keeps the inline close button at 12 px', () => {
        render(<Modal isOpen onClose={vi.fn()} title="t" closeLabel="閉じる">x</Modal>);
        expect(screen.queryByTestId('modal-header-icon')).toBeNull();
        expect(screen.getByRole('button', { name: '閉じる' })).toHaveClass('rounded-md');
    });
});

describe('useGroupMarker', () => {
    it('scopes a marker to the named service', () => {
        const { result } = renderHook(() => useGroupMarker('sakurazaka46', 'add_service'));
        const vars = result.current as Record<string, string>;
        expect(vars['--ds-group-accent']).toBe(groupRoles('sakurazaka').action);
        expect(vars['--ds-accent']).toBeDefined();
        expect(clientLog).not.toHaveBeenCalled();
    });

    it('leaves an unknown service in the surrounding context and logs one fallback', () => {
        const { result, rerender } = renderHook(() => useGroupMarker('unknown_svc', 'settings_row'));
        expect(result.current).toBeUndefined();
        rerender();
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('group_marker_fallback', { target: 'settings_row', reason: 'unknown_service' });
    });
});
