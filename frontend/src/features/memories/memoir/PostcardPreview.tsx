/**
 * Dev-only preview of the 特別な日 postcards with fake data (a 3-year 元旦 stack and its backs), for
 * the `?view=design` page: real archives rarely hold a special day across several years, so the
 * fan, the sepia by year and the arrow keys could not be eyeballed otherwise. Imported only by
 * `design/DesignPage.tsx`, which main.tsx loads behind `import.meta.env.DEV`, so it never reaches
 * a production bundle.
 */
import React, { useState } from 'react';
import { aurora } from '../../../design/tokens';
import type { BinderCard, MemoryMessage } from '../types';
import { PostcardRack, PostcardStack } from './Postcard';

const [sky, lavender, pink, peach] = aurora.stops;

/** A small landscape picture drawn from the aurora stops (no file, no literal colours). */
const PICTURE = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect width="120" height="80" fill="${sky}"/>`
    + `<circle cx="90" cy="24" r="12" fill="${peach}"/><path d="M0 80 L40 36 L70 62 L95 44 L120 80 Z" fill="${lavender}"/>`
    + `<path d="M0 80 L30 58 L60 80 Z" fill="${pink}"/></svg>`,
)}`;

const message = (id: number, ts: string, over: Partial<MemoryMessage> = {}): MemoryMessage => ({
    id, room: 'preview', member_path: 'preview', service: 'preview', ts, type: 'text', text: null, caption: null,
    caption_id: null, media_url: null, media_file: null, duration_s: null, favorited: false, avatar_url: null, ...over,
});

const picture = (id: number, ts: string): MemoryMessage => message(id, ts, { type: 'picture', media_url: PICTURE });

const CARD: BinderCard = {
    key: 'special.newyear', earned: true, foil: false, rare: false, date: '2026-01-01', refs: {}, progress: null,
    detail: {}, letter: null,
    face: message(30, '2025-12-31T15:03:00Z', { text: 'あけましておめでとうございます🌅 今年もいっぱいお話ししようね。おみくじは中吉でした！' }),
    years: [
        {
            year: 2024, date: '2024-01-01', photo: picture(11, '2024-01-01T03:00:00Z'),
            face: message(10, '2023-12-31T15:20:00Z', { text: '新年あけましておめでとう！ 初日の出、見られたかな？' }),
        },
        {
            year: 2025, date: '2025-01-01', photo: picture(21, '2025-01-01T02:00:00Z'),
            face: message(20, '2024-12-31T15:12:00Z', { text: '今年の目標はお料理です🍳 たくさん作って報告するね' }),
        },
        {
            year: 2026, date: '2026-01-01', photo: picture(31, '2026-01-01T01:00:00Z'),
            face: message(30, '2025-12-31T15:03:00Z', { text: 'あけましておめでとうございます🌅 今年もいっぱいお話ししようね。おみくじは中吉でした！' }),
        },
    ],
};

const SENDER = { name: 'メンバーA', oshi: true };

/** The shelf stack (hover or Tab to fan it) beside the opened backs (arrow keys move between years). */
export const PostcardPreview: React.FC = () => {
    const [year, setYear] = useState(2026);
    return (
        <div data-testid="postcard-preview" className="flex flex-wrap items-start gap-8">
            <PostcardStack card={CARD} title="元旦" sender={SENDER} onOpen={() => setYear(2026)} />
            <PostcardRack card={CARD} sender={SENDER} selected={year} onSelect={setYear} />
        </div>
    );
};
