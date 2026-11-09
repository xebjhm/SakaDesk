# Incoming Call Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the small phone-frame call screen with the approved design: a frameless 9:16 portrait, progressive-blur bands, soft-solid buttons and the group-colour halo. It must scale with the window.

**Architecture:**
- `CallScreen` becomes a size-agnostic presentational card that fills its parent. It is styled by a new plain-CSS file, `callScreen.css`, because the design needs container-query units, `color-mix()`, masked backdrop blur and keyframes.
- `CallOverlay` owns the chat-area layout: blurred ambient backdrop, vignette, a 9:16 frame sized with container units, and the halo. It passes the theme accent through CSS variables.
- `MessagesFeature` supplies the accent, the answer style and the group label from the service theme.

**Tech Stack:** React 18 + TypeScript, plain CSS (imported by the component), lucide-react, i18next; vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-03-incoming-call-design.md`, §2.5 (revised 2026-11-04), §3.3 and §3.4.
**Approved mockup:** `C:\D\saka-verify\mockups\call-glass.html`. This is a local visual reference, not committed (it embeds member photos). The CSS below is the mockup's final CSS, adapted.

## Global Constraints

### Feel and layout
- It must feel like a real call. Nothing may hint at a recording: no voice length, no progress bar, no "voice message" label.
- Uniform **9:16** portrait. `object-fit: cover`, `object-position: center 30%`.
- Frame width = `min((100cqh − 2·padY) × 9/16, 100cqw − 32px, 1200px × 9/16)`, with `padY = clamp(12px, 3.2cqh, 40px)` and radius `--sd-rad = clamp(16px, 2.6cqh, 34px)`.

### Colour
- **Accent:**
  - solid services (`theme.messages.headerStyle === 'gradient'`): `theme.modals.accentColor`;
  - light services (`headerStyle === 'light'`, i.e. 櫻坂): `theme.messages.bubbleBorder`.
- **Answer style:** `'light'` when `headerStyle === 'light'`, otherwise `'solid'`.
- **Decline and hang-up** are the same soft red for everyone: `linear-gradient(180deg, #ef6a70, #dc4b5a)`.
- **Answer** is the only button with the group style:
  - solid: an accent gradient;
  - light: a white fill, a 1.5 px accent inner ring and an accent icon.

### States
- **Ringing:** a bottom progressive-blur band holding an eyebrow (accent dot + group label), the name (bold, two-layer shadow), `call.incoming`, and the decline and answer buttons with visible labels.
  - Portrait 400 px or wider: a row layout. Narrower: stacked. Below 230 px: button labels hidden.
- **Connected:** a top band with the name, a live dot and an `m:ss` timer. A single hang-up button sits in a bottom dock.
- **Ended:** the photo is dimmed (brightness .72, saturate .92, blur 1.5px, scale 1.02) and **never greyscale**. A glass pill shows `call.ended` and the talk time.

### Motion and behaviour
- **Animations:** only the halo breathing (2.4 s, ringing) and the answer-button ripples (1.8 s). Both stop under `prefers-reduced-motion`.
- **Unchanged behaviour:** keys, focus, the live region, audio, logging and the state machine all stay as they are. This plan changes presentation and the props that carry theme data only.

### Project rules
- **Tooling:**
  - uv only.
  - Frontend commands run in `frontend/`: `npx vitest run`, `npx tsc --noEmit`, `npm run lint`. Lint must exit 0 with no more than 20 warnings.
- **Strings:** no hardcoded user-facing strings; use `t()`. The group label is the service display name and is deliberately not translated.
- **Commits:**
  - `uv run git commit -F <mktemp file in scratchpad>`.
  - Conventional Commits, subject 72 characters or fewer.
  - Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Don't push.

---

## File Structure

| file | status | responsibility |
|------|--------|----------------|
| `frontend/src/features/incomingCall/callScreen.css` | create | all call-screen and overlay styles (`sd-call-*`) |
| `frontend/src/features/incomingCall/CallScreen.tsx` | rewrite | presentational card: ringing, connected and ended |
| `frontend/src/features/incomingCall/CallScreen.test.tsx` | rewrite | card behaviour tests |
| `frontend/src/features/incomingCall/CallOverlay.tsx` | modify | chat-area layout, halo and theme variables |
| `frontend/src/features/incomingCall/CallOverlay.test.tsx` | modify | pass the new props; layout/theme assertions |
| `frontend/src/features/incomingCall/incomingCall.integration.test.tsx` | modify | pass the new props |
| `frontend/src/features/messages/MessagesFeature.tsx` | modify | supply accent, answer style and group label |

---

### Task 1: The new `CallScreen` card and its stylesheet

**Files:**
- Create: `frontend/src/features/incomingCall/callScreen.css`
- Rewrite: `frontend/src/features/incomingCall/CallScreen.tsx`
- Rewrite: `frontend/src/features/incomingCall/CallScreen.test.tsx`

**Interfaces:**
- Produces:
  - `export type AnswerStyle = 'solid' | 'light'`;
  - `CallScreen` with props `{ phase: Exclude<CallPhase,'idle'>; name: string; groupLabel: string; photoUrl: string; talkSeconds: number; answerStyle: AnswerStyle; onAnswer(): void; onDecline(): void; onHangUp(): void }`.
  - The root element is `.sd-call-screen`, with `data-phase` and `data-answer-style` attributes. It fills its parent and reads the CSS variables `--sd-accent` and `--sd-rad` from an ancestor.
- Consumes: `formatTalkTime` from `./formatTalkTime`; `CallPhase` from `./useIncomingCall`; the i18n keys `call.incoming`, `call.ended`, `call.answer`, `call.decline` and `call.hangUp`.

Until Task 2 lands, `CallOverlay` still renders `<CallScreen>` without the two new props, so `tsc` would fail. In this task, also make the minimal change to `CallOverlay.tsx`: pass `groupLabel=""` and `answerStyle="solid"`. Task 2 replaces that.

- [ ] **Step 1: Write the failing tests.** Replace `CallScreen.test.tsx` with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CallScreen } from './CallScreen';
import { formatTalkTime } from './formatTalkTime';

