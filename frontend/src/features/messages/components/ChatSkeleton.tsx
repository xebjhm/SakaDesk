import React from 'react';
import { Skeleton } from '../../../design/primitives';

/**
 * Bubble widths per row: a fixed pattern (never random, so the placeholder does not shuffle on a
 * re-render), alternating one and two bubbles like a real run of messages.
 */
const ROWS: readonly (readonly string[])[] = [
    ['h-10 w-2/3'],
    ['h-10 w-1/2', 'h-16 w-3/4'],
    ['h-16 w-3/5'],
    ['h-10 w-2/5', 'h-10 w-2/3'],
    ['h-24 w-1/2'],
    ['h-10 w-3/4', 'h-10 w-1/3'],
];

/**
 * The chat timeline's loading placeholder: 6 message rows laid out like `MessageList` rows
 * (avatar column, then the bubbles). Always `aria-hidden`; the `StatusBlock` that shows it
 * carries `role="status"` and the label. It shrinks (clipped) in a short pane, so the slow and
 * very-slow lines below it stay in view; that needs the `StatusBlock` pane to be bounded too
 * (`MessagesFeature` gives it `min-h-0`), or the box keeps the skeleton's full height and spills below the fold.
 */
export const ChatSkeleton: React.FC = () => (
    <div aria-hidden="true" data-testid="chat-skeleton" className="flex min-h-0 w-full shrink flex-col gap-4 self-stretch overflow-hidden px-4 py-3">
        {ROWS.map((bubbles, row) => (
            <div key={row} data-testid="chat-skeleton-row" className="flex gap-3">
                <Skeleton shape="circle" className="h-10 w-10 shrink-0" />
                <div className="flex min-w-0 max-w-sm flex-1 flex-col gap-2">
                    {bubbles.map((size, i) => (
                        <Skeleton key={i} shape="block" className={size} />
                    ))}
                </div>
            </div>
        ))}
    </div>
);
