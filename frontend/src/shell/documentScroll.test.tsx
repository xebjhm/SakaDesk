/**
 * N-R4-3: the app shell never scrolls at the document level, and sr-only labels inside
 * scrolled lists are contained by a positioned ancestor (else they sit relative to the page
 * and make the document taller than the window, so a wheel moves the whole shell).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../i18n';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NicknameProvider } from '../features/memories/shared/useNickname';
import { CardTile } from '../features/memories/memoir/CardTile';
import { card } from '../features/memories/memoir/__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const css = readFileSync(path.resolve(__dirname, '../index.css'), 'utf-8');

const POSITIONED = /(?:^|\s)(relative|absolute|fixed|sticky)(?:\s|$)/;

function positionedAncestor(el: HTMLElement, stop: HTMLElement): HTMLElement | null {
    for (let node = el.parentElement; node; node = node.parentElement) {
        if (POSITIONED.test(node.className)) return node;
        if (node === stop) break;
    }
    return null;
}

describe('document-level scrolling', () => {
    it('html, body and #root fill the window and never scroll', () => {
        const rule = /html,\s*body,\s*#root\s*\{([^}]*)\}/.exec(css);
        expect(rule, 'the shell rule').not.toBeNull();
        expect(rule![1]).toMatch(/height:\s*100%/);
        expect(rule![1]).toMatch(/overflow:\s*hidden/);
    });

    it('a binder tile contains its sr-only label', () => {
        render(<NicknameProvider nickname="みーぱん"><CardTile card={card({ key: 'first.picture', earned: false, date: null })} /></NicknameProvider>);
        const tile = screen.getByTestId('card-tile');
        const label = tile.querySelector<HTMLElement>('.sr-only');
        expect(label).not.toBeNull();
        expect(positionedAncestor(label!, tile)).toBe(tile);
    });
});
