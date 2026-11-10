import React from 'react';
import { useTranslation } from '../../../../i18n';
import { cn } from '../../../../utils/classnames';
import type { S02NameData } from '../api';
import { s02Copy, withNickname } from '../recapCopy';
import { Headline, MessageBody, type SlideProps } from './common';
import { Narration } from '../../shared/typeRoles';
import { heldReveal } from './style';

const LETTER_STAGGER_MS = 160;
const MAX_DRIFT = 3;

/**
 * Slide 2, 名前を、呼ばれた: the nickname spelled out letter by letter, a few of
 * her nickname sentences drifting by, then the first and the latest one of the
 * year. Without `%%%` the same layout carries 大好き.
 */
export const S02Name: React.FC<SlideProps<S02NameData>> = ({ data, nickname, reducedMotion, paused }) => {
    const { t } = useTranslation();
    const copy = s02Copy(data);
    const word = data.mode === 'daisuki' ? t('recap.s02.daisukiWord') : nickname;
    const letters = Array.from(word);
    const settle = letters.length * LETTER_STAGGER_MS + 400;
    const drift = data.fragments.slice(0, MAX_DRIFT).map((f) => withNickname(f, nickname));
    const shown = [data.first, data.last].filter((m): m is NonNullable<typeof m> => m !== null);
    const quotes = heldReveal(reducedMotion, paused, settle);
    const lines = heldReveal(reducedMotion, paused, settle + 400);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
            <Headline>{t(copy.title.key, copy.title.params)}</Headline>
            <p data-testid="s02-word" aria-label={word} lang="ja" className="font-display text-display font-semibold text-primary">
                {letters.map((ch, i) => {
                    const r = heldReveal(reducedMotion, paused, i * LETTER_STAGGER_MS);
                    return <span key={i} aria-hidden="true" className={cn('inline-block', r.className)} style={r.style}>{ch}</span>;
                })}
            </p>
            {drift.length > 0 && (
                <div className="flex flex-col gap-1">
                    {drift.map((f, i) => {
                        const r = heldReveal(reducedMotion, paused, 300 + i * 300);
                        return <p key={i} lang="ja" data-voice="quote" className={cn('font-display text-small text-muted', r.className)} style={r.style}>{f}</p>;
                    })}
                </div>
            )}
            {shown.length > 0 && (
                <div className={cn('flex flex-col gap-4', quotes.className)} style={quotes.style}>
                    {shown.map((m) => <MessageBody key={`${m.member_path ?? ''}:${m.id}`} message={m} nickname={nickname} />)}
                </div>
            )}
            <Narration className={lines.className} style={lines.style}>{t(copy.count.key, copy.count.params)}</Narration>
        </div>
    );
};
