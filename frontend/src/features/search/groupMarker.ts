import type { CSSProperties } from 'react';

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The cross-group dot in search (docs/design/DESIGN_SYSTEM.md, "Cross-group markers"):
 * a group's logo colour (from getServicePrimaryColor, data) drawn by `bg-group-marker`.
 */
export function groupMarkerStyle(logoColor: string): CSSProperties {
    return { '--ds-group-marker': HEX.test(logoColor) ? logoColor : 'transparent' } as CSSProperties;
}
