import React, { useEffect, useState } from 'react';
import { cn } from '../../utils/classnames';
import { clientLog } from '../../utils/clientLog';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE: Record<AvatarSize, string> = {
    sm: 'h-8 w-8 text-small',
    md: 'h-10 w-10 text-body',
    lg: 'h-14 w-14 text-title',
    xl: 'h-20 w-20 text-heading',
};

export interface AvatarProps {
    src?: string;
    /** Used as alt text and for the fallback initial. */
    name: string;
    size?: AvatarSize;
    /** Selected member: white ring + group-colour glow. */
    selected?: boolean;
    /** Hidden from assistive tech (empty alt) when a visible label with the name follows. */
    decorative?: boolean;
    className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({ src, name, size = 'md', selected = false, decorative = false, className }) => {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [src]);

    // Array.from keeps surrogate pairs (emoji) whole.
    const initial = Array.from(name.trim())[0] ?? '?';
    const showImage = Boolean(src) && !failed;

    return (
        <span
            className={cn(
                'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill',
                'bg-sunken font-semibold text-secondary transition-shadow duration-base ease-standard',
                SIZE[size],
                selected && 'ring-2 ring-surface shadow-group-glow',
                className,
            )}
        >
            {showImage ? (
                <img
                    src={src}
                    alt={decorative ? '' : name}
                    draggable={false}
                    className="h-full w-full object-cover"
                    onError={() => {
                        setFailed(true);
                        clientLog('avatar_fallback', { size });
                    }}
                />
            ) : (
                decorative
                    ? <span aria-hidden="true">{initial}</span>
                    : <span role="img" aria-label={name}>{initial}</span>
            )}
        </span>
    );
};
