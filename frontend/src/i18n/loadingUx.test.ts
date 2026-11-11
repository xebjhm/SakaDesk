import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every loading-UX wave string (L1; every later loading task appends its keys). */
export const LOADING_UX_KEYS: string[] = [
    // L1: the shared loading primitives and the design page section
    'loading.label', 'loading.slow', 'loading.verySlow', 'loading.timeout', 'loading.timeoutHint',
    'loading.error', 'loading.retry', 'loading.cancel',
    'designPage.loading', 'designPage.playWait',
    // L6: login stays cancellable while connecting; sync scanning state
    'login.waitingSlow', 'login.waitingVerySlow', 'login.finishing', 'sync.preparing', 'sync.preparingVerySlow',
    'login.cancelling',
    // L5: the chat timeline while a room loads, and bubble photos
    'messageList.loadingSlow', 'messageList.loadingVerySlow', 'messageList.loadFailed', 'messageList.loadFailedHint',
    'messageList.loadTimeout', 'messageList.loadTimeoutHint', 'media.photoLoading',
    // L4: the Memories hub's gathering line and first run; the album's page-level wait line
    'memories.home.gathering', 'memories.home.firstVerySlow', 'memories.album.waitSlow', 'memories.album.waitVerySlow',
    // L7: the recap share dialog's preview and photo gate
    'recap.share.previewLoading', 'recap.share.preparingPhotos', 'recap.share.photosUnavailable',
];

/** Recursive dotted lookup (any depth). */
const lookup = (data: unknown, dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], data);

