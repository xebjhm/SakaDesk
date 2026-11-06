import React from 'react';
import { Atmosphere } from '../../design/primitives';
import { BrandScope } from '../../design/brandScope';

/**
 * The first-launch backdrop (spec §9: boot → ToS → choose groups → first sync on aurora + orbs,
 * L2): the brand orbs over the window base, behind the entry dialogs. Decorative only.
 */
export const EntryBackdrop: React.FC = () => (
    <div data-testid="entry-backdrop" aria-hidden="true" className="fixed inset-0">
        <BrandScope className="h-full bg-window">
            <Atmosphere className="h-full">{null}</Atmosphere>
        </BrandScope>
    </div>
);
