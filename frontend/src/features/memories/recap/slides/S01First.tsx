import React from 'react';
import { useTranslation } from '../../../../i18n';
import { Avatar } from '../../../../design/primitives';
import { cn } from '../../../../utils/classnames';
import type { S01FirstData } from '../api';
import { formatClock, s01Copy } from '../recapCopy';
import { Headline, MessageBody, Narration, type SlideProps } from './common';
import { heldReveal } from './style';

/**
 * Slide 1, 今年最初の一通: a lock-screen notification (her name, the time to the
 * second) that opens into her first message of the year.
 */
export const S01First: React.FC<SlideProps<S01FirstData>> = ({ data, recap, nickname, reducedMotion, paused }) => {
    const { t, i18n } = useTranslation();
    const copy = s01Copy(data, recap.member, recap.year, i18n.language);
    const message = data.message;
    const clock = message ? formatClock(message.ts, i18n.language) : null;
    const card = heldReveal(reducedMotion, paused);
    const body = heldReveal(reducedMotion, paused, 600);
    const lines = heldReveal(reducedMotion, paused, 1200);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-8 px-8 text-center">
            {message && (
                <div className={cn('flex w-full flex-col gap-4', card.className)} style={card.style}>
                    <div
                        role="group"
                        aria-label={t('recap.s01.notification')}
                        className="flex items-center gap-3 rounded-lg bg-card px-4 py-3 text-left shadow-card"
                    >
                        <Avatar src={recap.member.avatar_url ?? undefined} name={recap.member.name} size="sm" decorative />
                        <span lang="ja" className="min-w-0 flex-1 truncate text-small font-medium text-primary">{recap.member.name}</span>
                        {clock && <span className="text-caption tabular-nums text-muted">{clock}</span>}
                    </div>
                    <div className={body.className} style={body.style}>
                        <MessageBody message={message} nickname={nickname} />
                    </div>
                </div>
            )}
            <div className={cn('flex flex-col gap-2', lines.className)} style={lines.style}>
                <Headline>{t(copy.title.key, copy.title.params)}</Headline>
                {copy.sub && <Narration>{t(copy.sub.key, copy.sub.params)}</Narration>}
            </div>
        </div>
    );
};
