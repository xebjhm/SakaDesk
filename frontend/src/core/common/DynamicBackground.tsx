// frontend/src/components/ui/DynamicBackground.tsx
// Ambient "Living Air" background with slowly floating color orbs
import React, { useMemo } from 'react';
import { ServiceTheme } from '../../config/serviceThemes';

interface DynamicBackgroundProps {
    theme: ServiceTheme;
    className?: string;
}

export const DynamicBackground: React.FC<DynamicBackgroundProps> = ({ theme, className = '' }) => {
    // Generate unique animation delays for organic movement
    const animationConfig = useMemo(() => ({
        orb1: { delay: 0, duration: 28 },
        orb2: { delay: -8, duration: 34 },
        orb3: { delay: -15, duration: 22 },
    }), []);

    return (
        <div className={`dynamic-bg ${className}`}>
            {/* Orb 1 - Primary atmosphere */}
            <div
                className="dynamic-bg__orb dynamic-bg__orb--1"
                style={{
                    background: theme.ambient.orb1.color,
                    opacity: theme.ambient.orb1.opacity,
                    width: theme.ambient.orb1.size,
                    height: theme.ambient.orb1.size,
                    maxWidth: '850px',
                    maxHeight: '850px',
                    animationDuration: `${animationConfig.orb1.duration}s`,
                    animationDelay: `${animationConfig.orb1.delay}s`,
                }}
            />

            {/* Orb 2 - Secondary accent */}
            <div
                className="dynamic-bg__orb dynamic-bg__orb--2"
                style={{
                    background: theme.ambient.orb2.color,
                    opacity: theme.ambient.orb2.opacity,
                    width: theme.ambient.orb2.size,
                    height: theme.ambient.orb2.size,
                    maxWidth: '750px',
                    maxHeight: '750px',
                    animationDuration: `${animationConfig.orb2.duration}s`,
                    animationDelay: `${animationConfig.orb2.delay}s`,
                }}
            />

            {/* Orb 3 - Subtle tertiary */}
            <div
                className="dynamic-bg__orb dynamic-bg__orb--3"
                style={{
                    background: theme.ambient.orb3.color,
                    opacity: theme.ambient.orb3.opacity,
                    width: theme.ambient.orb3.size,
                    height: theme.ambient.orb3.size,
                    maxWidth: '650px',
                    maxHeight: '650px',
                    animationDuration: `${animationConfig.orb3.duration}s`,
                    animationDelay: `${animationConfig.orb3.delay}s`,
                }}
            />

            {/* Noise texture overlay for organic feel */}
            <div className="dynamic-bg__noise" />

            <style>{`
                /* ========================================
                   DYNAMIC AMBIENT BACKGROUND
                   "Living Air" breathing behind content
                   ======================================== */

                .dynamic-bg {
                    position: absolute;
                    inset: 0;
                    z-index: 0;
                    pointer-events: none;
                    overflow: hidden;
                    background: ${theme.surface.background};
                }

                .dynamic-bg__orb {
                    position: absolute;
                    border-radius: 50%;
                    filter: blur(100px);
                    will-change: transform, opacity;
                    animation-timing-function: ease-in-out;
                    animation-iteration-count: infinite;
                }

                /* Orb 1 - Top left drift */
                .dynamic-bg__orb--1 {
                    top: -18%;
                    left: -12%;
                    animation-name: orb-drift-1;
                }

                /* Orb 2 - Top right pulse */
                .dynamic-bg__orb--2 {
                    top: 18%;
                    right: -15%;
                    animation-name: orb-drift-2;
                }

                /* Orb 3 - Bottom center breathe */
                .dynamic-bg__orb--3 {
                    bottom: -22%;
                    left: 28%;
                    animation-name: orb-breathe;
                }

                /* Subtle noise texture for depth */
                .dynamic-bg__noise {
                    position: absolute;
                    inset: 0;
                    opacity: 0.018;
                    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
                    mix-blend-mode: multiply;
                    pointer-events: none;
                }

                /* ========================================
                   ANIMATIONS - Slow, organic movement
                   ======================================== */

                /* Drift animation - gentle floating */
                @keyframes orb-drift-1 {
                    0%, 100% {
                        transform: translate(0, 0) scale(1);
                    }
                    20% {
                        transform: translate(25px, 15px) scale(1.02);
                    }
                    40% {
                        transform: translate(-10px, 35px) scale(0.98);
                    }
                    60% {
                        transform: translate(35px, -10px) scale(1.03);
                    }
                    80% {
                        transform: translate(-15px, 20px) scale(0.99);
                    }
                }

                @keyframes orb-drift-2 {
                    0%, 100% {
                        transform: translate(0, 0) scale(1);
                    }
                    25% {
                        transform: translate(-30px, 20px) scale(1.04);
                    }
                    50% {
                        transform: translate(20px, -25px) scale(0.97);
                    }
                    75% {
                        transform: translate(-15px, -15px) scale(1.02);
                    }
                }

                /* Breathe animation - pulsing scale */
                @keyframes orb-breathe {
                    0%, 100% {
                        transform: scale(1) translate(0, 0);
                        opacity: var(--orb-opacity, 0.35);
                    }
                    33% {
                        transform: scale(1.08) translate(20px, -15px);
                        opacity: calc(var(--orb-opacity, 0.35) * 1.15);
                    }
                    66% {
                        transform: scale(0.95) translate(-15px, 10px);
                        opacity: calc(var(--orb-opacity, 0.35) * 0.9);
                    }
                }

                /* Reduced motion - respect user preference */
                @media (prefers-reduced-motion: reduce) {
                    .dynamic-bg__orb {
                        animation: none !important;
                    }
                }
            `}</style>
        </div>
    );
};