const base = {
    name: '金村 美玖', groupLabel: '日向坂46', photoUrl: '/img/phone.jpg', talkSeconds: 0,
    answerStyle: 'solid' as const,
    onAnswer: vi.fn(), onDecline: vi.fn(), onHangUp: vi.fn(),
};

describe('CallScreen', () => {
    it('fills its parent and exposes phase and answer style for styling', () => {
        const { container } = render(<CallScreen {...base} phase="ringing" answerStyle="light" />);
        const root = container.firstElementChild as HTMLElement;
        expect(root).toHaveClass('sd-call-screen');
        expect(root).toHaveAttribute('data-phase', 'ringing');
        expect(root).toHaveAttribute('data-answer-style', 'light');
        expect(root.querySelector('img')).toHaveAttribute('src', '/img/phone.jpg');
    });

    it('ringing shows the group, the name, the incoming text and labelled answer/decline', () => {
        render(<CallScreen {...base} phase="ringing" />);
        expect(screen.getByText('日向坂46')).toBeInTheDocument();
        expect(screen.getByText('金村 美玖')).toBeInTheDocument();
        expect(screen.getByText('Incoming call…')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
        fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
        expect(base.onAnswer).toHaveBeenCalledTimes(1);
        expect(base.onDecline).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Hang up' })).toBeNull();
    });

    it('decline and hang-up share the same button style; answer has its own', () => {
        const { rerender } = render(<CallScreen {...base} phase="ringing" />);
        expect(screen.getByRole('button', { name: 'Decline' })).toHaveClass('sd-call-btn--decline');
        expect(screen.getByRole('button', { name: 'Answer' })).toHaveClass('sd-call-btn--answer');
        rerender(<CallScreen {...base} phase="connected" />);
        expect(screen.getByRole('button', { name: 'Hang up' })).toHaveClass('sd-call-btn--decline');
    });

    it('connected shows the name, the timer and only a hang-up button', () => {
        render(<CallScreen {...base} phase="connected" talkSeconds={75} />);
        expect(screen.getByText('金村 美玖')).toBeInTheDocument();
        expect(screen.getByText('1:15')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Hang up' }));
        expect(base.onHangUp).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    });

    it('ended shows the ended text with the talk time and no buttons', () => {
        render(<CallScreen {...base} phase="ended" talkSeconds={31} />);
        expect(screen.getByText('Call ended')).toBeInTheDocument();
        expect(screen.getByText('0:31')).toBeInTheDocument();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('never shows recording cues (no progress bar, no duration while ringing)', () => {
        render(<CallScreen {...base} phase="ringing" talkSeconds={136} />);
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.queryByText('2:16')).toBeNull();
    });

    it('formats talk time as m:ss', () => {
        expect(formatTalkTime(0)).toBe('0:00');
        expect(formatTalkTime(9)).toBe('0:09');
        expect(formatTalkTime(600)).toBe('10:00');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `frontend/`): `npx vitest run src/features/incomingCall/CallScreen.test.tsx`
Expected: FAIL. There is no `sd-call-screen` class and no group label yet.

- [ ] **Step 3: Create** `callScreen.css`:

```css
/* Incoming-call screen (spec §2.5). Plain CSS rather than Tailwind because the design relies
   on container-query units, color-mix(), masked backdrop blur and keyframes. Every class is
   prefixed `sd-call-`. Colours come from --sd-accent (set by the host); --sd-rad is the
   corner radius chosen by the host's frame. */

/* ---------- Chat-area overlay (CallOverlay) ---------- */
.sd-call-ambient {
  position: absolute; inset: -8%;
  background-size: cover; background-position: center 30%;
  filter: blur(64px) saturate(1.35) brightness(.9);
  transform: scale(1.1);
}
.sd-call-vignette {
  position: absolute; inset: 0;
  background: radial-gradient(120% 90% at 50% 40%, rgba(8,10,18,.05) 0%, rgba(8,10,18,.45) 70%, rgba(8,10,18,.7) 100%);
}
.sd-call-stage {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  container-type: size;
}
.sd-call-frame {
  --sd-r: 0.5625; /* 9 / 16 */
  --sd-pad-y: clamp(12px, 3.2cqh, 40px);
  --sd-rad: clamp(16px, 2.6cqh, 34px);
  position: relative;
  aspect-ratio: 9 / 16;
  width: min(calc((100cqh - 2 * var(--sd-pad-y)) * var(--sd-r)), calc(100cqw - 32px), calc(1200px * var(--sd-r)));
}
.sd-call-halo { position: absolute; inset: 0; border-radius: var(--sd-rad); pointer-events: none; }
.sd-call-halo[data-phase="ringing"] {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--sd-accent) 75%, white),
              0 0 60px 8px color-mix(in srgb, var(--sd-accent) 55%, transparent);
  animation: sd-call-breathe 2.4s ease-in-out infinite;
}
.sd-call-halo[data-phase="connected"] { box-shadow: 0 0 0 1px color-mix(in srgb, var(--sd-accent) 45%, transparent); }
@keyframes sd-call-breathe { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }

/* ---------- The card (CallScreen; also reused by C's popup) ---------- */
.sd-call-screen {
  --sd-accent-deep: color-mix(in srgb, var(--sd-accent, #7cc7e8) 70%, #0b1a33);
  position: relative; width: 100%; height: 100%;
  overflow: hidden; border-radius: var(--sd-rad, 24px);
  container-type: inline-size;
  color: rgba(255,255,255,.96);
  box-shadow: 0 30px 80px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.12);
}
.sd-call-photo {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; object-position: center 30%;
  transition: filter .6s ease, transform .6s ease;
}
.sd-call-screen[data-phase="ended"] .sd-call-photo { filter: brightness(.72) saturate(.92) blur(1.5px); transform: scale(1.02); }

/* Progressive-blur bands, like the premium voice player */
.sd-call-band { position: absolute; left: 0; right: 0; pointer-events: none; }
.sd-call-band > .sd-call-band-blur { position: absolute; inset: 0; backdrop-filter: blur(22px) saturate(150%); -webkit-backdrop-filter: blur(22px) saturate(150%); }
.sd-call-band > .sd-call-band-tint { position: absolute; inset: 0; }
.sd-call-band--bottom { bottom: 0; height: 30%; }
.sd-call-band--bottom > .sd-call-band-blur { -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 62%); mask-image: linear-gradient(to bottom, transparent 0%, black 62%); }
.sd-call-band--bottom > .sd-call-band-tint { background: linear-gradient(to bottom, rgba(8,10,18,0) 0%, rgba(8,10,18,.45) 50%, rgba(8,10,18,.72) 100%); }
.sd-call-band--top { top: 0; height: 22%; }
.sd-call-band--top > .sd-call-band-blur { -webkit-mask-image: linear-gradient(to top, transparent 0%, black 60%); mask-image: linear-gradient(to top, transparent 0%, black 60%); }
.sd-call-band--top > .sd-call-band-tint { background: linear-gradient(to top, rgba(8,10,18,0), rgba(8,10,18,.5)); }
.sd-call-shade-bottom { position: absolute; left: 0; right: 0; bottom: 0; height: 24%; pointer-events: none; background: linear-gradient(to top, rgba(6,8,14,.72), rgba(6,8,14,.25) 55%, transparent); }

/* Text */
.sd-call-eyebrow {
  display: flex; align-items: center; gap: 7px;
  margin-bottom: clamp(2px, 1.2cqw, 6px);
  font-size: clamp(10px, 2.8cqw, 12.5px); font-weight: 600; letter-spacing: .16em;
  color: rgba(255,255,255,.86); text-shadow: 0 1px 2px rgba(0,0,0,.6);
}
.sd-call-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--sd-accent); box-shadow: 0 0 8px var(--sd-accent); }
.sd-call-name {
  font-size: clamp(15px, 7cqw, 30px); font-weight: 700; letter-spacing: .04em; line-height: 1.25;
  overflow-wrap: anywhere;
  text-shadow: 0 1px 2px rgba(0,0,0,.55), 0 0 22px rgba(0,0,0,.45);
}
.sd-call-status {
  margin-top: clamp(2px, 1.4cqw, 6px);
  font-size: clamp(11px, 3.2cqw, 13.5px); letter-spacing: .12em;
  color: rgba(255,255,255,.72); text-shadow: 0 1px 2px rgba(0,0,0,.6);
}

/* Ringing layout: row when the card is wide enough, stacked when narrow */
.sd-call-ring {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 0 clamp(12px, 5.5cqw, 28px) clamp(12px, 5.5cqw, 26px);
  display: flex; align-items: flex-end; justify-content: space-between; gap: 16px;
}
.sd-call-who { min-width: 0; }
.sd-call-actions { display: flex; justify-content: center; gap: clamp(20px, 15cqw, 64px); }
@container (max-width: 400px) {
  .sd-call-ring { flex-direction: column; align-items: center; text-align: center; gap: clamp(10px, 4cqw, 16px); }
  .sd-call-eyebrow { justify-content: center; }
}
.sd-call-act {
  display: flex; flex-direction: column; align-items: center; gap: clamp(4px, 1.9cqw, 8px);
  font-size: clamp(10px, 2.9cqw, 12px); letter-spacing: .1em;
  color: rgba(255,255,255,.72); text-shadow: 0 1px 2px rgba(0,0,0,.6);
}
@container (max-width: 230px) { .sd-call-act-label { display: none; } }

/* Buttons ("soft solid") */
.sd-call-btn {
  position: relative; display: grid; place-items: center;
  width: clamp(48px, 16cqw, 72px); height: clamp(48px, 16cqw, 72px);
  border: 0; border-radius: 50%; color: #fff; cursor: pointer;
  box-shadow: 0 6px 18px rgba(0,0,0,.28), inset 0 0 0 1px rgba(255,255,255,.22);
  transition: transform .15s ease;
}
.sd-call-btn::after { content: ""; position: absolute; inset: 0; border-radius: 50%; pointer-events: none; background: linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,0) 50%); }
.sd-call-btn:hover { transform: scale(1.05); }
.sd-call-btn:active { transform: scale(.96); }
.sd-call-btn:focus-visible { outline: 2px solid #fff; outline-offset: 4px; }
.sd-call-btn svg { position: relative; z-index: 1; width: 42%; height: 42%; }
/* Decline and hang-up: the same soft red for every group */
.sd-call-btn--decline { background: linear-gradient(180deg, #ef6a70, #dc4b5a); }
.sd-call-btn--decline svg { transform: rotate(135deg); }
/* Answer: the only button carrying the group style */
.sd-call-btn--answer { background: linear-gradient(180deg, color-mix(in srgb, var(--sd-accent) 80%, white), color-mix(in srgb, var(--sd-accent-deep) 85%, var(--sd-accent))); }
.sd-call-screen[data-answer-style="light"] .sd-call-btn--answer {
  background: rgba(255,255,255,.95); color: var(--sd-accent);
  box-shadow: 0 6px 18px rgba(0,0,0,.22), inset 0 0 0 1.5px var(--sd-accent);
}
.sd-call-screen[data-answer-style="light"] .sd-call-btn--answer::after { background: linear-gradient(180deg, rgba(255,255,255,.6), rgba(255,255,255,0) 50%); }
.sd-call-ripple {
  position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  border: 1.5px solid color-mix(in srgb, var(--sd-accent) 80%, white);
  animation: sd-call-ripple 1.8s ease-out infinite;
}
.sd-call-ripple--late { animation-delay: .9s; }
@keyframes sd-call-ripple { from { transform: scale(1); opacity: .5; } to { transform: scale(1.75); opacity: 0; } }

/* Connected */
.sd-call-talk {
  position: absolute; left: 0; right: 0; top: 0;
  padding: clamp(14px, 5cqw, 26px) clamp(14px, 5.5cqw, 28px);
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.sd-call-talk .sd-call-name { font-size: clamp(15px, 5.6cqw, 24px); }
.sd-call-timer {
  display: flex; align-items: center; gap: 8px; flex: none;
  font-size: clamp(12px, 3.6cqw, 15px); font-weight: 500; letter-spacing: .04em; font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 2px rgba(0,0,0,.6);
}
.sd-call-live { width: 7px; height: 7px; border-radius: 50%; background: #5ee08a; box-shadow: 0 0 8px #5ee08a; }
.sd-call-dock { position: absolute; left: 50%; bottom: clamp(12px, 6.7cqw, 28px); transform: translateX(-50%); }

/* Ended */
.sd-call-endcard {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  padding: clamp(10px, 4.3cqw, 18px) clamp(16px, 7cqw, 30px);
  border-radius: calc(var(--sd-rad, 24px) - 10px);
  text-align: center; white-space: nowrap;
  background: rgba(22,24,34,.30);
  backdrop-filter: blur(26px) saturate(170%); -webkit-backdrop-filter: blur(26px) saturate(170%);
  border: 1px solid rgba(255,255,255,.30);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.35), 0 10px 30px rgba(0,0,0,.25);
}
.sd-call-endcard::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: linear-gradient(180deg, rgba(255,255,255,.26) 0%, rgba(255,255,255,.06) 42%, rgba(255,255,255,.02) 100%); }
.sd-call-endcard-title { position: relative; font-size: clamp(14px, 4.3cqw, 18px); font-weight: 600; letter-spacing: .14em; }
.sd-call-endcard-time { position: relative; margin-top: 4px; font-size: clamp(12px, 3.4cqw, 13px); color: rgba(255,255,255,.72); font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  .sd-call-halo { animation: none; }
  .sd-call-ripple { animation: none; display: none; }
}
```

- [ ] **Step 4: Rewrite** `CallScreen.tsx`:

```tsx
import React from 'react';
import { Phone } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { formatTalkTime } from './formatTalkTime';
import type { CallPhase } from './useIncomingCall';
import './callScreen.css';

/** How the answer button carries the group colour: a filled gradient, or white with an accent ring. */
export type AnswerStyle = 'solid' | 'light';

interface CallScreenProps {
    phase: Exclude<CallPhase, 'idle'>;
    name: string;
    /** Service display name (e.g. 日向坂46); not translated. */
    groupLabel: string;
    photoUrl: string;
    /** Connected: the live talk time. Ended: the final talk time. */
    talkSeconds: number;
    answerStyle: AnswerStyle;
    onAnswer: () => void;
    onDecline: () => void;
    onHangUp: () => void;
}

const PhoneIcon = () => <Phone aria-hidden fill="currentColor" strokeWidth={1.5} />;

/**
 * The call card. Fills its parent; the host sets the size and the CSS variables
 * --sd-accent and --sd-rad. Presentational only; reused by the bottom-right popup (sub-project C).
 */
export const CallScreen: React.FC<CallScreenProps> = ({
    phase, name, groupLabel, photoUrl, talkSeconds, answerStyle, onAnswer, onDecline, onHangUp,
}) => {
    const { t } = useTranslation();
    return (
        <div className="sd-call-screen" data-phase={phase} data-answer-style={answerStyle}>
            <img className="sd-call-photo" src={photoUrl} alt="" />

            {phase === 'ringing' && (
                <>
                    <div className="sd-call-band sd-call-band--bottom" aria-hidden>
                        <div className="sd-call-band-blur" />
                        <div className="sd-call-band-tint" />
                    </div>
                    <div className="sd-call-ring">
                        <div className="sd-call-who">
                            <div className="sd-call-eyebrow"><span className="sd-call-dot" aria-hidden />{groupLabel}</div>
                            <div className="sd-call-name">{name}</div>
                            <div className="sd-call-status">{t('call.incoming')}</div>
                        </div>
                        <div className="sd-call-actions">
                            <div className="sd-call-act">
                                <button type="button" className="sd-call-btn sd-call-btn--decline" aria-label={t('call.decline')} onClick={onDecline}>
                                    <PhoneIcon />
                                </button>
                                <span className="sd-call-act-label" aria-hidden>{t('call.decline')}</span>
                            </div>
                            <div className="sd-call-act">
                                <button type="button" className="sd-call-btn sd-call-btn--answer" aria-label={t('call.answer')} onClick={onAnswer}>
                                    <span className="sd-call-ripple" aria-hidden />
                                    <span className="sd-call-ripple sd-call-ripple--late" aria-hidden />
                                    <PhoneIcon />
                                </button>
                                <span className="sd-call-act-label" aria-hidden>{t('call.answer')}</span>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {phase === 'connected' && (
                <>
                    <div className="sd-call-band sd-call-band--top" aria-hidden>
                        <div className="sd-call-band-blur" />
                        <div className="sd-call-band-tint" />
                    </div>
                    <div className="sd-call-shade-bottom" aria-hidden />
                    <div className="sd-call-talk">
                        <div className="sd-call-name">{name}</div>
                        <div className="sd-call-timer"><span className="sd-call-live" aria-hidden />{formatTalkTime(talkSeconds)}</div>
                    </div>
                    <div className="sd-call-dock">
                        <div className="sd-call-act">
                            <button type="button" className="sd-call-btn sd-call-btn--decline" aria-label={t('call.hangUp')} onClick={onHangUp}>
                                <PhoneIcon />
                            </button>
                            <span className="sd-call-act-label" aria-hidden>{t('call.hangUp')}</span>
                        </div>
                    </div>
                </>
            )}

            {phase === 'ended' && (
                <div className="sd-call-endcard">
                    <div className="sd-call-endcard-title">{t('call.ended')}</div>
                    <div className="sd-call-endcard-time">{formatTalkTime(talkSeconds)}</div>
                </div>
            )}
        </div>
    );
};
```

In `CallOverlay.tsx`, add `groupLabel=""` and `answerStyle="solid"` to the existing `<CallScreen …/>` call. This is temporary; Task 2 replaces it.

- [ ] **Step 5: Run the tests and checks**

Run (in `frontend/`): `npx vitest run src/features/incomingCall/ && npx tsc --noEmit && npm run lint`
Expected:
- all incomingCall tests pass (CallOverlay and integration tests still pass, since they only use roles and test ids);
- tsc is clean;
- lint exits 0 with 20 or fewer warnings.

If the jsdom CSS import errors, vitest needs no config change: Vite resolves `.css` imports in tests to an empty module by default. Report the error instead of working around it.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/incomingCall/callScreen.css frontend/src/features/incomingCall/CallScreen.tsx frontend/src/features/incomingCall/CallScreen.test.tsx frontend/src/features/incomingCall/CallOverlay.tsx
uv run git commit -F <msg>   # feat(call): redesign the call card with glass bands and soft buttons
```

---

### Task 2: Chat-area layout, halo and theme wiring

**Files:**
- Modify: `frontend/src/features/incomingCall/CallOverlay.tsx` (the overlay JSX and props)
- Modify: `frontend/src/features/incomingCall/CallOverlay.test.tsx`, `frontend/src/features/incomingCall/incomingCall.integration.test.tsx` (pass the new props)
- Modify: `frontend/src/features/messages/MessagesFeature.tsx`:
  - the import from `../../data/services`;
  - the `<CallOverlay call={incomingCall} />` line (about line 837).

**Interfaces:**
- Consumes: `CallScreen` and `AnswerStyle` (Task 1); the `.sd-call-ambient`, `.sd-call-vignette`, `.sd-call-stage`, `.sd-call-frame` and `.sd-call-halo` classes (Task 1 CSS).
- Produces: `CallOverlay` props `{ call: IncomingCall; accentColor: string; answerStyle: AnswerStyle; groupLabel: string }`.

- [ ] **Step 1: Write the failing tests.** In `CallOverlay.test.tsx`:
  - make every `render(<CallOverlay call={…} />)` pass `accentColor="#7cc7e8" answerStyle="solid" groupLabel="日向坂46"` (keep all existing assertions);
  - add these tests:

```tsx
    it('lays out ambient backdrop, a 9:16 frame and a halo that follows the phase', () => {
        const { container, rerender } = render(
            <CallOverlay call={call()} accentColor="#E85298" answerStyle="light" groupLabel="櫻坂46" />,
        );
        const overlay = screen.getByTestId('call-overlay');
        expect(overlay.style.getPropertyValue('--sd-accent')).toBe('#E85298');
        expect(container.querySelector('.sd-call-ambient')).toHaveStyle({ backgroundImage: 'url("/img/phone.jpg")' });
        expect(container.querySelector('.sd-call-stage .sd-call-frame .sd-call-screen')).not.toBeNull();
        expect(container.querySelector('.sd-call-halo')).toHaveAttribute('data-phase', 'ringing');
        expect(container.querySelector('.sd-call-screen')).toHaveAttribute('data-answer-style', 'light');
        expect(screen.getByText('櫻坂46')).toBeInTheDocument();
        rerender(<CallOverlay call={call({ phase: 'connected', talkStartedAt: Date.now() })} accentColor="#E85298" answerStyle="light" groupLabel="櫻坂46" />);
        expect(container.querySelector('.sd-call-halo')).toHaveAttribute('data-phase', 'connected');
    });

    it('shows the final talk time on the ended screen', () => {
        vi.useFakeTimers();
        try {
            const start = Date.now();
            const { rerender } = render(<CallOverlay call={call({ phase: 'connected', talkStartedAt: start })} accentColor="#7cc7e8" answerStyle="solid" groupLabel="日向坂46" />);
            act(() => { vi.advanceTimersByTime(31_000); });
            rerender(<CallOverlay call={call({ phase: 'ended', talkStartedAt: start })} accentColor="#7cc7e8" answerStyle="solid" groupLabel="日向坂46" />);
            expect(screen.getByText('0:31')).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });
```

  Import `act` from `@testing-library/react` if the file doesn't already. Adjust the `call()` helper's `photoUrl` to `/img/phone.jpg` if it differs.

  In `incomingCall.integration.test.tsx`, pass `accentColor="#7cc7e8" answerStyle="solid" groupLabel="日向坂46"` to `<CallOverlay>`.

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `frontend/`): `npx vitest run src/features/incomingCall/CallOverlay.test.tsx`
Expected: FAIL. There are no new props, no `.sd-call-ambient` and no halo yet.

- [ ] **Step 3: Implement the `CallOverlay` layout**
  - Change the component signature to:

```tsx
import type { AnswerStyle } from './CallScreen';

interface CallOverlayProps {
    call: IncomingCall;
    /** Group colour for the halo, the eyebrow dot and the answer button. */
    accentColor: string;
    answerStyle: AnswerStyle;
    /** Service display name shown above the member's name. */
    groupLabel: string;
}

/** Covers the chat area while a call is active; hosts the call audio and handles Esc/Enter. */
export const CallOverlay: React.FC<CallOverlayProps> = ({ call, accentColor, answerStyle, groupLabel }) => {
```

  - Keep every hook, the focus logic, the key handler, the live region and `talkSeconds` exactly as they are.
  - Replace the returned overlay `<div …>…</div>` (the part after `{liveRegion}`) with:

```tsx
        <div
            ref={overlayRef}
            role="dialog"
            aria-label={call.name}
            tabIndex={-1}
            className="absolute inset-0 z-30 overflow-hidden outline-none"
            style={{ '--sd-accent': accentColor } as React.CSSProperties}
            data-testid="call-overlay"
        >
            <div aria-hidden className="sd-call-ambient" style={{ backgroundImage: `url("${call.photoUrl}")` }} />
            <div aria-hidden className="sd-call-vignette" />
            <div className="sd-call-stage">
                <div className="sd-call-frame">
                    <div aria-hidden className="sd-call-halo" data-phase={phase} />
                    <CallScreen
                        phase={phase}
                        name={call.name}
                        groupLabel={groupLabel}
                        photoUrl={call.photoUrl}
                        talkSeconds={talkSeconds}
                        answerStyle={answerStyle}
                        onAnswer={answer}
                        onDecline={decline}
                        onHangUp={hangUp}
                    />
                </div>
            </div>
            <CallAudio
                key={call.message.id}
                phase={phase}
                audioUrl={call.audioUrl}
                onPlaybackEnded={call.onPlaybackEnded}
                onPlaybackError={call.onPlaybackError}
            />
        </div>
```

  - **Talk timer on the ended screen.** The talk timer interval only runs while connected. On entering `ended`, the last `now` value (at most 250 ms old) is kept, so the ended pill shows the final talk time. Do not add another timer.

- [ ] **Step 4: Wire the theme in `MessagesFeature.tsx`**
  - Add `getServiceDisplayName` to the existing `import { getServiceIdFromDisplayName } from '../../data/services';`.
  - Replace `<CallOverlay call={incomingCall} />` with:

```tsx
                    <CallOverlay
                        call={incomingCall}
                        // Light-style services (櫻坂) use their bubble-edge pink and a white answer button.
                        accentColor={theme.messages.headerStyle === 'light' ? theme.messages.bubbleBorder : theme.modals.accentColor}
                        answerStyle={theme.messages.headerStyle === 'light' ? 'light' : 'solid'}
                        groupLabel={messagesService ? getServiceDisplayName(messagesService) : ''}
                    />
```

- [ ] **Step 5: Run the tests and checks**

Run (in `frontend/`): `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all tests pass; tsc is clean; lint exits 0 with 20 or fewer warnings.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/incomingCall/CallOverlay.tsx frontend/src/features/incomingCall/CallOverlay.test.tsx frontend/src/features/incomingCall/incomingCall.integration.test.tsx frontend/src/features/messages/MessagesFeature.tsx
uv run git commit -F <msg>   # feat(call): size the call to the chat area with a group halo
```

---

### Task 3: Windows visual check (controller)

Use the `C:\D\saka-verify` copy. Launch the dev exe with `Start-Process … -WorkingDirectory <exe dir>`, with `SAKADESK_DATA_DIR` set to the copy and CDP on port 9222.

- [ ] **Ringing:** open a 1:1 chat with an unheard voice. Check the 9:16 portrait, the halo breathing, the eyebrow, the legible name and the row layout. Screenshot it.
- [ ] **Window sizes:** resize the window to short, narrow and small, and confirm nothing clips (CDP screenshots). Check that the buttons stay at least 48 px.
- [ ] **Connected and ended:** answer and confirm the top band and the timer. Hang up and confirm the ended pill shows the talk time and the photo is dimmed, not grey.
- [ ] **櫻坂:** the answer button is white with a pink ring; decline is the same soft red as the other groups.
- [ ] **Behaviour:** everything from the earlier Task 7 still works (Esc/Enter, focus, switch-cancel, logs).
- [ ] **Restore** the live app.
