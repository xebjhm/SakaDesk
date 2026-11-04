import { describe, it, expect } from 'vitest';
import { groupMarkerStyle } from './groupMarker';
import { getServicePrimaryColor } from '../../data/services';
import { groupRoles } from '../../design/tokens';

describe('groupMarkerStyle', () => {
    it('passes a group logo colour as the marker variable', () => {
        expect(groupMarkerStyle(getServicePrimaryColor('sakurazaka46'))).toEqual({ '--ds-group-marker': groupRoles('sakurazaka').logo });
    });

    it('drops anything that is not a #rrggbb colour', () => {
        expect(groupMarkerStyle('red; background: url(x)')).toEqual({ '--ds-group-marker': 'transparent' });
    });
});
