import React from 'react';
import { useTranslation } from '../../../../i18n';
import { cn } from '../../../../utils/classnames';
import type { S03ClockData } from '../api';
import { s03Copy } from '../recapCopy';
import { Headline, MessageBody, type SlideProps } from './common';
import { Narration } from '../../shared/typeRoles';
import { heldReveal } from './style';
import { STAR_FALL_MS, StarDial } from './StarDial';

export { STAR_FALL_MS };

/**
 * Slide 3, 彼女の夜は、あなたの夜: a 24-hour star clock, one star per message,
 * no axis numbers, four faint cardinal dots. The stars fall in over 2 s; the
 * peak hour glows above its representative message. A flat day (`band`) has no
 * peak to glow. With reduced motion the clock is drawn still.
 */
export const S03Clock: React.FC<SlideProps<S03ClockData>> = ({ data, nickname, reducedMotion, paused }) => {
    const { t } = useTranslation();
    const copy = s03Copy(data);
    const body = heldReveal(reducedMotion, paused, STAR_FALL_MS - 400);
    const lines = heldReveal(reducedMotion, paused, STAR_FALL_MS);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
            <Headline>{t(copy.title.key, copy.title.params)}</Headline>
            <StarDial data={data} glow={copy.glow} reducedMotion={reducedMotion} paused={paused} className="w-4/5 max-w-xs" />
            {(copy.lead || data.representative) && (
                <div className={cn('flex flex-col gap-2', body.className)} style={body.style}>
                    {copy.lead && <Narration>{t(copy.lead.key, copy.lead.params)}</Narration>}
                    {data.representative && <MessageBody message={data.representative} nickname={nickname} quoteClassName="line-clamp-4" />}
                </div>
            )}
            {copy.streak && (
                <Narration className={cn('tabular-nums', lines.className)} style={lines.style}>
                    {t(copy.streak.key, copy.streak.params)}
                </Narration>
            )}
        </div>
    );
};
