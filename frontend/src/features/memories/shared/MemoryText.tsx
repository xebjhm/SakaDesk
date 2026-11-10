import React from 'react';
import { useTranslation } from '../../../i18n';
import { maskedNickname } from './nicknameMask';
import { cn } from '../../../utils/classnames';
import { useNickname } from './useNickname';

// ASCII %%% and fullwidth ％％％ (as `messages/utils/nickname.ts`); split keeps the matches.
const PLACEHOLDER_SPLIT = /(%%%|％％％)/;
const PLACEHOLDER = /^(?:%%%|％％％)$/;

/** The nickname and highlight underline (the names view, あの日と今日's shared keyword). */
const UNDERLINE = 'underline decoration-accent underline-offset-4';
/** The year recap's keyword mark (S08's approved look). */
const MARK = 'rounded-xs bg-mark-exact px-0.5 text-primary';

interface MemoryTextProps {
    /** Her raw words, `%%%` / `％％％` kept. */
    text: string;
    /** Overrides the Memories nickname (`useNickname`); blank counts as none. */
    nickname?: string;
    /** Underline each replaced nickname (the names view). */
    underlineNickname?: boolean;
    /**
     * A word to mark wherever she wrote it (あの日と今日's shared keyword). Only her own words are
     * searched: a match inside the replaced nickname is never marked. Blank marks nothing.
     */
    highlight?: string;
    /** How {@link highlight} is drawn: the nickname underline (default) or the recap's `<mark>`. */
    highlightTone?: 'underline' | 'mark';
    className?: string;
    as?: 'p' | 'span' | 'div';
    /** The recap's type role (`quote`), passed through as `data-voice`. */
    'data-voice'?: string;
}

/** Push a node, joining it onto a preceding string so a text run stays one DOM text node. */
function push(out: React.ReactNode[], node: React.ReactNode): void {
    const last = out.length - 1;
    if (typeof node === 'string' && last >= 0 && typeof out[last] === 'string') out[last] = `${out[last] as string}${node}`;
    else if (node !== '') out.push(node);
}

/**
 * Her words as she wrote them: `lang="ja"`, line breaks kept (`whitespace-pre-wrap`), the
 * nickname placeholder replaced with the fan's nickname (`replaceNickname` semantics), each
 * replacement optionally underlined, and an optional keyword marked in her own words. Without a
 * nickname the placeholder shows 『＊＊＊』.
 */
export const MemoryText: React.FC<MemoryTextProps> = ({
    text, nickname, underlineNickname = false, highlight, highlightTone = 'underline', className, as = 'p', 'data-voice': voice,
}) => {
    const { t } = useTranslation();
    const fromContext = useNickname();
    const own = nickname !== undefined ? (nickname.trim() ? nickname : undefined) : fromContext;
    const name = own ?? maskedNickname(t);
    const keyword = highlight?.trim() ? highlight : undefined;
    const Tag = as;
    const body: React.ReactNode[] = [];
    let key = 0;
    for (const part of text.split(PLACEHOLDER_SPLIT)) {
        if (PLACEHOLDER.test(part)) {
            push(body, underlineNickname ? <span key={key++} className={UNDERLINE}>{name}</span> : name);
            continue;
        }
        if (!keyword) {
            push(body, part);
            continue;
        }
        part.split(keyword).forEach((piece, i) => {
            if (i > 0) {
                push(body, highlightTone === 'mark'
                    ? <mark key={key++} data-testid="memory-text-highlight" className={MARK}>{keyword}</mark>
                    : <span key={key++} data-testid="memory-text-highlight" className={UNDERLINE}>{keyword}</span>);
            }
            push(body, piece);
        });
    }
    return (
        <Tag data-testid="memory-text" data-voice={voice} lang="ja" className={cn('whitespace-pre-wrap', className)}>
            {body}
        </Tag>
    );
};
