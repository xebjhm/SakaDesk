import React from 'react';
import { useTranslation } from '../../../i18n';
import { maskedNickname } from './nicknameMask';
import { cn } from '../../../utils/classnames';
import { replaceNickname } from '../../messages/utils/nickname';
import { useNickname } from './useNickname';

// ASCII %%% and fullwidth ％％％ (as `messages/utils/nickname.ts`); split keeps the matches.
const PLACEHOLDER_SPLIT = /(%%%|％％％)/;
const PLACEHOLDER = /^(?:%%%|％％％)$/;

interface MemoryTextProps {
    /** Her raw words, `%%%` / `％％％` kept. */
    text: string;
    /** Overrides the Memories nickname (`useNickname`); blank counts as none. */
    nickname?: string;
    /** Underline each replaced nickname (the names view). */
    underlineNickname?: boolean;
    className?: string;
    as?: 'p' | 'span' | 'div';
}

/**
 * Her words as she wrote them: `lang="ja"`, line breaks kept (`whitespace-pre-wrap`), the
 * nickname placeholder replaced with the fan's nickname (`replaceNickname` semantics), each
 * replacement optionally underlined. Without a nickname the placeholder shows 『＊＊＊』.
 */
export const MemoryText: React.FC<MemoryTextProps> = ({ text, nickname, underlineNickname = false, className, as = 'p' }) => {
    const { t } = useTranslation();
    const fromContext = useNickname();
    const own = nickname !== undefined ? (nickname.trim() ? nickname : undefined) : fromContext;
    const name = own ?? maskedNickname(t);
    const Tag = as;
    let body: React.ReactNode;
    if (!underlineNickname) {
        body = replaceNickname(text, name);
    } else {
        body = text.split(PLACEHOLDER_SPLIT).map((part, i) => (
            PLACEHOLDER.test(part)
                ? <span key={i} className="underline decoration-accent underline-offset-4">{name}</span>
                : part
        ));
    }
    return (
        <Tag data-testid="memory-text" lang="ja" className={cn('whitespace-pre-wrap', className)}>
            {body}
        </Tag>
    );
};
