import React from 'react';
import { useTranslation } from '../../../../i18n';
import { cn } from '../../../../utils/classnames';
import type { S13OyasumiData } from '../api';
import { s13Copy } from '../recapCopy';
import { Headline, MessageBody, Narration, type SlideProps } from './common';
import { reveal } from './style';

/**
 * Slide 13, 今年最後の、おやすみ: one small light above her last おやすみ of the
 * year (the newest one while the year is still running). Graduated in the
 * year: her last message, no light, fully quiet.
 */
export const S13Oyasumi: React.FC<SlideProps<S13OyasumiData>> = ({ data, fallback, recap, nickname, reducedMotion }) => {
    const { t } = useTranslation();
    const copy = s13Copy(data, fallback, recap.year);
    const quiet = data.graduated || reducedMotion;
    const body = reveal(quiet, 400);
    const lines = reveal(quiet, 1000);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
            {!data.graduated && (
                <span
                    data-testid="s13-light"
                    aria-hidden="true"
                    className={cn('h-3 w-3 rounded-full bg-expressive-orb-1', !reducedMotion && 'animate-orb-breathe motion-reduce:animate-none')}
                />
            )}
            <Headline>{t(copy.title.key, copy.title.params)}</Headline>
            {data.message && (
                <div className={body.className} style={body.style}>
                    <MessageBody message={data.message} nickname={nickname} />
                </div>
            )}
            {(copy.note || copy.narration) && (
                <div className={cn('flex flex-col gap-2', lines.className)} style={lines.style}>
                    {copy.note && <Narration>{t(copy.note.key, copy.note.params)}</Narration>}
                    {copy.narration && <Narration>{t(copy.narration.key, copy.narration.params)}</Narration>}
                </div>
            )}
        </div>
    );
};
