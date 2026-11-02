import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n, { Trans } from './index';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

describe('memberProfile.subscribedDays', () => {
    // One interpolated sentence per locale so each language controls its own word
    // order; the old prefix + number + suffix split forced English word order.
    it.each(Object.entries(locales))('%s has a single sentence with the day count inside', (_code, data) => {
        const mp = data.memberProfile as Record<string, string>;
        expect(mp.subscribedDays).toMatch(/<num>\{\{days\}\}<\/num>/);
        expect(mp).not.toHaveProperty('subscribedFor');
        expect(mp).not.toHaveProperty('days');
    });

    it('renders the day count emphasised inside the localized sentence', async () => {
        const t = i18n.getFixedT('ja');
        await i18n.changeLanguage('ja');
        const { container } = render(
            <I18nextProvider i18n={i18n}>
                <Trans
                    t={t}
                    i18nKey="memberProfile.subscribedDays"
                    values={{ days: 128 }}
                    components={{ num: <span className="font-bold" /> }}
                />
            </I18nextProvider>,
        );
        expect(container.textContent).toBe('メンバーシップ継続 128 日！');
        expect(container.querySelector('span.font-bold')?.textContent).toBe('128');
        await i18n.changeLanguage('en');
    });
});
