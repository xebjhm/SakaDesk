import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/**
 * Every user-facing key of the 0.5.0 media pipeline (dotted paths). Each UI task
 * (M4 Settings, M5 grid, ...) appends its keys here.
 */
export const MEDIA_PIPELINE_KEYS = [
    'settings.mediaCache',
    'settings.mediaCacheSize',
    'settings.mediaCachePreparing',
    'settings.mediaCacheClear',
    'settings.mediaCacheCleared',
    'settings.mediaCacheFull',
    'settings.mediaCacheLoadFailed',
    'settings.mediaCacheClearFailed',
] as const;

function lookup(tree: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>(
        (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
        tree,
    );
}

/** The agreed wording (Japanese is the reference copy). */
const SETTINGS_WORDING = {
    ja: ['サムネイルキャッシュ', '{{size}} 使用中', 'サムネイルを準備中… {{done}} / {{total}}', '削除', 'サムネイルキャッシュを削除しました',
        '上限に達しました。閲覧に合わせて古いサムネイルから入れ替わります', 'キャッシュ容量を読み込めませんでした', 'サムネイルキャッシュを削除できませんでした'],
    en: ['Thumbnail cache', '{{size}} used', 'Preparing thumbnails… {{done}} / {{total}}', 'Clear', 'Thumbnail cache cleared',
        'Full. Older thumbnails are replaced as you browse', "Couldn't read the cache size", "Couldn't clear the thumbnail cache"],
    'zh-TW': ['縮圖快取', '已使用 {{size}}', '正在準備縮圖… {{done}} / {{total}}', '清除', '已清除縮圖快取',
        '已達上限，瀏覽時會替換較舊的縮圖', '無法讀取快取大小', '無法清除縮圖快取'],
    'zh-CN': ['缩略图缓存', '已使用 {{size}}', '正在准备缩略图… {{done}} / {{total}}', '清除', '已清除缩略图缓存',
        '已达上限，浏览时会替换较旧的缩略图', '无法读取缓存大小', '无法清除缩略图缓存'],
    yue: ['縮圖快取', '用咗 {{size}}', '準備緊縮圖… {{done}} / {{total}}', '清除', '已經清除咗縮圖快取',
        '已經到咗上限，睇嘅時候會換走舊啲嘅縮圖', '讀唔到快取大小', '清除唔到縮圖快取'],
} as const;

describe('media pipeline strings', () => {
    it.each(Object.keys(locales))('%s has every media pipeline key', (code) => {
        const tree = locales[code as keyof typeof locales];
        for (const key of MEDIA_PIPELINE_KEYS) {
            const value = lookup(tree, key);
            expect(typeof value, `${code}.${key}`).toBe('string');
            expect((value as string).trim(), `${code}.${key}`).not.toBe('');
        }
    });

    it.each(Object.entries(SETTINGS_WORDING))('%s uses the agreed Settings wording', (code, want) => {
        const tree = locales[code as keyof typeof locales];
        MEDIA_PIPELINE_KEYS.slice(0, 8).forEach((key, i) => {
            expect(lookup(tree, key), `${code}.${key}`).toBe(want[i]);
        });
    });

    it('keeps the interpolation variables in every locale', () => {
        for (const code of Object.keys(locales)) {
            const tree = locales[code as keyof typeof locales];
            expect(lookup(tree, 'settings.mediaCacheSize')).toContain('{{size}}');
            expect(lookup(tree, 'settings.mediaCachePreparing')).toContain('{{done}}');
            expect(lookup(tree, 'settings.mediaCachePreparing')).toContain('{{total}}');
        }
    });
});
