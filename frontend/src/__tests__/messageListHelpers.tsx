import { vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Message } from '../types';
import { MessageList } from '../features/messages/components/MessageList';

export const msg = (id: number): Message =>
    ({ id, timestamp: `2026-01-0${id}T00:00:00Z`, type: 'text', is_favorite: false, content: `m${id}` });

export const messages = [msg(1), msg(2), msg(3)];

/** Render MessageList with inert defaults; `extra` overrides any prop. */
export function renderList(extra: Partial<React.ComponentProps<typeof MessageList>> = {}) {
    return render(
        <MessageList
            memberId="room"
            messages={messages}
            getSenderInfo={() => ({ name: 'n' })}
            isUnread={() => false}
            onReveal={vi.fn()}
            onLongPress={vi.fn()}
            {...extra}
        />,
    );
}
