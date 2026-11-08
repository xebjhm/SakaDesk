import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConversationMenu } from './ConversationMenu';

describe('ConversationMenu trigger', () => {
    it('keeps a visible keyboard focus ring in the header focus colour, never the accent', () => {
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
        // Header text on a gradient header, the strong title tone on Sakurazaka's light one (accent.ts headerFocus).
        expect(trigger).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-expressive-header-focus', 'focus-visible:ring-offset-0');
        expect(trigger.className).not.toContain('focus-visible:ring-accent');
    });

    const renderMenu = (light?: boolean) => {
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
                light={light}
            />,
        );
        return screen.getByRole('button', { name: /./ });
    };

    it('uses the header glass for hover and open on a gradient header, never the light grey', () => {
        const trigger = renderMenu();
        expect(trigger).toHaveClass('hover:bg-header-glass', 'aria-expanded:bg-header-glass');
        expect(trigger.className).not.toContain('bg-sunken');
    });

    it('keeps a visible neutral hover and open state on the light header', () => {
        const trigger = renderMenu(true);
        expect(trigger).toHaveClass('hover:bg-sunken', 'aria-expanded:bg-sunken');
        expect(trigger.className).not.toContain('header-glass');
    });
});
