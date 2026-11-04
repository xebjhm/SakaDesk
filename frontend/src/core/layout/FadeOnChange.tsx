import React, { useEffect } from 'react';
import { motion as fm, useAnimationControls, useReducedMotion } from 'framer-motion';
import { motion } from '../../design/tokens/motion';

export interface FadeOnChangeProps {
    /** Any change of this value fades the content in again. */
    changeKey: unknown;
    className?: string;
    children: React.ReactNode;
}

/**
 * Fades its children in over `motion.duration.base` whenever `changeKey` changes, without
 * remounting them (feature/service switches keep MessagesFeature's state). No fade with
 * prefers-reduced-motion.
 */
export const FadeOnChange: React.FC<FadeOnChangeProps> = ({ changeKey, className, children }) => {
    const controls = useAnimationControls();
    const reduced = useReducedMotion();
    useEffect(() => {
        if (reduced) {
            controls.set({ opacity: 1 });
            return;
        }
        controls.set({ opacity: 0 });
        void controls.start({
            opacity: 1,
            transition: { duration: motion.duration.base / 1000, ease: [...motion.easing.standard] },
        });
    }, [changeKey, reduced, controls]);
    return <fm.div animate={controls} initial={false} className={className}>{children}</fm.div>;
};
