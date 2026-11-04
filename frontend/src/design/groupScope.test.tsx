import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { groupScopeStyle } from './groupScope';
import { groupRoles } from './tokens';

describe('groupScopeStyle', () => {
    it('sets one group’s variables on an element', () => {
        const { container } = render(<div style={groupScopeStyle('sakurazaka')} />);
        const el = container.firstChild as HTMLElement;
        expect(el.style.getPropertyValue('--ds-group-accent')).toBe(groupRoles('sakurazaka').action);
        expect(el.style.getPropertyValue('--ds-group-subtle')).toBe(groupRoles('sakurazaka').subtle);
        expect(el.style.getPropertyValue('--ds-group-title-from')).not.toBe('');
    });

    it('differs per group', () => {
        expect(groupScopeStyle('hinatazaka')).not.toEqual(groupScopeStyle('sakurazaka'));
    });
});
