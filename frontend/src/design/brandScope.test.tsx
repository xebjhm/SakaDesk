import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandScope, brandScopeStyle } from './brandScope';
import { accentTokenVars } from './cssVars';
import { brandAccent } from './tokens';
import { groupScopeStyle } from './groupScope';

describe('brand scope', () => {
    it('returns the brand accent variables', () => {
        expect(brandScopeStyle()).toEqual(accentTokenVars(brandAccent()));
    });
    it('BrandScope overrides an outer group scope', () => {
        render(
            <div style={groupScopeStyle('sakurazaka')}>
                <BrandScope><span>inside</span></BrandScope>
            </div>,
        );
        const scope = screen.getByText('inside').parentElement as HTMLElement;
        expect(scope.dataset.scope).toBe('brand');
        expect(scope.style.getPropertyValue('--ds-accent')).toBe(brandAccent().accent);
    });
});
