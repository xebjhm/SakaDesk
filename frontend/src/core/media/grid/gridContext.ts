import { createContext } from 'react';

/**
 * What a `MediaTile` tells the grid around it (`VirtualMediaGrid` provides it), for the
 * `media_grid` first-paint breadcrumb. Optional: a tile outside a grid has none.
 */
export interface MediaGridTileReporter {
    /** A tile entered (`+1`) or left (`-1`) the screen. */
    tileVisible(delta: 1 | -1): void;
    /** A visible tile's image is ready (the grid logs the first one). */
    tileReady(): void;
    /** The scroll parent the tiles' visibility is measured against (`null`: the viewport). */
    root?: Element | null;
}

export const MediaGridContext = createContext<MediaGridTileReporter | null>(null);
