import { useDevicePixelRatio } from '../../../hooks/useDevicePixelRatio';
import { avatarWidthFor, type AvatarWidth } from '../mediaUrl';

/**
 * `avatarWidthFor(cssPx, devicePixelRatio)`, re-picked when the ratio changes
 * (see `useDevicePixelRatio`). Pass the result to `resizedAvatarUrl`.
 */
export function useAvatarWidth(cssPx: number): AvatarWidth {
    return avatarWidthFor(cssPx, useDevicePixelRatio());
}
