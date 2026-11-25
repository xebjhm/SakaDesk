import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;
type Tree = Record<string, Record<string, string>>;

describe('design-system strings', () => {
    it.each(Object.entries(locales))('%s has the date and badge keys', (_code, data) => {
        const tree = data as unknown as Tree;
        expect(tree.date?.today).toBeTruthy();
        expect(tree.date?.yesterday).toBeTruthy();
        expect(tree.common.unreadCount).toContain('{{count}}');
    });
});

const DESIGN_PAGE_KEYS = [
    'title', 'subtitle', 'group', 'colors', 'neutral', 'groupColors', 'contrast', 'contrastNA',
    'radius', 'shadow', 'type', 'sample', 'motion', 'animate', 'primitives', 'surfaces', 'pills',
    'filterAll', 'filterUnread', 'badges', 'avatars', 'datePills', 'buttons', 'primary', 'secondary',
    'ghost', 'disabled', 'close', 'rail', 'modal', 'openModal', 'modalTitle', 'modalBody', 'rules',
    'do', 'dont', 'do1', 'dont1', 'do2', 'dont2', 'do3', 'dont3',
    'levelsSample', 'search', 'scale', 'logoStep', 'roles', 'roleName', 'roleStep',
    'loading', 'playWait',
] as const;

describe('design page strings', () => {
    it.each(Object.entries(locales))('%s has every designPage key', (_code, data) => {
        const page = (data as unknown as Tree).designPage;
        for (const key of DESIGN_PAGE_KEYS) expect(page?.[key], key).toBeTruthy();
        expect(page.contrast).toContain('{{ratio}}');
    });
});

describe('design page colour-system strings', () => {
    it.each(Object.entries(locales))('%s has the scale and role keys', (_code, data) => {
        const page = (data as unknown as Tree).designPage;
        for (const key of ['scale', 'logoStep', 'roles', 'roleName', 'roleStep']) expect(page?.[key], key).toBeTruthy();
    });
});
