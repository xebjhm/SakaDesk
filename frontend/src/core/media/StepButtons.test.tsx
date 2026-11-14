import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { StepButtons } from './StepButtons';

describe('StepButtons', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('steps older and newer, and says why at an end', async () => {
        const onOlder = vi.fn();
        const onNewer = vi.fn();
        render(<StepButtons hasOlder hasNewer={false} onOlder={onOlder} onNewer={onNewer} />);
        await userEvent.click(screen.getByRole('button', { name: 'Older' }));
        expect(onOlder).toHaveBeenCalledTimes(1);
        const newer = screen.getByRole('button', { name: 'Newer' });
        expect(newer).toHaveAttribute('aria-disabled', 'true');
        expect(newer).toHaveAttribute('title', 'This is the newest one');
        expect(newer).toHaveAccessibleDescription('This is the newest one');
        await userEvent.click(newer);
        expect(onNewer).not.toHaveBeenCalled();
    });

    it('says previous / next photo, with first / last reasons, in a reading sequence', async () => {
        render(<StepButtons hasOlder={false} hasNewer onOlder={vi.fn()} onNewer={vi.fn()} sequence="reading" />);
        expect(screen.queryByRole('button', { name: 'Older' })).toBeNull();
        const previous = screen.getByRole('button', { name: 'Previous photo' });
        expect(previous).toHaveAttribute('title', 'This is the first photo');
        expect(screen.getByRole('button', { name: 'Next photo' })).not.toHaveAttribute('aria-disabled');
    });
});