describe('loading UX strings', () => {
    it.each(Object.entries(locales))('%s has every loading key as a non-empty string', (_code, data) => {
        for (const dotted of LOADING_UX_KEYS) {
            const value = lookup(data, dotted);
            expect(typeof value, dotted).toBe('string');
            expect(String(value).trim(), dotted).not.toBe('');
        }
    });

    it('lists every key once', () => {
        expect(new Set(LOADING_UX_KEYS).size).toBe(LOADING_UX_KEYS.length);
    });

    it.each(Object.entries(locales))('%s keeps timeout copy apart from error copy', (_code, data) => {
        expect(lookup(data, 'loading.timeout')).not.toBe(lookup(data, 'loading.error'));
        expect(lookup(data, 'loading.verySlow')).not.toBe(lookup(data, 'loading.slow'));
        expect(lookup(data, 'messageList.loadTimeout')).not.toBe(lookup(data, 'messageList.loadFailed'));
        expect(lookup(data, 'messageList.loadTimeoutHint')).not.toBe(lookup(data, 'messageList.loadFailedHint'));
        expect(lookup(data, 'memories.common.timeout')).not.toBe(lookup(data, 'memories.common.loadError'));
        expect(lookup(data, 'memories.common.verySlow')).not.toBe(lookup(data, 'memories.common.slow'));
    });

    it('uses the Japanese reference copy', () => {
        const expected: Record<string, string> = {
            'loading.label': '読み込み中…',
            'loading.slow': 'まだ読み込んでいます…',
            'loading.verySlow': 'いつもより時間がかかっています。もう少しお待ちください。',
            'loading.timeout': '時間がかかりすぎています',
            'loading.timeoutHint': '処理はまだ続いているかもしれません。少し待ってからもう一度お試しください。',
            'loading.error': '読み込めませんでした',
            'loading.retry': 'もう一度',
            'loading.cancel': 'キャンセル',
            'designPage.loading': '読み込み表示',
            'designPage.playWait': '待ち時間を再生',
            'login.waitingSlow': 'ログイン画面を開いています…',
            'login.waitingVerySlow': '開いたブラウザのウィンドウでログインを完了してください。いつでもキャンセルできます。',
            'login.finishing': 'まもなく完了します…',
            'login.cancelling': 'キャンセルしています…',
            'sync.preparing': '同期の準備中…',
            'sync.preparingVerySlow': '新しいメッセージを確認しています。メッセージが多いと少し時間がかかります。',
            'messageList.loadingSlow': 'まだメッセージを読み込んでいます…',
            'messageList.loadingVerySlow': 'メッセージの多いトークは、開くまで少し時間がかかります。',
            'messageList.loadFailed': 'メッセージを読み込めませんでした',
            'messageList.loadFailedHint': '保存したデータはそのままです。もう一度お試しください。',
            'messageList.loadTimeout': '読み込みに時間がかかりすぎています',
            'messageList.loadTimeoutHint': 'アプリがまだ処理中かもしれません。少し待ってからもう一度お試しください。',
            'media.photoLoading': '写真を読み込み中…',
            'memories.common.slow': '思い出を準備しています…',
            'memories.common.verySlow': '初めて開くときや同期の直後は、アーカイブの整理に少し時間がかかります。',
            'memories.common.timeout': 'いつもより時間がかかっています',
            'memories.common.timeoutHint': '準備はまだ続いているかもしれません。もう一度お試しください。',
            'memories.common.membersError': 'メンバーを読み込めませんでした',
        };
        for (const [key, text] of Object.entries(expected)) expect(lookup(ja, key), key).toBe(text);
    });

    it('uses the agreed L4 hub and album copy in every locale', () => {
        const table: Record<string, Record<keyof typeof locales, string>> = {
            'memories.home.gathering': {
                ja: '思い出を集めています… 新しいカードが順に表示されます。',
                en: "Gathering your memories… New cards will appear as they're ready.",
                'zh-TW': '正在收集回憶…新的卡片會陸續出現。',
                'zh-CN': '正在收集回忆…新的卡片会陆续出现。',
                yue: '收集緊回憶…新卡會陸續出現。',
            },
            'memories.home.firstVerySlow': {
                ja: '初回は思い出の索引を作るため、少し時間がかかります。下のカードは今すぐ開けます。',
                en: 'The first time, building the memories index takes a little while. The cards below already open.',
                'zh-TW': '第一次需要建立回憶索引，會花一點時間。下方的卡片現在就能開啟。',
                'zh-CN': '第一次需要建立回忆索引，会花一点时间。下方的卡片现在就能打开。',
                yue: '第一次要整回憶索引，要少少時間。下面啲卡而家已經開得。',
            },
            'memories.album.waitSlow': { ja: '写真を並べています…', en: 'Laying out your photos…', 'zh-TW': '正在排列照片…', 'zh-CN': '正在排列照片…', yue: '排緊相…' },
            'memories.album.waitVerySlow': {
                ja: '写真の多い月は、表示まで少し時間がかかります。',
                en: 'Months with many photos take a little longer to appear.',
                'zh-TW': '照片多的月份需要多一點時間才會顯示。',
                'zh-CN': '照片多的月份需要多一点时间才会显示。',
                yue: '相多嘅月份要耐少少先出到。',
            },
        };
        for (const [key, perLocale] of Object.entries(table)) {
            for (const [code, text] of Object.entries(perLocale)) {
                expect(lookup(locales[code as keyof typeof locales], key), `${code} ${key}`).toBe(text);
            }
        }
    });

    it('uses the agreed L3 Memories copy in every locale', () => {
        const table: Record<string, Record<keyof typeof locales, string>> = {
            'memories.common.slow': { ja: '思い出を準備しています…', en: 'Preparing your memories…', 'zh-TW': '正在準備你的回憶…', 'zh-CN': '正在准备你的回忆…', yue: '準備緊你嘅回憶…' },
            'memories.common.verySlow': {
                ja: '初めて開くときや同期の直後は、アーカイブの整理に少し時間がかかります。',
                en: 'The first time, or right after a sync, sorting the archive takes a little while.',
                'zh-TW': '第一次開啟或剛同步完時，整理資料需要一點時間。',
                'zh-CN': '第一次打开或刚同步完时，整理资料需要一点时间。',
                yue: '第一次開或者啱啱同步完，整理資料要少少時間。',
            },
            'memories.common.timeout': { ja: 'いつもより時間がかかっています', en: 'This is taking longer than usual', 'zh-TW': '這次比平常久', 'zh-CN': '这次比平时久', yue: '今次比平時耐' },
            'memories.common.timeoutHint': {
                ja: '準備はまだ続いているかもしれません。もう一度お試しください。',
                en: 'It may still be getting ready. Try again.',
                'zh-TW': '可能還在準備中，請再試一次。',
                'zh-CN': '可能还在准备中，请再试一次。',
                yue: '可能仲準備緊，再試多次啦。',
            },
            'memories.common.membersError': { ja: 'メンバーを読み込めませんでした', en: "Couldn't load the members", 'zh-TW': '無法載入成員', 'zh-CN': '无法加载成员', yue: '載入唔到成員' },
        };
        for (const [key, perLocale] of Object.entries(table)) {
            for (const [code, text] of Object.entries(perLocale)) {
                expect(lookup(locales[code as keyof typeof locales], key), `${code} ${key}`).toBe(text);
            }
        }
    });

    it('uses the agreed L7 share dialog copy in every locale', () => {
        const table: Record<string, Record<keyof typeof locales, string>> = {
            'recap.share.previewLoading': { ja: 'プレビューを準備中…', en: 'Preparing the preview…', 'zh-TW': '正在準備預覽…', 'zh-CN': '正在准备预览…', yue: '準備緊預覽…' },
            'recap.share.preparingPhotos': { ja: '写真を準備中…', en: 'Preparing photos…', 'zh-TW': '正在準備照片…', 'zh-CN': '正在准备照片…', yue: '準備緊相…' },
            'recap.share.photosUnavailable': {
                ja: '写真を読み込めなかったため、写真なしで書き出します。',
                en: "Photos couldn't load, so the export will have no photos.",
                'zh-TW': '照片無法載入，匯出的內容將不含照片。',
                'zh-CN': '照片无法加载，导出的内容将不含照片。',
                yue: '相載入唔到，匯出嘅內容唔會有相。',
            },
        };
        for (const [key, perLocale] of Object.entries(table)) {
            for (const [code, text] of Object.entries(perLocale)) {
                expect(lookup(locales[code as keyof typeof locales], key), `${code} ${key}`).toBe(text);
            }
        }
    });
});
