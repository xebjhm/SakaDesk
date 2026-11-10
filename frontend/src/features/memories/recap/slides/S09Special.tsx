import React from 'react';
import { useTranslation } from '../../../../i18n';
import { cn } from '../../../../utils/classnames';
import type { RecapStub, S09SpecialData } from '../api';
import { formatMessageDate } from '../../shared/jst';
import { formatSecondsOfDay, s09Copy, s09StubCopy, withNickname } from '../recapCopy';
import { Headline, Quote, type SlideProps } from './common';
import { Narration } from '../../shared/typeRoles';
import { heldReveal } from './style';

interface StubProps {
    stub: RecapStub;
    nickname: string;
    reveal: { className: string; style?: React.CSSProperties };
}

/**
 * One ticket stub: the day's label and its time (seconds after midnight in monospace for a
 * midnight message, else the JST date), a dashed tear line, then her words. A sealed stub
 * shows only its label and the line saying when it opens.
 */
const Stub: React.FC<StubProps> = ({ stub, nickname, reveal }) => {
    const { t, i18n } = useTranslation();
    const copy = s09StubCopy(stub);
    const message = stub.sealed ? null : stub.message;
    const seconds = message && stub.seconds_after_midnight !== null ? formatSecondsOfDay(stub.seconds_after_midnight) : null;
    const date = message && !seconds ? formatMessageDate(message.ts, i18n.language) : null;
    const words = message ? (message.text ?? message.caption) : null;
    const picture = message && !words && message.type === 'picture' ? message.media_url : null;
    return (
        <div
            data-testid="s09-stub"
            data-sealed={stub.sealed ? 'true' : 'false'}
            className={cn('flex w-full items-stretch rounded-sm bg-card shadow-card', stub.sealed && 'opacity-80', reveal.className)}
            style={reveal.style}
        >
            <div className="flex w-24 shrink-0 flex-col items-center justify-center gap-1 px-2 py-3">
                <span className="font-sans text-caption text-muted">{t(copy.label.key, copy.label.params)}</span>
                {seconds && <span data-testid="s09-seconds" className="font-mono text-small tabular-nums text-primary">{seconds}</span>}
                {date && <time data-testid="s09-date" dateTime={message?.ts} className="text-small tabular-nums text-primary">{date}</time>}
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 border-l border-dashed border-subtle px-3 py-3 text-left">
                {copy.sealed && <Narration>{t(copy.sealed.key, copy.sealed.params)}</Narration>}
                {words && <Quote className="line-clamp-2 text-body">{withNickname(words, nickname)}</Quote>}
                {picture && <img src={picture} alt="" className="h-12 w-12 rounded-xs object-cover" />}
                {copy.note && <Narration className="text-muted">{t(copy.note.key, copy.note.params)}</Narration>}
            </div>
        </div>
    );
};

/**
 * Slide 9, 特別な日: ticket stubs for her birthday, Christmas (sealed until 12/25), New Year 0:00
 * and the fan's subscription anniversary, whose copy never implies she knew the day.
 */
export const S09Special: React.FC<SlideProps<S09SpecialData>> = ({ data, nickname, reducedMotion, paused }) => {
    const { t } = useTranslation();
    const copy = s09Copy();
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <Headline>{t(copy.title.key, copy.title.params)}</Headline>
            {data.stubs.map((stub, i) => (
                <Stub key={`${stub.kind}:${i}`} stub={stub} nickname={nickname} reveal={heldReveal(reducedMotion, paused, 300 + i * 350)} />
            ))}
        </div>
    );
};
