import React from 'react';
import { useTranslation } from '../../../../i18n';
import type { RecapMessage, S08EchoData } from '../api';
import { s08Copy } from '../recapCopy';
import { ThenNowPair, type ThenNowSideView } from '../../thenNow/ThenNowPair';
import { Headline, type SlideProps } from './common';
import { Narration } from '../../shared/typeRoles';
import { heldReveal } from './style';

/** A recap message as one pair side: its label (if any) over the message alone. */
const side = (message: RecapMessage | null, label: string | null): ThenNowSideView | null =>
    (message ? { year: null, label, items: [message] } : null);

/**
 * Slide 8, 去年の、同じ日: an earlier message beside one of this year, drawn by the shared
 * あの日と今日 pair (`ThenNowPair variant="slide"`): the older card in the approved full sepia,
 * the shared keyword lit in both (only in her words, never inside the fan's nickname). "The same
 * day" only when they share the JST day; otherwise "then and now". `first_week`: the fan's first
 * subscription week beside now (初見 vs 今), or the first week on record when the subscription
 * start is unknown.
 */
export const S08Echo: React.FC<SlideProps<S08EchoData>> = ({ data, recap, nickname, reducedMotion, paused }) => {
    const { t } = useTranslation();
    const copy = s08Copy(data, recap.member.subscription_start);
    const keyword = data.mode === 'echo' ? data.shared_keyword : null;
    const line = heldReveal(reducedMotion, paused, 1400);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <Headline>{t(copy.title.key, copy.title.params)}</Headline>
            <ThenNowPair
                variant="slide"
                then={side(data.then, copy.thenLabel ? t(copy.thenLabel.key, copy.thenLabel.params) : null)}
                now={side(data.now, copy.nowLabel ? t(copy.nowLabel.key, copy.nowLabel.params) : null)}
                sharedKeyword={keyword}
                nickname={nickname}
                reveal={{ then: heldReveal(reducedMotion, paused, 300), now: heldReveal(reducedMotion, paused, 900) }}
            />
            {copy.line && (
                <Narration className={line.className} style={line.style}>{t(copy.line.key, copy.line.params)}</Narration>
            )}
        </div>
    );
};
