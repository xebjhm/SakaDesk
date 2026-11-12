import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import i18n from '../../../i18n';
import { server } from '../../../__tests__/mocks/server';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchDay: vi.fn() };
});
import { fetchDay } from '../api';
import { MergedTimeline } from './MergedTimeline';
import { Swimlanes } from './Swimlanes';
import { FilmStrip } from '../favorites/FilmStrip';
import { dayPeople } from './people';
import { contextCaption, shownTexts } from '../shared/captions';
import { MEMBER_PATH } from '../__fixtures__/memories';
import { dayMessage, dayPayload, MIKU } from './__fixtures__';
import type { DayMessage } from '../types';

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    server.use(
        http.get('/api/app-state/translations', () => HttpResponse.json({})),
        http.patch('/api/app-state/translations', () => HttpResponse.json({})),
        http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
    );
});

const WORDS = 'この景色、見せたかった';
/** Her photo at 13:00 JST whose paired words are her text a minute later (`caption_id` 11). */
const PHOTO = dayMessage(MIKU, {
    id: 10, ts: '2024-09-14T04:00:00Z', type: 'picture', text: null, caption: WORDS, caption_id: 11,
    media_file: 'messages/34 金村 美玖/58 金村 美玖/picture/10.jpg',
    media_url: '/api/content/media/hinatazaka46/messages/58/picture/10.jpg',
});
const TEXT = dayMessage(MIKU, { id: 11, ts: '2024-09-14T04:01:00Z', text: WORDS });

const count = () => screen.queryAllByText(WORDS).length;

describe('day-context captions', () => {
    it('drops a caption whose own message is in the list, keeps it otherwise', () => {
        expect(contextCaption(PHOTO, shownTexts([PHOTO, TEXT]))).toBeNull();
        expect(contextCaption(PHOTO, shownTexts([PHOTO]))).toBe(WORDS);
        // Same id in another room is a different message.
        expect(contextCaption(PHOTO, shownTexts([{ ...TEXT, room: 'messages/other' } as DayMessage]))).toBe(WORDS);
    });

    it('MergedTimeline shows her words once', () => {
        const people = new Map(dayPeople([MIKU], [PHOTO, TEXT]).map((p) => [p.key, p]));
        render(<MergedTimeline messages={[PHOTO, TEXT]} people={people} service="hinatazaka46" />);
        expect(count()).toBe(1);
    });

    it('MergedTimeline keeps the caption when its message is not in view', () => {
        const people = new Map(dayPeople([MIKU], [PHOTO]).map((p) => [p.key, p]));
        render(<MergedTimeline messages={[PHOTO]} people={people} service="hinatazaka46" />);
        expect(count()).toBe(1);
    });

    it('an expanded swimlane card does not repeat a caption shown as its own card', async () => {
        render(<Swimlanes members={[MIKU]} messages={[PHOTO, TEXT]} />);
        const [photoCard] = screen.getAllByTestId('day-lane-card');
        await userEvent.click(photoCard.querySelector('button')!);
        expect(count()).toBe(1);
    });

    it('an expanded swimlane card keeps a caption whose message is not in view', async () => {
        render(<Swimlanes members={[MIKU]} messages={[PHOTO]} />);
        await userEvent.click(screen.getByTestId('day-lane-card').querySelector('button')!);
        expect(count()).toBe(1);
    });

    it('the film strip keeps the focused photo\'s words when their text is beyond the visible frames', async () => {
        const burst = [10, 20, 30, 40].map((n) => dayMessage(MIKU, {
            id: n, ts: `2024-09-14T04:0${n / 10}:00Z`, type: 'picture', text: null,
            media_url: `/api/content/media/hinatazaka46/p${n}.jpg`,
            ...(n === 10 ? { caption: WORDS, caption_id: 11 } : {}),
        }));
        const far = dayMessage(MIKU, { id: 11, ts: '2024-09-14T04:09:00Z', text: WORDS });
        vi.mocked(fetchDay).mockReset().mockResolvedValue(dayPayload({ members: [MIKU], messages: [...burst, far] }));
        render(<FilmStrip service="hinatazaka46" memberPath={MEMBER_PATH} date="2024-09-14" focusId={10} onClose={vi.fn()} />);
        expect(await screen.findByTestId('film-focus')).toHaveTextContent(WORDS);
    });

    it('the film strip leaves the words to their own frame', async () => {
        vi.mocked(fetchDay).mockReset().mockResolvedValue(dayPayload({ members: [MIKU], messages: [PHOTO, TEXT] }));
        render(<FilmStrip service="hinatazaka46" memberPath={MEMBER_PATH} date="2024-09-14" focusId={10} onClose={vi.fn()} />);
        await screen.findByTestId('film-focus');
        expect(count()).toBe(1);
    });
});
