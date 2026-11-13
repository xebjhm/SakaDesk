import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingRow } from './SettingRow';

describe('SettingRow descriptions (UI health A-S6)', () => {
    it('links the control to the description, and to the error when there is one', () => {
        const { rerender } = render(
            <SettingRow label="通知" description="新着メッセージを知らせます 🔔" control={<button type="button">切替</button>} />,
        );
        const button = screen.getByRole('button', { name: '切替' });
        expect(button).toHaveAccessibleDescription('新着メッセージを知らせます 🔔');
        expect(button).not.toHaveAttribute('aria-invalid');
        rerender(
            <SettingRow label="通知" description="新着メッセージを知らせます 🔔" error="保存できませんでした" control={<button type="button">切替</button>} />,
        );
        const failed = screen.getByRole('button', { name: '切替' });
        expect(failed).toHaveAccessibleDescription('新着メッセージを知らせます 🔔 保存できませんでした');
        expect(failed).toHaveAttribute('aria-invalid', 'true');
    });

    it('keeps a description the control names itself', () => {
        render(
            <>
                <p id="own">自分の説明</p>
                <SettingRow label="通知" description="行の説明" control={<button type="button" aria-describedby="own">切替</button>} />
            </>,
        );
        expect(screen.getByRole('button', { name: '切替' })).toHaveAccessibleDescription('自分の説明');
    });
});
