import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeatureActiveContext } from '../featureActive';
import { openDialogCount } from '../dialog/dialogStack';
import { Modal } from './Modal';
import { Menu, MenuItem } from './Menu';

const ui = (active: boolean) => (
    <FeatureActiveContext.Provider value={active}>
        <Modal isOpen onClose={vi.fn()} title="日付で探す" closeLabel="閉じる" logId="calendar">本文</Modal>
        <Menu aria-label="操作" onClose={vi.fn()} point={{ x: 10, y: 10 }}><MenuItem>一</MenuItem></Menu>
    </FeatureActiveContext.Provider>
);

describe('dialogs and menus of a hidden feature (plan F Task 5)', () => {
    it('render nothing while the feature is hidden, and leave the dialog stack', () => {
        const { rerender } = render(ui(true));
        expect(screen.getByRole('dialog', { name: '日付で探す' })).toBeInTheDocument();
        expect(screen.getByRole('menu', { name: '操作' })).toBeInTheDocument();
        rerender(ui(false));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByRole('menu')).toBeNull();
        expect(openDialogCount()).toBe(0);
        rerender(ui(true));
        expect(screen.getByRole('dialog', { name: '日付で探す' })).toBeInTheDocument();
    });
});
