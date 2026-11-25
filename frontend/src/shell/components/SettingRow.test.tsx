import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LiveRegionHost } from '../../design/primitives';
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
        expect(failed).not.toHaveAttribute('aria-invalid');
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

    it('marks a field-like control invalid, but not a plain button', () => {
        const { rerender } = render(
            <SettingRow label="通知" error="保存できませんでした" control={<button type="button" role="switch" aria-checked="false">切替</button>} />,
        );
        expect(screen.getByRole('switch')).toHaveAttribute('aria-invalid', 'true');
        rerender(<SettingRow label="名前" error="保存できませんでした" control={<input aria-label="名前" />} />);
        expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
        rerender(<SettingRow label="更新" error="保存できませんでした" control={<button type="button">確認</button>} />);
        const plain = screen.getByRole('button', { name: '確認' });
        expect(plain).not.toHaveAttribute('aria-invalid');
        expect(plain).toHaveAccessibleDescription('保存できませんでした');
    });

    it('announces an error once when it appears, and the error line is not a live region itself', async () => {
        const row = (error?: string) => (
            <><LiveRegionHost /><SettingRow label="通知" error={error} control={<button type="button">切替</button>} /></>
        );
        const { rerender } = render(row());
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
        rerender(row('保存できませんでした'));
        await act(async () => { await new Promise(r => setTimeout(r, 120)); });
        // One status region (the announcer), carrying the message; the row's own line is plain text.
        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByRole('status')).toHaveTextContent('保存できませんでした');
        expect(screen.getAllByText('保存できませんでした')).toHaveLength(2); // the visible line and the announcer
    });
});
