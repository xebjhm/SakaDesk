import React from 'react';
import { useTranslation } from '../../../../i18n';
import { cn } from '../../../../utils/classnames';
import type { S12SentenceData } from '../api';
import { s12Copy, withNickname } from '../recapCopy';
import type { SlideProps } from './common';
import { NARRATION_CLASS, QUOTE_CLASS, reveal } from './style';

/** Slide 12, 今年の、ひとこと: the one sentence in vertical serif type on black, her photo of that day faintly behind. */
export const S12Sentence: React.FC<SlideProps<S12SentenceData>> = ({ data, recap, nickname, reducedMotion }) => {
    const { t } = useTranslation();
    const copy = s12Copy(recap.year);
    const sentence = reveal(reducedMotion, 400);
    return (
        <div className="relative flex h-full flex-col items-center justify-center gap-8 bg-viewer-stage px-8 py-16">
            {data.photo_url && (
                <img
                    data-testid="s12-photo"
                    src={data.photo_url}
                    alt=""
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20"
                />
            )}
            <p data-voice="narration" className={cn(NARRATION_CLASS, 'relative text-viewer-muted')}>
                {t(copy.title.key, copy.title.params)}
            </p>
            <p
                lang="ja"
                data-voice="quote"
                className={cn(QUOTE_CLASS, 'relative max-h-full leading-loose tracking-widest text-viewer', sentence.className)}
                style={{ writingMode: 'vertical-rl', ...sentence.style }}
            >
                {withNickname(data.sentence, nickname)}
            </p>
        </div>
    );
};
