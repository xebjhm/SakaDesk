import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { groupScopeStyle } from './groupScope';
import { groupRoles } from './tokens';
import { groupTokenVars } from './cssVars';

describe('groupScopeStyle', () => {
    it('sets one group’s variables on an element', () => {
        const { container } = render(<div style={groupScopeStyle('sakurazaka')} />);
        const el = container.firstChild as HTMLElement;
        expect(el.style.getPropertyValue('--ds-group-accent')).toBe(groupRoles('sakurazaka').action);
        expect(el.style.getPropertyValue('--ds-group-subtle')).toBe(groupRoles('sakurazaka').subtle);
        expect(el.style.getPropertyValue('--ds-group-title-from')).not.toBe('');
    });

    it('sets the full group variable set, the same keys for every group, and nothing else', () => {
        const keys = (id: Parameters<typeof groupScopeStyle>[0]) => Object.keys(groupScopeStyle(id)).sort();
        expect(keys('hinatazaka')).toEqual(Object.keys(groupTokenVars('hinatazaka')).sort());
        expect(keys('sakurazaka')).toEqual(keys('hinatazaka'));
        expect(keys('default')).toEqual(keys('hinatazaka'));
        expect(keys('hinatazaka')).toEqual(expect.arrayContaining(['--ds-group-accent', '--ds-group-subtle', '--ds-group-title-from', '--ds-shadow-group-glow']));
        for (const key of keys('hinatazaka')) expect(key).toMatch(/^--ds-(?:shadow-)?group-/);
    });

    it('differs per group', () => {
        expect(groupScopeStyle('hinatazaka')).not.toEqual(groupScopeStyle('sakurazaka'));
    });
});
