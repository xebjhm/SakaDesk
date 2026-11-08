import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConversationMenu } from './ConversationMenu';

describe('ConversationMenu trigger', () => {
    it('keeps a visible keyboard focus ring in the header text colour, never the accent', () => {
        render(
            <ConversationMenu
                conversationPath="p"
                isGroupChat={false}
                messages={[]}
                memberName="テスト 🌸"
                onOpenCalendar={vi.fn()}
                letters={[]}
                lettersStatus="ready"
                onJumpToLetter={vi.fn()}
            />,
        );
        const trigger = screen.getByRole('button', { name: /./ });
        expect(trigger).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-expressive-header');
        expect(trigger.className).not.toContain('focus-visible:ring-accent');
    });
});
