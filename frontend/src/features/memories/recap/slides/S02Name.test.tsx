import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../../i18n';
import { S02Name } from './S02Name';
import { message, payload } from '../__fixtures__/payload';
import type { S02NameData } from '../api';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const base: S02NameData = {
    mode: 'nickname', count: 42, first: message(2, '%%%、今日もありがとう'), last: message(3, 'またね、%%%'),
    fragments: ['%%%、がんばったね'], single: false,
};
const renderS02 = (data: S02NameData) =>
    render(<S02Name data={data} fallback={null} recap={payload()} nickname="ゆき" reducedMotion={false} paused={false} onMediaEnd={() => {}} />);

describe('S02Name', () => {
    it('spells the nickname, shows the first and latest sentence and the count', () => {
        renderS02(base);
        expect(screen.getByTestId('s02-word')).toHaveAccessibleName('ゆき');
        expect(screen.getByText('ゆき、今日もありがとう')).toHaveAttribute('data-voice', 'quote');
        expect(screen.getByText('またね、ゆき')).toBeInTheDocument();
        expect(screen.getByText('ゆき、がんばったね')).toBeInTheDocument();
        expect(screen.getByText('今年、42回 名前を呼んでくれた。')).toHaveAttribute('data-voice', 'narration');
        expect(screen.getByText('季節が巡っても、彼女が名前を呼ぶ声だけは変わらない温度でした。')).toBeInTheDocument();
    });

    it('renders without a missing first or last', () => {
        renderS02({ ...base, last: null, first: null });
        expect(document.body.textContent).not.toMatch(/null|undefined/);
    });

    it('single occurrence copy', () => {
        renderS02({ ...base, count: 1, single: true, last: null });
        expect(screen.getByText('今年、一度だけ。でも、確かに呼んでくれた。')).toBeInTheDocument();
        expect(screen.queryByText(/1回/)).toBeNull();
    });

    it('daisuki mode', () => {
        renderS02({ ...base, mode: 'daisuki', count: 5, first: message(4, '大好きだよ'), last: null, fragments: [] });
        expect(screen.getByTestId('s02-word')).toHaveAccessibleName('大好き');
        expect(screen.getByText('“大好き”を、5回。')).toBeInTheDocument();
        expect(screen.getByText('季節が巡っても、“大好き”の温度は変わりませんでした。')).toBeInTheDocument();
    });

    it('daisuki mode with a single 大好き never claims she called the name', () => {
        renderS02({ ...base, mode: 'daisuki', count: 1, single: true, first: message(4, '大好きだよ'), last: null, fragments: [] });
        expect(screen.getByText('今年、一度だけの“大好き”。')).toHaveAttribute('data-voice', 'narration');
        expect(document.body.textContent).not.toMatch(/名前|呼/);
        expect(screen.queryByText(/1回/)).toBeNull();
    });

    it('daisuki mode with many 大好き never claims she called the name', () => {
        renderS02({ ...base, mode: 'daisuki', count: 5, first: message(4, '大好きだよ'), last: null, fragments: [] });
        expect(document.body.textContent).not.toMatch(/名前|呼/);
    });
});
