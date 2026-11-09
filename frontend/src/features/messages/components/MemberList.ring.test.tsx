import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { MemberList } from './MemberList';

const LOCAL = '/api/content/media/hinatazaka46/messages/66%20A/120%20A/profile_images/group_thumbnail/a.jpg';
const ONLINE = '日向坂46/messages/66 オンライン/120 オンライン';
const OFFLINE = '日向坂46/messages/67 オフライン/121 オフライン';
const GRAD = '日向坂46/messages/70 卒業/130 卒業';

function group(id: string, name: string, path: string, extra: Record<string, unknown>, member: Record<string, unknown>) {
    return {
        id, name, service: 'hinatazaka46', dir_name: `${id} ${name}`,
        group_path: path.split('/').slice(0, 3).join('/'), member_count: 1, is_group_chat: false,
        server_unread_count: 0, ...extra,
        members: [{ id: `m${id}`, name, path, ...member }],
    };
}

const groups = [
    group('66', 'オンライン', ONLINE, { is_active: true }, { group_thumbnail_local: LOCAL, group_thumbnail: 'https://cdn.example/a.jpg' }),
    group('67', 'オフライン', OFFLINE, { is_active: false }, { group_thumbnail: 'https://cdn.example/b.jpg' }),
    group('70', '卒業', GRAD, { is_active: false, is_graduated: true }, { group_thumbnail: 'https://cdn.example/c.jpg' }),
];

beforeAll(async () => { await i18n.changeLanguage('en'); });

function serve() {
    server.use(
        http.get('/api/content/groups', () => HttpResponse.json({ groups, last_sync: {} })),
        http.post('/api/content/unread_counts', () => HttpResponse.json({})),
    );
}

async function cell(name: string) {
    const button = await screen.findByRole('button', { name: new RegExp(name) });
    const img = button.querySelector('img')!;
    const ring = img.parentElement!;
    return { button, img, ring };
}

/** No element from the ring up to the cell button may filter or scale it. */
function expectRingUntouched(ring: HTMLElement, button: HTMLElement) {
    for (let el: HTMLElement | null = ring; el && el !== button; el = el.parentElement) {
        expect(el.style.filter).toBe('');
        expect(el.className).not.toMatch(/scale|saturate|sepia|contrast|opacity|grayscale/);
    }
}

describe('MemberList avatar ring and sharpness', () => {
    it('keeps the selected ring unfiltered and unscaled, with no hover zoom', async () => {
        serve();
        render(<MemberList activeService="hinatazaka46" selectedGroupDir={OFFLINE} onSelectGroup={vi.fn()} />);
        const { button, img, ring } = await cell('オフライン');
        expect(ring).toHaveClass('ring-2', 'ring-accent', 'ring-offset-2');
        expectRingUntouched(ring, button);
        // The inactive look sits on the image only, softened (no contrast cut).
        expect(img).toHaveClass('opacity-75', 'saturate-50');
        expect(img.className).not.toMatch(/contrast/);
        // Selected: no hover scale at all.
        expect(img.className).not.toMatch(/scale/);
    });

    it('zooms only the image on hover for unselected avatars', async () => {
        serve();
        render(<MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} />);
        const { button, img, ring } = await cell('オンライン');
        expect(img).toHaveClass('group-hover:scale-105');
        expect(img.className).not.toMatch(/saturate|opacity/);
        expectRingUntouched(ring, button);
    });

    it('applies the graduated sepia to the image only', async () => {
        serve();
        render(<MemberList activeService="hinatazaka46" selectedGroupDir={GRAD} onSelectGroup={vi.fn()} />);
        const { button, img, ring } = await cell('卒業');
        expect(img.style.filter).toMatch(/sepia/);
        expectRingUntouched(ring, button);
    });

    it.each([
        [1, 64],
        [1.5, 96],
        [1.75, 112],
        [2, 128],
    ])('requests the 64 px tile at %f dppx as the %i px variant, for local archived avatars only', async (dpr, w) => {
        const original = window.devicePixelRatio;
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: dpr });
        try {
            serve();
            render(<MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} />);
            expect((await cell('オンライン')).img).toHaveAttribute(
                'src',
                `/api/content/avatar/hinatazaka46/messages/66%20A/120%20A/profile_images/group_thumbnail/a.jpg?w=${w}`,
            );
            expect((await cell('オフライン')).img).toHaveAttribute('src', 'https://cdn.example/b.jpg');
        } finally {
            Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: original });
        }
    });
});
