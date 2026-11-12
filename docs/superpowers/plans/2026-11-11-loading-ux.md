# Loading UX (0.5.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every wait in SakaDesk must look like loading. A blank area, or a control that seems to ignore the click, is never acceptable (user, 2026-11-11). This wave ships the 11 "must for 0.5.0" items of the app-wide audit (`.superpowers/sdd/ux-loading-audit.md`, section 5):
1. the loading primitives and timing tokens (F38, F39);
2. Memories `LoadState` rebuilt on `StatusBlock`, with separate timeout copy (F22, F23);
3. the hub's "still gathering" line and slow first-run copy (F27);
4. the album month-band tile skeleton (F28);
5. no blank chat timeline: room switch, letters gate, chat skeleton, error Retry (F1–F4);
6. login: Cancel and Close stay usable while connecting (F17);
7. `keepPrevious` for in-view steps, plus `MemberPane` loading and error (F24, F25);
8. the sync panel's indeterminate state while `total = 0` (F16);
9. reduced motion for the 8 spinners that ignore it (F11, F20, F39);
10. chat bubble photo pulse and fade (F5);
11. the share dialog: preview skeleton, and export gated on its photos (F32).

It also replaces the ad-hoc status components (`LoadState`, `DialogStatus`, `BlogStatus`, and the recap `Status`) with one `StatusBlock`.

**Not in this plan** (the media pipeline plan `docs/superpowers/plans/2026-11-11-media-pipeline.md` owns them, so do not duplicate):
- **F14** (blog photo gallery) is covered by media **M7**. L7 only swaps that file's state components onto `StatusBlock`, and adds an error state with Retry if M7 did not add one.
- **F26** (`MemoryThumb` pictures, album tiles) is covered by media **M5 + M8**.
- **F40** (message, blog and album media galleries) is covered by media **M5–M8**.

The media plan numbers its tasks M1–M9 (the brief that ordered this plan calls them P1–P9).

**Architecture:**
- **One primitive set** in `frontend/src/design/` (Task L1):
  - timing tokens `motion.loading`;
  - the hooks `useLoadingStages`, `useDelayedLoading` and `useKeepPrevious`, plus the pure `settleDelay`;
  - the primitives `Spinner`, `Skeleton`, `StatusBlock`, `ProgressBar` and `BusyContent`.

  Every later task, and media M5's `MediaTile`, builds its loading state from them.
- **One query contract for Memories** (Task L3). `useMemoriesQuery` reports *why* it failed (`failure: 'timeout' | 'error'`). It can keep the previous payload while it loads the next step (`keepPrevious`), says when its quiet re-polling is active (`polling`), and holds a result back so a shown indicator stays at least 400 ms.
- **One wait breadcrumb.** The client event `ui_wait` (`surface`, `phase`, `wait_ms`) is logged once when a wait turns slow, very slow, timed out or cancelled. Ids and codes only.
- **One guard.** A loading ratchet in `design/guard.ts` counts raw `animate-spin` and bare `{t('common.loading')}` text outside `design/primitives/`. It ends this wave at an empty baseline, so any new hand-built spinner fails the build.

**Tech Stack:** React 18 + TS, Tailwind (tokens via `design/cssVars.ts`), lucide-react (`Loader2`), vitest + Testing Library (fake timers); FastAPI + pytest for the one backend change (login cancel). **No new dependencies.**

## Global Constraints

- **Loading feedback rules (user, 2026-11-11; binding for every task):**
  - **Tokens only.** Use design-system tokens and primitives (`design/guard.test.ts`): no hex, rgb or hsl literals, no arbitrary radius, shadow, text or spacing values, and no named palette classes. Read `docs/design/DESIGN_SYSTEM.md` before any UI task.
  - **No flash on fast loads.** Nothing new appears for the first 200 ms (`motion.loading.reveal`). The previous content stays. Exceptions: a button's pressed state and an optimistic change apply at once. Once an indicator is shown, it stays at least 400 ms (`motion.loading.minVisible`).
  - **At 3 s** (`slow`), add one line of specific "still working" copy (`text-small text-secondary`).
  - **At 10 s** (`verySlow`), explain why, and show **Cancel** or **progress**. Progress means a determinate `ProgressBar`, or an indeterminate one next to the explanation; decision **D-L1** covers waits that cannot be cancelled.
  - **Timeouts** always show Retry, with copy that differs from a failure (`kind="timeout"` vs `kind="error"`). An endless spinner is never allowed.
  - **Reduced motion is respected.** Under `prefers-reduced-motion` nothing spins, pulses, sweeps or fades. A spinner becomes a static glyph **with a visible label**, never an icon alone. The only exception is `labelVisibility="compact"` inside media tiles and bubbles under 160 px, where the label stays in the accessibility tree.
  - **i18n:** every user-facing string is a key in all 5 locales (`frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json`). Japanese is the reference copy, given per task. `frontend/src/i18n/loadingUx.test.ts` (Task L1) holds `LOADING_UX_KEYS`, and every task appends its keys.
  - **Logs carry ids, codes and counts only.** Never log message text, names, paths, URLs, titles or `err.message`. `ui_wait` fields are `surface` (a code), `phase` (a code) and `wait_ms` (a number). Every decision, skip, timeout and cancel path leaves a breadcrumb (memory `log-every-decision-path`).
  - **Behaviour-preserving migration.** When a status component moves onto `StatusBlock`, the only allowed changes are the better feedback:
    - the reveal delay;
    - slow and very-slow copy;
    - timeout copy;
    - Retry on every error;
    - a static, labelled spinner under reduced motion.

    Text, roles (`status` / `alert`), retry handlers, layout heights and test ids otherwise stay the same. An existing test that asserted an indicator at 0 ms is updated to advance 200 ms, and the commit message says so.
- **Interleaving with the media plan:** see "Execution order" below. Never run two tasks at once that touch the same file. Locale JSON files are shared by every task, so tasks are interleaved as sequential commits, not run concurrently.
- **Binding project rules:**
  - Other agents commit on `feat/memories`. Before each commit, run `git pull --rebase` if the remote moved, and stage only this task's files by name (never `git add -A`).
  - Use `uv run`, never pip. Commit with `uv run git commit` (pre-commit is only on the uv PATH). Commits follow Conventional Commits with a subject of at most 72 chars, imperative, no trailing period, and end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `docs/DOC_FORMATS.md` is enforced by a hook.
  - Backend: file I/O is `utf-8` with `pathlib`; no `print()`; log through `structlog.get_logger(__name__)`; never `time.sleep` in async code.
  - Frontend timing tests use `vi.useFakeTimers()` and `act(() => vi.advanceTimersByTime(...))`. They assert each stage boundary: 199 ms (nothing), 200 ms (indicator), 2,999 / 3,000 ms (slow copy), 9,999 / 10,000 ms (very-slow copy plus Cancel or progress).
  - Strings include non-ASCII (CJK, emoji) in at least one test per task.
- **WSL safety:** never run `find /` or any recursive search or scan that starts at `/` or under `/mnt/<drive>` (find, `grep -r`, rg, fd, du, `ls -R`, tree, `**` globs). Keep greps inside `~/repos/Project-Saka/SakaDesk` and wrap them in `timeout 60`. On the Windows side, read single known files by exact path only (`C:\D\saka-verify\...`).
- **Windows-side testing** is authorised (memory `windows-side-testing-authorized`):
  - reuse the Windows login and never log in from WSL;
  - launch the dev exe with `-WorkingDirectory` set to the exe dir;
  - the live SakaDesk may be closed to launch a test build;
  - verification uses **CDP page screenshots only** (`Page.captureScreenshot` on the app's page target). No Win32 window capture and no Playwright on WSLg.
  - **Never let a held login request through:** L8 fails it on purpose.
- **Branch:** `feat/memories` in SakaDesk.

## Execution order (with the media plan)

**Simple order (always safe):** L1 → M1 … M9 → L2 → L3 → L4 → L5 → L6 → L7 → L8.

**Early-benefit order (recommended; no shared files between neighbours):**

```
L1 → M1 → M2 → M3 → M4 → L2 → L6 → M5 → M6 → M7 → L5 → M8 → L3 → L4 → L7 → M9 → L8
```

| Task | Files shared with the media plan | Earliest slot |
|---|---|---|
| **L1** | `tailwind.config.js`, `DESIGN_SYSTEM.md`, `clientLog.ts`, `backend/api/client_log.py`, `test_client_log_api.py` (all also edited by M5) | **first**: before M1. M5 builds on it. |
| L2 | none (it leaves `MediaGalleryModal.tsx`, `BlogPhotoGalleryModal.tsx` and `SettingsModal.tsx` alone) | any time after L1 |
| L6 | none (`LoginModal.tsx`, `loginLock.ts`, `backend/api/auth.py`, `auth_service.py`, `SyncProgressPanel.tsx`, `App.tsx`) | any time after L1 |
| L5 | `core/media/PhotoPlayer.tsx` (M7 removes its `gallery-thumb` variant) | after M7 |
| L3 | `album/AlbumPage.tsx`, `album/MonthSection.tsx` (M8) | after M8 |
| L4 | `album/MonthSection.tsx` (M8); needs L3's `polling` | after M8 and L3 |
| L7 | `MediaGalleryModal.tsx` (M6), `BlogPhotoGalleryModal.tsx` (M7), `SettingsModal.tsx` (M4) | after M7 |
| L8 | `CHANGELOG.md` (M9); shares M9's Windows build | after M9 |

**Hand-off to media M5.** The media plan's M5 text predates this plan. When M5 is dispatched, its brief must say that `MediaTile` builds its loading state from L1 (see "Shared contracts → Media hand-off"). It must not invent its own shimmer or spinner.

## Shared contracts (all tasks)

**Timing tokens** (`design/tokens/motion.ts`, Task L1):

```ts
export const motion = {
    duration: { fast: 150, base: 200, glide: 400, landing: 1400, toast: 350 },
    easing: { standard: [0.2, 0, 0, 1] },
    /** Milliseconds. Waits: reveal an indicator, add slow copy, explain; keep a shown indicator. */
    loading: { reveal: 200, slow: 3000, verySlow: 10000, minVisible: 400 },
} as const;
```

`design/cssVars.ts` also writes `--ds-loading-reveal`, `--ds-loading-slow`, `--ds-loading-very-slow` and `--ds-loading-min-visible` (ms), the same way it writes the `duration` loop.

**Hooks** (`frontend/src/design/loading.ts`, Task L1):

```ts
export type LoadingStage = 'hidden' | 'shown' | 'slow' | 'verySlow';
export type WaitPhase = 'slow' | 'very_slow' | 'timeout' | 'cancelled';

/** ms to hold a finished result so a shown indicator stays minVisible: 0 if elapsed < reveal, else max(0, reveal + minVisible - elapsed). Pure. */
export function settleDelay(elapsedMs: number): number;

/** Stage clock for one wait; resets when `active` turns false. Logs `ui_wait` once per slow / very_slow when `surface` is given. */
export function useLoadingStages(active: boolean, options?: { surface?: string; startedAt?: number }): { stage: LoadingStage; waitMs: number };

/** true from `reveal` after `active` turns on until `active` is off AND it has been visible >= minVisible. For indicators that do not gate content. */
export function useDelayedLoading(active: boolean): boolean;

/** Generalised calendar pattern: while `loading`, return the last payload of the same `scope` (stale = true). A new scope drops it. */
export function useKeepPrevious<T>(data: T | null, options: { scope: unknown; loading: boolean }): { shown: T | null; stale: boolean };

/** `ui_wait` breadcrumb: surface (^[a-z0-9_]{1,40}$), phase, wait_ms. Never throws. */
export function logWait(surface: string, phase: WaitPhase, waitMs: number): void;
```

**Primitives** (`frontend/src/design/primitives/`, exported from `index.ts`, Task L1):

```ts
// Spinner.tsx — wraps lucide Loader2.
export interface SpinnerProps {
    size?: 'sm' | 'md' | 'lg';                 // h-4 / h-6 / h-8 (+ w)
    tone?: 'accent' | 'muted' | 'current' | 'viewer';  // text-accent / text-muted / currentColor / text-viewer
    label?: string;                            // translated; default t('loading.label')
    labelVisibility?: 'auto' | 'always' | 'compact';
    // auto: `sr-only motion-reduce:not-sr-only` (visible only under reduced motion)
    // always: visible; compact: sr-only always (tiles/bubbles < 160 px only)
    decorative?: boolean;                      // aria-hidden, no role, no label: ONLY next to visible text describing the wait
    className?: string;
}
// Glyph: `animate-spin motion-reduce:animate-none`; non-decorative root has role="status".

// Skeleton.tsx
export const SKELETON_PULSE = 'animate-pulse motion-reduce:animate-none';
export interface SkeletonProps {
    shape: 'line' | 'block' | 'circle' | 'tile';   // h-3 rounded-pill / rounded-card / rounded-pill aspect-square / aspect-square rounded-sm
    tone?: 'sunken' | 'paper' | 'data';            // bg-sunken (cards) / bg-skeleton (paper, cork) / none (caller paints data colour via style)
    className?: string;
    style?: React.CSSProperties;                   // data-driven colour only (DESIGN_SYSTEM "data-driven exception")
}
// Always aria-hidden. The parent region carries role="status" and a label.

// ProgressBar.tsx — extracted from SyncProgressPanel / ShareDialog / UpdateActions.
export interface ProgressBarProps {
    value?: number | null;          // 0..1 determinate; null/undefined = indeterminate
    label: string;                  // aria-label (translated)
    valueText?: string;             // aria-valuetext
    size?: 'thin' | 'sm' | 'md';    // h-0.5 / h-2 / h-4; track bg-sunken rounded-full
    showLabel?: boolean;            // visible label above the bar; indeterminate bars show it under reduced motion regardless
    className?: string;
}
// Fill: bg-expressive-progress, transition-all duration-base ease-standard motion-reduce:transition-none.
// Indeterminate: a w-1/3 segment, `animate-progress-indeterminate motion-reduce:animate-none` (static 1/3 segment).
// role="progressbar"; aria-valuenow only when determinate.

// BusyContent.tsx — keep-previous visual.
export interface BusyContentProps { busy: boolean; label?: string; children: React.ReactNode; className?: string }
// Wrapper `relative`, aria-busy when busy; children dimmed `opacity-60` (transition-opacity duration-base, motion-reduce:transition-none);
// after `reveal` a thin indeterminate ProgressBar pinned to the top edge (absolute inset-x-0 top-0).

// StatusBlock.tsx — merges LoadState, DialogStatus, BlogStatus, recap Status.
type Common = {
    surface: string;                                 // ui_wait code, ^[a-z0-9_]{1,40}$
    variant?: 'pane' | 'dialog' | 'block' | 'fill' | 'inline';
    // pane:   flex flex-1 items-center justify-center p-6 (Memories, chat)
    // dialog: px-6 py-12 (old DialogStatus)
    // block:  h-72 (old BlogStatus);  fill: h-full min-h-96 (old BlogStatus fill)
    // inline: a single row, Spinner sm + text-small text-secondary (band lines, hub line)
    title?: string; hint?: string; icon?: React.ReactNode; className?: string;
};
export type StatusBlockProps = Common & (
    | { kind: 'loading'; label?: string; skeleton?: React.ReactNode;
        slowHint?: string; verySlowHint?: string;    // defaults t('loading.slow') / t('loading.verySlow')
        onCancel?: () => void; cancelLabel?: string;  // shown from verySlow
        progress?: number | null;                     // shown from verySlow; null = indeterminate bar
        stage?: LoadingStage; }                       // override for previews/tests only
    | { kind: 'empty'; action?: React.ReactNode }    // EmptyState, as DialogStatus empty did
    | { kind: 'error' | 'timeout'; onRetry: () => void; retryLabel?: string; retryVariant?: 'secondary' | 'primary' }
);
```

**`StatusBlock` behaviour:**
- **`loading`:**
  - From mount to `reveal`, it renders an empty box of the same variant size, with `role="status"` and `aria-busy`, so layout never jumps.
  - From `reveal`, it shows `skeleton`, or else a `Spinner` (`md`; `lg` for `fill`) with `label`.
  - From `slow`, it adds the slow hint (`text-small text-secondary`).
  - From `verySlow`, it adds the very-slow hint, plus the Cancel button (ghost, `cancelLabel ?? t('loading.cancel')`) when `onCancel` is set, plus a `ProgressBar` when `progress !== undefined`. Without either, it adds an indeterminate `ProgressBar` next to the explanation (D-L1).
  - It logs `ui_wait` for `slow` and `very_slow` once per mount, and `cancelled` when Cancel is pressed.
- **`error`:** `role="alert"`; `title ?? t('loading.error')`; danger icon tile (as `DialogStatus`); Retry (`retryLabel ?? t('loading.retry')`, variant `secondary` by default).
- **`timeout`:** `role="alert"`; `title ?? t('loading.timeout')`; `hint ?? t('loading.timeoutHint')`; neutral `Clock` icon tile (not danger red); Retry. Its copy never matches `error`.
- **`empty`:** `EmptyState` (unchanged look).

**Client event** (Task L1): `ui_wait` with fields `surface`, `phase` (existing key; values `slow|very_slow|timeout|cancelled`) and `wait_ms` (new key). It is whitelisted in `frontend/src/utils/clientLog.ts` (`ClientLogEvent`, `ClientLogFieldKey`) and `backend/api/client_log.py` (`ClientEvent`, `ALLOWED_FIELDS`), and covered by `backend/tests/test_client_log_api.py`.

**Surface codes** (the `surface` field; each task adds its own):
- L2: `dialog_calendar`, `dialog_favorites`, `dialog_diagnostics`, `dialog_search`, `blog_members`, `blog_timeline`, `blog_feed`, `blog_reader`;
- L3: `memories_<view>`, the existing `MemoriesView` code with a `memories_` prefix;
- L4: `memories_hub`, `memories_album_month`;
- L5: `chat_room`;
- L6: `login`, `sync_scan`;
- L7: `recap_share`, `media_gallery`, `blog_gallery`.

**Media hand-off (for media M5 `MediaTile` and its grid):**
- The placeholder layer is `<Skeleton shape="tile" tone="data" style={{ backgroundColor: meta?.color ?? undefined }} />`, or `tone="sunken"` when there is no colour. That is the shimmer the media plan requires, and it is static under reduced motion.
- Under reduced motion, a tile still waiting after `reveal` shows `<Spinner size="sm" tone="muted" labelVisibility="compact" />` centred. That is the media plan's "small spinner instead".
- A failed tile uses the media plan's own retry state. Grid-level states (first page, more pages, pre-generation running) use `StatusBlock` (`variant="dialog"`, surfaces `media_gallery` / `blog_gallery` / `memories_album`), or a `ProgressBar` for M4's "Preparing thumbnails… done / total" row.
- The fade-in stays the media plan's `transition-opacity duration-base ease-standard motion-reduce:transition-none`.

**Loading ratchet** (Task L1, in `design/guard.ts`):
- **Patterns:**
  - `/(?<![\w-])animate-spin(?![\w-])/g`;
  - a bare loading text child, `/>\s*\{t\(\s*['"]common\.loading['"]\s*\)\}/g`.
- **Scope:** the same file filter as `isScanned`, plus `design/primitives/` excluded (primitives own the animation).
- **Baseline:** `frontend/src/design/loading-guard-baseline.json`. It uses the same rules as the style baseline: a new file must be 0, counts only go down, and an improved count must be written back.
- **Updated with** `UPDATE_LOADING_BASELINE=1 npx vitest run src/design/guard.test.ts`.
- **Expected path:** L1 starts it at today's counts (about 21 files). L2, L3, L5, L6 and L7 each lower it. L8 asserts it is `{}`.

---

### Task L1: Loading primitives, timing tokens, wait breadcrumb and the loading guard

**Findings:** F38 (no delayed indicator anywhere; `design/tokens/motion.ts` has durations only), F39 (no `Spinner`/`Skeleton` primitive, `Loader2` hand-rolled, 4 status components), and the `Button` `loading` spinner. That spinner (`design/primitives/Button.tsx:103-104`) becomes a frozen ring with its label hidden under reduced motion, which is an icon-only indicator.

**Files:**
- Modify:
  - `frontend/src/design/tokens/motion.ts`: add `loading` and update the module docstring.
  - `frontend/src/design/cssVars.ts`: the `--ds-loading-*` vars.
  - `frontend/tailwind.config.js`:
    - keyframe `progress-indeterminate` (`0% { transform: translateX(-100%) } 100% { transform: translateX(300%) }`);
    - animation `progress-indeterminate: 'progress-indeterminate 1.4s var(--ds-ease-standard) infinite'`.
  - `frontend/src/design/primitives/Button.tsx`, `loading` state:
    - the overlay spinner becomes `<Spinner size="sm" tone="current" decorative />`, absolutely centred as today;
    - under reduced motion, the label stays visible at `motion-reduce:opacity-60` instead of `opacity-0`, and the static glyph moves to the leading edge (`motion-reduce:left-2 motion-reduce:right-auto`), so the width is unchanged and the button never shows an icon alone;
    - update its docstring.
  - `frontend/src/design/primitives/index.ts`: export the five primitives.
  - `frontend/src/design/DesignPage.tsx`: a new `designPage.loading` section after "Motion". It shows:
    - `Spinner` in 3 sizes and 3 tones, plus `labelVisibility` `always`;
    - `Skeleton` in its 4 shapes and the `sunken` / `paper` tones;
    - `StatusBlock` as `loading` at `stage` `shown` / `slow` / `verySlow` (with Cancel), plus `empty`, `error` and `timeout`;
    - `ProgressBar` at 40% and indeterminate;
    - `BusyContent` around a sample card;
    - a "Play a wait" button that runs a live `useLoadingStages` 0 → 12 s.
  - `frontend/src/design/DesignPage.test.tsx`: the new section heading, plus a live wait that advances fake timers through the stages.
  - `frontend/src/design/guard.ts`:
    - add `LOADING_PATTERNS`, `countLoadingViolations(source)` and `isLoadingScanned(rel)`;
    - generalise `scanTree(srcRoot, count = countViolations, scanned = isScanned)`. Existing callers keep the defaults.
  - `frontend/src/design/guard.test.ts`, new describe blocks:
    - `countLoadingViolations` cases: `animate-spin` counted; `motion-reduce:animate-spin`-like variants counted once; `{t('common.loading')}` as a child counted; `aria-label={t('common.loading')}` **not** counted; comments ignored;
    - `isLoadingScanned` excludes `design/primitives/`;
    - repository vs `loading-guard-baseline.json`, with `UPDATE_LOADING_BASELINE`.
  - `frontend/src/utils/clientLog.ts`: event `ui_wait`, field key `wait_ms`.
  - `backend/api/client_log.py`: `ui_wait` in `ClientEvent`, `wait_ms` in `ALLOWED_FIELDS` (a non-negative int).
  - `backend/tests/test_client_log_api.py`: accept `ui_wait` with valid codes; reject a text `surface`, an unknown `phase` and a negative `wait_ms`.
  - `docs/design/DESIGN_SYSTEM.md`:
    - a new reference section **"Loading and waiting"** (after "Dialogs"): the timing table (0 / 200 ms / 3 s / 10 s / timeout, min-visible 400 ms), the five primitives with props, the "which primitive for which wait" table (audit section 4), the reduced-motion rules (static glyph plus visible label; the `compact` exception) and the media hand-off;
    - §9 "Buttons and states": the reduced-motion loading row;
    - §11: add `animate-progress-indeterminate` 1.4 s to the motion exceptions (hidden under reduced motion);
    - "Which primitive when": rows for `StatusBlock`, `Skeleton`, `Spinner`, `ProgressBar` and `BusyContent`;
    - "The guard (ratchet)": a paragraph on the loading ratchet;
    - "Image still loading": point at `Skeleton`.
  - The five locale files.
- Create:
  - `frontend/src/design/loading.ts` and `frontend/src/design/loading.test.ts`;
  - `frontend/src/design/primitives/Spinner.tsx`, `Skeleton.tsx`, `ProgressBar.tsx`, `BusyContent.tsx`, `StatusBlock.tsx`;
  - `frontend/src/design/primitives/Loading.test.tsx`;
  - `frontend/src/design/loading-guard-baseline.json`, generated in Step 5;
  - `frontend/src/i18n/loadingUx.test.ts`, which exports `LOADING_UX_KEYS` and checks every key is a non-empty string in all 5 locales (pattern of `memoriesFun.test.ts`).

**Strings** (Japanese reference):

| key | ja | en | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `loading.label` | 読み込み中… | Loading… | 載入中… | 加载中… | 載入緊… |
| `loading.slow` | まだ読み込んでいます… | Still loading… | 仍在載入… | 仍在加载… | 仲載入緊… |
| `loading.verySlow` | いつもより時間がかかっています。もう少しお待ちください。 | This is taking longer than usual. Thanks for waiting. | 這次比平常久一些，請再稍候。 | 这次比平时久一些，请再稍候。 | 今次比平時耐啲，請再等陣。 |
| `loading.timeout` | 時間がかかりすぎています | This is taking too long | 等候時間太久了 | 等待时间太久了 | 等得太耐喇 |
| `loading.timeoutHint` | 処理はまだ続いているかもしれません。少し待ってからもう一度お試しください。 | It may still be working in the background. Wait a moment, then try again. | 背景可能仍在處理，請稍候再試一次。 | 后台可能仍在处理，请稍候再试一次。 | 背景可能仲處理緊，等陣再試多次啦。 |
| `loading.error` | 読み込めませんでした | Couldn't load this | 無法載入 | 无法加载 | 載入唔到 |
| `loading.retry` | もう一度 | Try again | 再試一次 | 再试一次 | 再試多次 |
| `loading.cancel` | キャンセル | Cancel | 取消 | 取消 | 取消 |
| `designPage.loading` | 読み込み表示 | Loading states | 載入狀態 | 加载状态 | 載入狀態 |
| `designPage.playWait` | 待ち時間を再生 | Play a wait | 模擬等候 | 模拟等待 | 模擬等候 |

`designPage.*` keys are also checked by `frontend/src/i18n/designSystem.test.ts`.

- [ ] **Step 1:** Write failing `design/loading.test.ts` (fake timers):
  - **`settleDelay`:** 0 → 0, 199 → 0, 200 → 400, 450 → 150, 600 → 0, 5000 → 0.
  - **`useLoadingStages`:**
    - `hidden` at 199 ms, `shown` at 200, `slow` at 3000, `verySlow` at 10000;
    - turning `active` off resets to `hidden` and `waitMs` 0;
    - with `surface`, `clientLog` is called once with `ui_wait {surface, phase: 'slow', wait_ms: 3000}` and once with `very_slow`; it is never called twice per wait and never without a surface;
    - `startedAt` in the past starts the clock from that moment.
  - **`useDelayedLoading`:**
    - a 150 ms wait never shows;
    - a 250 ms wait shows at 200 and stays until 600;
    - a 2 s wait hides when it ends.
  - **`useKeepPrevious`:**
    - while loading, the same scope keeps the last payload with `stale: true`;
    - a new scope gives `shown: null`;
    - ready data gives `stale: false`.
  - **`logWait`:** swallows a throwing `fetch`; refuses a surface that fails `^[a-z0-9_]{1,40}$` (no call, `console.warn` in dev only).
- [ ] **Step 2:** Write failing `primitives/Loading.test.tsx`:
  - **`Spinner`:**
    - `role="status"`, and the label is in the accessible name;
    - the glyph has `animate-spin` and `motion-reduce:animate-none`;
    - with `auto`, the label span has `sr-only motion-reduce:not-sr-only`; with `always`, no `sr-only`; with `compact`, `sr-only` and no `motion-reduce:not-sr-only`;
    - `decorative` gives `aria-hidden` and no role;
    - each `tone` maps to its token class;
    - a CJK label (`読み込み中…🌸`) renders.
  - **`Skeleton`:**
    - `aria-hidden`, plus `SKELETON_PULSE`;
    - each shape and tone class;
    - `tone="data"` has no `bg-*` class and passes `style`.
  - **`ProgressBar`:**
    - determinate: `aria-valuenow=40` and a fill width of 40%;
    - indeterminate: no `aria-valuenow`, the segment has `animate-progress-indeterminate motion-reduce:animate-none`, and the label carries `motion-reduce:not-sr-only`;
    - `size` classes.
  - **`BusyContent`:**
    - `busy` gives `aria-busy` and `opacity-60`;
    - the top bar appears only after 200 ms.
  - **`StatusBlock`:**
    - `loading`:
      - an empty `role="status"` box at 199 ms (no spinner);
      - the spinner or the `skeleton` at 200 ms;
      - the slow hint at 3000 ms;
      - the very-slow hint plus an indeterminate bar at 10000 ms when neither `onCancel` nor `progress` is set;
      - Cancel at 10000 ms when `onCancel` is set; clicking it calls `onCancel` and logs `ui_wait phase=cancelled`;
      - a determinate bar when `progress=0.5`;
      - the `stage` override renders that stage at once;
    - `error`: `role="alert"`, a default title of `loading.error`, and Retry calls `onRetry`;
    - `timeout`: `role="alert"`, the `loading.timeout` title and hint, a `Clock` icon, no danger class, and Retry; its copy is not equal to the error copy;
    - `empty`: renders `EmptyState` with its action;
    - variants: `pane`, `dialog`, `block`, `fill` and `inline` classes.
    - Type-level: `kind="error"` without `onRetry` must not compile. Add a `// @ts-expect-error` line in the test.
  - **`Button`:** loading keeps `aria-busy`; the spinner is `decorative`; the label span has `motion-reduce:opacity-60` (not a bare `opacity-0` under reduced motion).
- [ ] **Step 3:** Write the failing guard tests (Files, above) and `loadingUx.test.ts` with the L1 keys. Add `ui_wait` cases to `test_client_log_api.py`.
- [ ] **Step 4:** Run:

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk/frontend
npx vitest run src/design src/i18n/loadingUx.test.ts src/i18n/designSystem.test.ts
cd .. && uv run pytest backend/tests/test_client_log_api.py -q
```

  Expect FAIL.
- [ ] **Step 5:** Implement. Then generate the loading baseline and review it. It should list only today's raw spinners and bare loading text (about 21 files; `Button.tsx` is excluded as a primitive):

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk/frontend
UPDATE_LOADING_BASELINE=1 npx vitest run src/design/guard.test.ts
```

- [ ] **Step 6:** Run the Step 4 commands again, plus `npx vitest run src/design/guard.test.ts src/core src/shell` (the Button change must not break callers), `npx tsc --noEmit` and `uv run ruff check backend/api/client_log.py`. Expect PASS.
- [ ] **Step 7:** Commit `feat(design): add loading primitives and wait timing tokens`.

### Task L2: Dialog, blog and stray spinners onto the primitives

**Findings and must-items:**
- Requirement 2: `DialogStatus` and `BlogStatus` become `StatusBlock`.
- Must #9: reduced motion for the 8 spinners (F11, F20, F39). Seven of them are here; `MessagesFeature.tsx:799` belongs to L5.
  - `core/media/TranscribeButton.tsx:36`;
  - `core/common/TranslateButton.tsx:109` and `:139`;
  - `core/layout/UpgradeIcon.tsx:146`;
  - `features/messages/components/MemberList.tsx:405`, `:413` and `:457`.
- The rest of F39's raw spinners in files no other task touches.
- F15 (part): the search error gets a Retry (`features/search/SearchModal.tsx:456`).

**Files:**
- Modify:
  - `frontend/src/core/common/DialogStatus.tsx` becomes a **deprecated adapter**. Its `kind` narrows to `'loading' | 'empty'`, the only kinds its two remaining callers use (`MediaGalleryModal.tsx:444`, `:530`; `BlogPhotoGalleryModal.tsx:186`, `:216`, `:218`). It renders `<StatusBlock variant="dialog" surface="dialog" …/>` with the same `title`, `hint`, `icon` and `className`. JSDoc says "removed in L7". This keeps both gallery files untouched for media M6 / M7, which may keep calling it; if M6 / M7 need an error state, they use `StatusBlock` directly.
  - `DialogStatus` callers migrate to `StatusBlock` directly:
    - `core/modals/CalendarModal.tsx:298-300` (`dialog_calendar`);
    - `core/modals/FavoritesModal.tsx:269` (`dialog_favorites`);
    - `core/modals/DiagnosticsModal.tsx:331-333` (`dialog_diagnostics`). The error now gets Retry, which re-runs its load;
    - `features/blogs/components/MemberSelectModal.tsx:229-234` (`blog_members`, `retryVariant="primary"` kept);
    - `features/blogs/components/MemberTimelineModal.tsx:113-130` (`blog_timeline`, primary kept);
    - `features/search/SearchModal.tsx:455-458` (`dialog_search`). The error gets Retry, which re-runs the last query; the `py-8` override is kept through `className`.
  - `BlogStatus` callers become `StatusBlock` (`variant="block"`, or `"fill"` where `fill` was passed; `retryVariant="primary"` as before):
    - `features/blogs/components/RecentPostsFeed.tsx` (`blog_feed`);
    - `features/blogs/components/BlogReader.tsx` (`blog_reader`).
  - Raw spinners become `Spinner`. Use `decorative` only where visible text sits next to the glyph; otherwise give a `label`:
    - `core/media/TranscribeButton.tsx:36`, `decorative` next to the "transcribing" text. Do **not** touch its raw-rgba debt beyond what the guard baseline already allows;
    - `core/common/TranslateButton.tsx:109`, `:139`;
    - `core/layout/UpgradeIcon.tsx:146`, labelled with the existing launching copy;
    - `features/messages/components/MemberList.tsx:405`, `:413`, `:457` (`RefreshCw` spinners become `Spinner`; the sync meaning is kept by the adjacent text or `label`);
    - `features/messages/components/MemberProfilePopup.tsx`;
    - `features/search/SearchModal.tsx` (load more: `Button loading={isLoadingMore}` replaces the native `disabled` plus the hand-rolled spinner, `:471-473`);
    - `features/search/components/SearchInput.tsx`;
    - `core/modals/DiagnosticsModal.tsx`;
    - `core/modals/ReportIssueModal.tsx`;
    - `core/media/VideoPlayer.tsx`, `core/media/VoicePlayer.tsx` (the buffering spinners keep `useMediaPlayback` semantics; they become `tone="viewer"` / `"current"`).
  - `frontend/src/core/upgrade/UpdateActions.tsx`: its inline `role="progressbar"` becomes `ProgressBar` (determinate; the same label and value text).
  - `frontend/src/design/loading-guard-baseline.json`: lower it (`DialogStatus` stays at 0 through the adapter).
  - Tests that asserted these components' DOM, kept green with `advanceTimersByTime(200)` where a loading indicator is now delayed: `core/common/DialogStatus.test.tsx` (adapter), `design/rCDialogs.test.tsx`, and the blogs, search, calendar, favourites, diagnostics, member list, transcribe, translate and upgrade tests.
- Delete:
  - `frontend/src/features/blogs/components/BlogStatus.tsx` and its test, after its last caller is gone. A `timeout 60 grep -rn "BlogStatus" frontend/src` must show no hits.

**Strings:** none new. The existing titles are reused, and default copy comes from L1.

- [ ] **Step 1:** Write failing tests:
  - **Calendar, Favourites, Diagnostics, MemberSelect, MemberTimeline, Search, RecentPostsFeed, BlogReader:**
    - loading shows nothing at 199 ms and the spinner at 200 ms;
    - slow copy at 3000 ms; very-slow copy plus a bar at 10000 ms;
    - error shows the same title and role as before, plus Retry. In Diagnostics and Search, Retry re-runs the load or query (spy);
    - loaded shows the content;
    - empty states are unchanged (same text and icon).
  - **Search:** load more uses `Button` `loading` (`aria-busy`; no native `disabled`).
  - **Spinners:** each converted component renders a `Spinner` (`role="status"` or `decorative` next to text) with `motion-reduce:animate-none`; `MemberList` shows no `RefreshCw` with `animate-spin`.
  - **`UpdateActions`:** `role="progressbar"` keeps `aria-valuenow` and the label.
  - **Adapter:** `DialogStatus kind="loading"` still renders through `StatusBlock` (delayed) for the two gallery callers.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/core src/features/blogs src/features/search src/features/messages/components src/design`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run Step 2's command, `UPDATE_LOADING_BASELINE=1 npx vitest run src/design/guard.test.ts` (review: counts only went down), `npx vitest run src/design/guard.test.ts` and `npx tsc --noEmit`. Expect PASS.
- [ ] **Step 5:** Commit `refactor(ui): move dialog and blog states onto StatusBlock`.

### Task L3: Memories staged loading, timeouts, kept content and the member pane

**Findings and must-items:**
- Must #2: F22 (`features/memories/shared/LoadState.tsx:11-26`, a muted text line with no indicator across about 25 views) and F23 (timeout and error share `memories.common.loadError`; `useMemoriesQuery.ts:98` logs the timeout but sets the same `error` state).
- Must #7: F24 (in-view steps replace the body with `LoadState`; see `memoir/Timeline.tsx:171`, `:173`, `:289`, `:308`, `onThisDay/OnThisDayPage.tsx:110` and `day/DayView.tsx:92`, while `calendar/CalendarAlbumPage.tsx:82-86` and `album/AlbumPage.tsx:135-138` hand-roll a kept payload) and F25 (`shared/MemberPane.tsx:70`, no loading or error state).
- Requirement 2: `LoadState` and the recap `Status` (`recap/RecapEntry.tsx:55-62`) become `StatusBlock`.
- The static `MemoirHeaderPlaceholder` (`memoir/MemoirHeader.tsx:73-85`) moves onto `Skeleton`.

**Files:**
- Modify:
  - `frontend/src/features/memories/shared/useMemoriesQuery.ts`:
    - `MemoriesQuery<T>` gains:
      - `failure: 'timeout' | 'error' | null`;
      - `stale: boolean` (true while kept data from the previous deps is shown);
      - `polling: boolean` (a `refreshWhile` reload is scheduled or in flight and the cap is not reached).
    - `MemoriesQueryOptions<T>` gains `keepPrevious?: { scope: unknown }`. While a new key loads and the last ready run had an equal `scope` (`Object.is`), the query reads `status: 'loading'`, `data: <previous payload>` and `stale: true`. A different scope, or the first load, reads `data: null` as today.
    - **Min-visible settle:** a run that settles at elapsed *e* commits after `settleDelay(e)` (L1), so an indicator revealed at 200 ms stays until at least 600 ms. Quiet reloads commit at once.
    - The timeout run sets `failure: 'timeout'`. Every other error sets `failure: 'error'`.
    - Update the docstring (Zero Drift).
  - `frontend/src/features/memories/shared/LoadState.tsx` is **deleted**. Every caller moves to `StatusBlock` through one small helper in the same folder, `shared/memoriesStatus.tsx`:

    ```ts
    export function MemoriesStatus(props: { query: MemoriesQuery<unknown>; view: MemoriesView;
        skeleton?: React.ReactNode; variant?: 'pane' | 'inline'; slowHint?: string; verySlowHint?: string }): JSX.Element
    ```

    It maps `query.status` / `failure` to `kind` (`loading` / `error` / `timeout`). It sets `surface = 'memories_' + view` and passes `query.retry`. Its defaults are `slowHint = t('memories.common.slow')`, `verySlowHint = t('memories.common.verySlow')`, the error title `memories.common.loadError` (kept) and the timeout title / hint `memories.common.timeout` / `timeoutHint`. It is a thin mapping, not a fifth status component; it renders only `StatusBlock`.
  - Callers (27 `<LoadState` sites in 17 files): `MemoriesHome.tsx:46`, `album/AlbumPage.tsx:195`, `album/MonthSection.tsx:59`, `calendar/CalendarAlbumPage.tsx:104`, `:191`, `:194`, `day/DayView.tsx:92`, `day24/Day24View.tsx`, `favorites/FavoritesPage.tsx`, `favorites/FilmStrip.tsx`, `gacha/GachaPage.tsx`, `memoir/CardDetail.tsx`, `memoir/MemoirPage.tsx`, `memoir/NameMoments.tsx`, `memoir/Timeline.tsx:171`, `:173`, `:289`, `:308`, `onThisDay/OnThisDayPage.tsx:110`, `radio/RadioPage.tsx`, `radio/Station.tsx`, `thenNow/ThenNowPanel.tsx`.
    - In `MonthSection.tsx`, L3 only swaps `LoadState` for `MemoriesStatus`; L4 replaces it with the band skeleton.
    - In `MemoriesHome.tsx`, L3 only swaps the component; L4 adds the hub copy.
  - **`keepPrevious` adoption** (F24). The kept body is wrapped in `BusyContent busy={query.stale}`:
    - `memoir/Timeline.tsx` month body, `scope: [service, memberPath]` (month steps keep the previous month dimmed);
    - `onThisDay/OnThisDayPage.tsx`, `scope: service` (the year / month-day step);
    - `day/DayView.tsx`, `scope: service` (the day step);
    - `calendar/CalendarAlbumPage.tsx` `MonthGrid`: replace the hand-rolled `kept` (`:82-86`) with `keepPrevious: { scope: [service, member] }`. Behaviour is unchanged: dimmed and `aria-busy`, now through `BusyContent`;
    - `album/AlbumPage.tsx`: replace the hand-rolled `kept` (`:135-138`) with `keepPrevious: { scope: [service, member, kind] }`. Behaviour is unchanged for a cover change; a member or filter switch now also keeps the previous months dimmed **within the same filter scope**. The `MemberPane` row selection updates at once.
  - `frontend/src/features/memories/shared/MemberPane.tsx` (F25): new props `status?: 'loading' | 'ready' | 'error' | 'timeout'` and `onRetry?: () => void`.
    - `loading`: after `reveal`, 6 rows of `Skeleton circle` (h-8 w-8) plus `Skeleton line`, under a `role="status"` wrapper labelled `loading.label`. The 「全員」 row stays.
    - `error` / `timeout`: below the 「全員」 row, `StatusBlock variant="inline"` with Retry (`memories.common.membersError`, or the timeout copy).
    - The callers pass their members query: album, radio, favorites, calendar and memoir.
  - `frontend/src/features/memories/recap/RecapEntry.tsx`: its `Status` (`:55-62`, used at `:240` and `:308`) becomes `StatusBlock` (`surface="memories_recap"`, the generic Memories slow copy; recap-specific copy is F30, later). Error and timeout map from its existing load result.
  - `frontend/src/features/memories/memoir/MemoirHeader.tsx`: `MemoirHeaderPlaceholder` (`:73-85`) draws `Skeleton` (`circle` plus 2 `line`s, `tone="paper"`), with the same height, `role="status"` and an `sr-only` label of `loading.label` (it no longer uses bare `common.loading` text).
  - `frontend/src/features/memories/memoriesLog.ts`: no change. `memories_load` already logs `timeout`.
  - Tests: `shared/useMemoriesQuery.test.tsx` (extend), `shared/MemberPane.test.tsx` (extend), new `shared/memoriesStatus.test.tsx`, and every Memories page test that asserted 「読み込み中…」 at 0 ms (advance 200 ms; the text is now the spinner label).
  - `frontend/src/design/loading-guard-baseline.json`: remove `LoadState.tsx`, `RecapEntry.tsx` and `MemoirHeader.tsx`.
  - Locales and `loadingUx.test.ts`.

**Strings** (Japanese reference):

| key | ja | en | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `memories.common.slow` | 思い出を準備しています… | Preparing your memories… | 正在準備你的回憶… | 正在准备你的回忆… | 準備緊你嘅回憶… |
| `memories.common.verySlow` | 初めて開くときや同期の直後は、アーカイブの整理に少し時間がかかります。 | The first time, or right after a sync, sorting the archive takes a little while. | 第一次開啟或剛同步完時，整理資料需要一點時間。 | 第一次打开或刚同步完时，整理资料需要一点时间。 | 第一次開或者啱啱同步完，整理資料要少少時間。 |
| `memories.common.timeout` | いつもより時間がかかっています | This is taking longer than usual | 這次比平常久 | 这次比平时久 | 今次比平時耐 |
| `memories.common.timeoutHint` | 準備はまだ続いているかもしれません。もう一度お試しください。 | It may still be getting ready. Try again. | 可能還在準備中，請再試一次。 | 可能还在准备中，请再试一次。 | 可能仲準備緊，再試多次啦。 |
| `memories.common.membersError` | メンバーを読み込めませんでした | Couldn't load the members | 無法載入成員 | 无法加载成员 | 載入唔到成員 |

- [ ] **Step 1:** Write failing `useMemoriesQuery.test.tsx` cases (fake timers):
  - a `MemoriesTimeoutError` gives `failure: 'timeout'`; a `MemoriesFetchError(500)` gives `failure: 'error'`;
  - `keepPrevious`:
    - same scope: on a deps change, `status: 'loading'`, `data` = the old payload, `stale: true`; then the new payload and `stale: false`;
    - a different scope gives `data: null`;
    - an aborted run never commits;
  - min-visible: a load finishing at 300 ms commits at 600 ms; one finishing at 100 ms commits at once; one finishing at 2 s commits at once;
  - `polling` is true while a `refreshWhile` reload is pending, and false after `REFRESH_WHILE_MAX` or when the flag clears;
  - existing cases stay green (adjust only for the settle delay).
- [ ] **Step 2:** Write failing `memoriesStatus.test.tsx`:
  - loading: nothing at 199 ms, the spinner at 200 ms, 「思い出を準備しています…」 at 3000 ms, the very-slow copy plus a bar at 10000 ms;
  - an error shows 「読み込めませんでした」 plus Retry calling `query.retry`;
  - a timeout shows 「いつもより時間がかかっています」 plus its hint plus Retry, and **not** the error copy;
  - `ui_wait surface=memories_album phase=slow` is logged once.
- [ ] **Step 3:** Write failing page tests:
  - **Timeline:** a month step keeps the previous month visible and `aria-busy`, and swaps when ready.
  - **OTD, DayView:** the same for a year or day step.
  - **Calendar:** unchanged behaviour (existing tests).
  - **Album:** a member switch keeps the months dimmed; a cover change behaves as before.
  - **MemberPane:**
    - skeleton rows appear only after 200 ms;
    - an error row with Retry calls `onRetry`; a timeout row uses the timeout copy;
    - CJK names render in the loaded state.
  - **RecapEntry:** loading, error and timeout through `StatusBlock`.
  - **MemoirHeader:** the placeholder is a `Skeleton` with the same height class.
- [ ] **Step 4:** Run `cd frontend && npx vitest run src/features/memories src/i18n/loadingUx.test.ts`. Expect FAIL.
- [ ] **Step 5:** Implement.
- [ ] **Step 6:** Run Step 4's command, plus `npx vitest run src/design/guard.test.ts` (after `UPDATE_LOADING_BASELINE=1`, review the diff), `npx tsc --noEmit` and `timeout 60 grep -rn "LoadState" frontend/src` (expect no hits). Expect PASS.
- [ ] **Step 7:** Commit `feat(memories): show staged loading, timeouts and kept content`.

### Task L4: Hub "still gathering" line and album month-band skeletons

**Findings and must-items:**
- Must #3, F27: on first run, `/hub` takes up to 20 s and then re-polls quietly while `refreshing` (`MemoriesHome.tsx:36-47`, `useMemoriesQuery.ts:33-35`), and nothing says the board is still being built.
- Must #4, F28: every month band shows a text line for about 7 s on a cold album (`album/MonthSection.tsx:59`, `MonthLoader`). The tiles themselves are media M8.

**Files:**
- Modify:
  - `frontend/src/features/memories/MemoriesHome.tsx`:
    - **First load:** the moment slot's `MemoriesStatus` gets a skeleton shaped like the On This Day card (`Skeleton block`, the card's height), `slowHint = t('memories.common.slow')` and `verySlowHint = t('memories.home.firstVerySlow')`. Per D-L1, there is no Cancel at 10 s: the entry cards below stay usable, and the copy says so.
    - **Gathering line:** when `hub.data?.refreshing && hub.polling`, show one line under the `<h1>`: `StatusBlock kind="loading" variant="inline" surface="memories_hub" label={t('memories.home.gathering')}`. Its stage `shown` is forced, because the board is already on screen, so there is no reveal delay. It is `role="status"` and `aria-live="polite"`. It disappears when `refreshing` clears or polling stops (cap reached). At the cap, log `ui_wait surface=memories_hub phase=timeout` once, and quietly drop the line, because the board stays usable. It never blocks the board.
  - `frontend/src/features/memories/album/MonthSection.tsx`:
    - `MonthLoader` takes the month's `count` (the `AlbumMonthSummary.count` that `AlbumPage` already has) and renders a tile grid of `Skeleton shape="tile" tone="sunken"` inside the same `ALBUM_GRID_COLS` / `ALBUM_GRID_MIN` box as `MonthGrid`, with `min(count, BAND_SKELETON_MAX = 12)` tiles. The band keeps roughly its final height, and the polaroid cover still shows beside it.
    - Wrap it in a `role="status"` with an `sr-only` label of `loading.label`.
    - It is revealed after 200 ms (`useDelayedLoading`). Before that, it reserves the height with an empty box.
    - Error and timeout render `MemoriesStatus variant="inline"` with Retry inside the band.
  - `frontend/src/features/memories/album/AlbumPage.tsx`:
    - one page-level `AlbumWaitLine` above the bands, rather than slow copy in every band;
    - it tracks the months whose `MonthLoader` has not settled (it already has `onSettled`) through `useLoadingStages(anyLoading, { surface: 'memories_album_month' })`;
    - it shows `memories.album.waitSlow` from 3 s and `memories.album.waitVerySlow` plus an indeterminate `ProgressBar size="thin"` from 10 s;
    - `inline` variant.
  - Tests: `MemoriesHome.test.tsx` (or the existing hub test file), `album/AlbumPage.test.tsx`, `album/MonthSection` coverage inside it.
  - Locales and `loadingUx.test.ts`.

**Strings** (Japanese reference):

| key | ja | en | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `memories.home.gathering` | 思い出を集めています… 新しいカードが順に表示されます。 | Gathering your memories… New cards will appear as they're ready. | 正在收集回憶…新的卡片會陸續出現。 | 正在收集回忆…新的卡片会陆续出现。 | 收集緊回憶…新卡會陸續出現。 |
| `memories.home.firstVerySlow` | 初回は思い出の索引を作るため、少し時間がかかります。下のカードは今すぐ開けます。 | The first time, building the memories index takes a little while. The cards below already open. | 第一次需要建立回憶索引，會花一點時間。下方的卡片現在就能開啟。 | 第一次需要建立回忆索引，会花一点时间。下方的卡片现在就能打开。 | 第一次要整回憶索引，要少少時間。下面啲卡而家已經開得。 |
| `memories.album.waitSlow` | 写真を並べています… | Laying out your photos… | 正在排列照片… | 正在排列照片… | 排緊相… |
| `memories.album.waitVerySlow` | 写真の多い月は、表示まで少し時間がかかります。 | Months with many photos take a little longer to appear. | 照片多的月份需要多一點時間才會顯示。 | 照片多的月份需要多一点时间才会显示。 | 相多嘅月份要耐少少先出到。 |

- [ ] **Step 1:** Write failing tests (fake timers; `/hub` and album routes mocked in `__tests__/mocks/handlers.ts`):
  - **Hub, first load:**
    - nothing at 199 ms; the card skeleton at 200 ms;
    - 「思い出を準備しています…」 at 3000 ms; `firstVerySlow` plus a bar at 10000 ms;
    - the entry cards are clickable throughout;
    - a 20 s timeout shows the timeout copy plus Retry.
  - **Hub, refreshing:**
    - a payload with `refreshing: true` shows the gathering line at once, with `role="status"`;
    - the next poll with `refreshing: false` removes it;
    - after `REFRESH_WHILE_MAX` polls it disappears and `ui_wait phase=timeout` is logged once;
    - `refreshing: false` from the start shows no line.
  - **Album band:**
    - a cold month shows nothing at 199 ms, then `min(count, 12)` skeleton tiles at 200 ms (count 3 → 3 tiles, count 40 → 12);
    - the band's grid box uses `ALBUM_GRID_COLS`;
    - error and timeout render inside the band with Retry; loaded renders `MonthGrid`.
  - **Album wait line:** two bands loading → one line; `waitSlow` at 3 s; `waitVerySlow` plus a thin bar at 10 s; gone when the last band settles; logged once per phase.
  - Existing album tests (band windowing, ribbon jump, cover menu, small window) stay green.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/memories/album src/features/memories/home src/features/memories/MemoriesHome* src/i18n/loadingUx.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/features/memories src/design/guard.test.ts src/i18n` and `npx tsc --noEmit`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): show hub gathering line and album band skeletons`.

### Task L5: Chat never blank while a room loads; bubble photos show they are loading

**Findings and must-items:**
- Must #5:
  - **F1:** switching to an uncached room hides the list (`messagesForDir === selectedGroupDir`), while the loading text is hidden by the previous room's `messages.length` (`features/messages/MessagesFeature.tsx:399`, `:853`, `:863`).
  - **F2:** the list is gated on `roomExtras.lettersReady` with no indicator (`MessagesFeature.tsx:863`, `hooks/useRoomExtras.ts:32`). `useRoomLetters` already caps that wait at `LETTERS_WAIT_MS = 3000`.
  - **F3:** plain text "Loading messages…" (`:853-855`); `limit=0` loads the whole room in one request.
  - **F4:** a raw `err.message` in red with no Retry (`:856-861`).
- Must #9, F11: the chat header sync spinner at `MessagesFeature.tsx:799` has no reduced motion.
- Must #10, F5: the bubble photo box is a static `bg-elevated` (`components/MessageBubble.tsx:126-135`), and the `<img>` has no load state (`core/media/PhotoPlayer.tsx:140-151`).

**Files:**
- Create:
  - `frontend/src/features/messages/components/ChatSkeleton.tsx`: 6 alternating rows, each an avatar `Skeleton circle` plus 1–2 `Skeleton block` bubbles of varied widths (a fixed pattern, not random), `tone="sunken"`, aligned like `MessageList` rows. It is `aria-hidden`; the `StatusBlock` around it carries the label.
  - `frontend/src/features/messages/components/ChatSkeleton.test.tsx`.
- Modify `frontend/src/features/messages/MessagesFeature.tsx`:
  - **Derived state (one place, documented):**
    - `roomPending = !!selectedGroupDir && !error && messagesForDir !== selectedGroupDir` (F1: the fetch for this room has not landed, whatever the previous room left in `messages`);
    - `lettersPending = !!selectedGroupDir && messagesForDir === selectedGroupDir && messages.length > 0 && !roomExtras.lettersReady` (F2);
    - `chatWaiting = roomPending || lettersPending`.
  - **While `chatWaiting`:** render `<StatusBlock kind="loading" variant="pane" surface="chat_room" skeleton={<ChatSkeleton />} label={t('messageList.loadingMessages')} slowHint={t('messageList.loadingSlow')} verySlowHint={t('messageList.loadingVerySlow')} />` in the timeline box. This replaces the `:853-855` text.
    - Per D-L1, the 10 s step adds the indeterminate bar; the room list stays usable.
    - The `FadeOnChange` wrapper stays.
    - A cached room skips all of this (instant render, as today).
  - **`fetchMessages`:**
    - record `startedAt` and commit through `settleDelay` (min-visible);
    - add `CHAT_LOAD_TIMEOUT_MS = 60_000` (an `AbortController` per fetch, aborted on supersede and on timeout). On timeout, set `loadFailure = 'timeout'`;
    - every other error sets `'error'`;
    - log `ui_wait surface=chat_room phase=timeout` on timeout;
    - the `console.error` at `:381` logs `path` and `err.message`. Replace it with a dev-only `console.warn('[MessagesFeature] fetchMessages failed', { groupChat, httpStatus })`, which carries no path and no text. No new client event is added: the timeout already goes through `ui_wait`, and the user-facing copy never shows `err.message`.
  - **Error / timeout (F4):** `<StatusBlock kind={loadFailure} variant="pane" surface="chat_room" icon={<CloudOff />} title=… hint=… onRetry={() => fetchMessages(selectedGroupDir, isGroupChat, readState.lastReadId)} />`, with titles `messageList.loadFailed` / `loadTimeout` and hints `loadFailedHint` / `loadTimeoutHint`. This replaces `:856-861`.
  - **`:799`:** the header pill spinner becomes `<Spinner size="sm" tone="current" decorative />` next to its sync text (F11).
  - Update the comment at `:399`: the brief blank is gone, and the skeleton covers it.
- Modify `frontend/src/features/messages/components/MessageBubble.tsx`, `MediaContainer` (`:101-135`): add a `loaded` state, reset per `message.id`, and pass `onLoad` to the photo child.
  - **Until loaded** (picture only; videos keep `bg-viewer-stage`):
    - the box gets `SKELETON_PULSE` on `bg-sunken`, replacing the static `bg-elevated`;
    - under reduced motion, a centred `<Spinner size="sm" tone="muted" label={t('media.photoLoading')} />`, whose label is visible under reduced motion (`auto`);
    - the spinner is revealed after 200 ms (`useDelayedLoading`), so cached images never flash it.
  - **After load:** the pulse stops.
- Modify `frontend/src/core/media/PhotoPlayer.tsx`, bubble variant (`:140-151`):
  - accept `onLoad?: () => void`;
  - the `<img>` starts `opacity-0` and becomes `opacity-100` on load (`transition-opacity duration-base ease-standard motion-reduce:transition-none`);
  - an already-`complete` image (cache) is visible at once: check `ref.current?.complete && naturalWidth > 0` in a layout effect;
  - the fallback and error paths are unchanged;
  - do not touch the `gallery-thumb` or `fullscreen` variants (media M7 owns `gallery-thumb`; F6 is later).
- Tests:
  - `MessagesFeature.recovery.test.tsx` (extend) and a new `MessagesFeature.loading.test.tsx`;
  - `components/MessageBubble.test.tsx` (or the existing bubble test), `core/media/PhotoPlayer.test.tsx` (extend).
- Modify `frontend/src/design/loading-guard-baseline.json`: remove `MessagesFeature.tsx`.
- Locales and `loadingUx.test.ts`.

**Strings** (Japanese reference):

| key | ja | en | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `messageList.loadingSlow` | まだメッセージを読み込んでいます… | Still loading messages… | 仍在載入訊息… | 仍在加载消息… | 仲載入緊訊息… |
| `messageList.loadingVerySlow` | メッセージの多いトークは、開くまで少し時間がかかります。 | Chats with many messages take a little longer to open. | 訊息很多的聊天室需要多一點時間開啟。 | 消息很多的聊天室需要多一点时间打开。 | 訊息多嘅聊天室要耐少少先開到。 |
| `messageList.loadFailed` | メッセージを読み込めませんでした | Couldn't load the messages | 無法載入訊息 | 无法加载消息 | 載入唔到訊息 |
| `messageList.loadFailedHint` | 保存したデータはそのままです。もう一度お試しください。 | Your saved messages are safe. Try again. | 已儲存的資料都還在，請再試一次。 | 已保存的数据都还在，请再试一次。 | 儲咗嘅資料仲喺度，再試多次啦。 |
| `messageList.loadTimeout` | 読み込みに時間がかかりすぎています | Loading the messages is taking too long | 載入訊息花了太久 | 加载消息花了太久 | 載入訊息用咗太耐 |
| `messageList.loadTimeoutHint` | アプリがまだ処理中かもしれません。少し待ってからもう一度お試しください。 | The app may still be busy. Wait a moment, then try again. | 應用程式可能仍在處理，請稍候再試。 | 应用可能仍在处理，请稍候再试。 | 個 app 可能仲處理緊，等陣再試啦。 |
| `media.photoLoading` | 写真を読み込み中… | Loading photo… | 正在載入照片… | 正在加载照片… | 載入緊相… |

- [ ] **Step 1:** Write failing `MessagesFeature.loading.test.tsx` (fake timers; the room fetch controlled by a deferred promise in the msw handler):
  - **F1:**
    - with room A loaded, select uncached room B;
    - at 199 ms, neither A's list nor a skeleton (the box is `aria-busy`); at 200 ms the `ChatSkeleton` plus `role="status"` named 「メッセージを読み込み中...」;
    - at 3000 ms 「まだメッセージを読み込んでいます…」; at 10000 ms the very-slow copy plus a bar;
    - resolving B renders B's messages (min-visible respected: a resolve at 250 ms shows the list at 600 ms);
    - **at no point** is the timeline box empty without a status (assert at 50 ms steps).
  - **F2:** messages resolved and letters pending → the skeleton stays; letters ready → the list; letters never answering → the list appears at `LETTERS_WAIT_MS`.
  - **Cached room:** instant list, no skeleton at any time.
  - **F4:**
    - a 500 error → 「メッセージを読み込めませんでした」 plus its hint plus Retry; Retry refetches; `err.message` never appears in the DOM;
    - a 60 s timeout → the timeout copy (not the failure copy) plus Retry, and `ui_wait phase=timeout` logged.
  - **`:799`:** the header pill renders a decorative `Spinner` with `motion-reduce:animate-none`.
  - CJK and emoji room names in the loaded state.
- [ ] **Step 2:** Write failing bubble tests:
  - before `load`: the pulse classes on the box, and no spinner at 199 ms; at 200 ms a `Spinner` with label 「写真を読み込み中…」 whose label carries `motion-reduce:not-sr-only`;
  - after `load`: no pulse, and the image `opacity-100`;
  - a `complete` image on mount → no pulse and no spinner ever;
  - an error → the existing fallback;
  - video bubbles are unchanged.
- [ ] **Step 3:** Run `cd frontend && npx vitest run src/features/messages src/core/media/PhotoPlayer* src/i18n/loadingUx.test.ts`. Expect FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run Step 3's command, plus `npx vitest run src/design/guard.test.ts` (baseline lowered), `npx tsc --noEmit` and `timeout 60 grep -n "console.error" frontend/src/features/messages/MessagesFeature.tsx` (no hit may log `path` or `err.message`). Expect PASS.
- [ ] **Step 6:** Two commits, staged by file:
  - `fix(messages): never show a blank timeline while a room loads` (MessagesFeature, ChatSkeleton, their tests and locales);
  - `feat(messages): show bubble photos loading and fade them in` (MessageBubble, PhotoPlayer and their tests).

### Task L6: Login stays cancellable while connecting; sync shows scanning instead of 0 %

**Findings and must-items:**
- Must #6, F17: the Close ×, Cancel and Login controls all get a native `disabled` while connecting, and the modal is not dismissible, so the user is trapped (`shell/components/LoginModal.tsx:181`, `:203`, `:221`, `:224-227`). The backend login runs as one long `POST /api/auth/login` (`backend/api/auth.py:35-46` → `AuthService.login_with_browser`, `backend/services/auth_service.py:481`). It already has the cancel machinery `_supersede_active_login` (`:542-551`), which cancels the task and closes its browser.
- Must #8, F16: with `total = 0`, the panel reads "0 / 0 · 0 %" with an empty bar (`core/common/SyncProgressPanel.tsx:23-25`, `:44-62`).
- F39 leftovers in these files: the sync spinners in `SyncProgressPanel.tsx`, the login spinner (`LoginModal.tsx:227`) and the boot spinner (`shell/App.tsx:326`).

**Files (login):**
- Modify:
  - `backend/services/auth_service.py`: add `async cancel_login(self, service: str) -> bool`.
    - It cancels the active browser-login task when there is one (reusing `_supersede_active_login`'s cancel-and-await), and returns whether one was cancelled.
    - It logs `login_cancel` with `service` (an id) and `outcome=cancelled|none`.
    - In `login_with_browser`, the `CancelledError` branch keeps re-raising. The route converts it (below).
  - `backend/api/auth.py`:
    - add `POST /login/cancel?service=` (validates like `/login`, 400 on an unknown service), returning `{"cancelled": bool}`;
    - the `/login` handler catches the cancellation of its own login (`asyncio.CancelledError` raised out of `login_with_browser` **because of** `cancel_login`, flagged by a per-service `self._cancelled` marker set in `cancel_login`) and answers `409 {"detail": "login_cancelled"}`. A real shutdown cancellation, with no marker, still propagates;
    - update the docstrings.
  - `frontend/src/shell/components/loginLock.ts`: add `setLoginAbort(controller | null)` and `cancelLogin(service): Promise<void>`. `cancelLogin` aborts the in-flight fetch, `POST`s `/api/auth/login/cancel`, ignores network errors (logged by code), and unlocks. App-wide, because the lock is app-wide: a dialog mounted later can cancel a login started by another one.
  - `frontend/src/shell/components/LoginModal.tsx`:
    - `doLogin` creates an `AbortController` and registers it with `setLoginAbort`;
    - the fetch gets `signal`;
    - an `AbortError`, or a 409 `login_cancelled`, is a **cancel**, not a failure: `logDialogLoad('login', 'cancelled')`, no error text, and `logWait('login', 'cancelled', waitMs)`;
    - **Phases:**
      - `connecting`: from the click until the POST answers;
      - `finishing`: the POST answered OK, so service init, the 1.5 s spacer and `onSuccess` run;
    - **Close ×, Cancel and the backdrop / Escape** stay enabled in `connecting`:
      - they call `cancelLogin(serviceId)`, then `onClose()`;
      - `Modal dismissible` is always true; while connecting, dismissing equals Cancel;
      - remove the three native `disabled={isLoading}`;
    - in `finishing`, Cancel gets `disabledReason={t('login.finishing')}`, because the login already succeeded on a single-session token and must not be undone. Close × behaves the same;
    - **Login button:** `Button variant="primary" loading={isLoading}`, replacing the hand-rolled `Loader2` (`:225-227`);
    - **Staged copy** under the description (`useLoadingStages(phase === 'connecting', { surface: 'login' })`): from 3 s `login.waitingSlow`; from 10 s `login.waitingVerySlow`, which tells the user to finish in the opened browser window and that Cancel works (the Cancel button is already visible). The copy is `role="status"`, `aria-live="polite"`;
    - the Yodel geo check runs inside `connecting` (the lock is already taken synchronously), so the click shows the loading state at once (F18 comes for free; no extra work).
- Tests:
  - `backend/tests/test_auth_api.py` (append `test_login_cancel_*`);
  - `backend/tests/test_auth_service.py` (append);
  - `frontend/src/shell/components/entryDialogs.test.tsx` (extend), or a new `LoginModal.loading.test.tsx`.

**Files (sync and boot):**
- Modify:
  - `frontend/src/core/common/SyncProgressPanel.tsx`:
    - `scanning = (state === 'running' || state === 'queued') && total === 0`;
    - while `scanning`, hide the "0 / 0" and "0 %" row text, and show `sync.preparing` instead;
    - the bar is `<ProgressBar value={null} size="md" label={t('sync.progress')} />` (indeterminate);
    - from 10 s of `scanning` (`useLoadingStages(scanning, { surface: 'sync_scan' })`), add `sync.preparingVerySlow`. Cancel already exists in the sync dialog footer and inline view, so the constraint is met;
    - when `total > 0`, the determinate `ProgressBar` shows today's numbers, label and value text;
    - its two spinners become `Spinner` (decorative next to their phase text).
  - `frontend/src/shell/App.tsx:322-329`: the boot spinner becomes `<Spinner size="md" label={t('common.loading')} labelVisibility="auto" />` inside the existing `boot-screen` status. F19's slow copy is later.
  - `frontend/src/design/loading-guard-baseline.json`: remove `LoginModal.tsx`, `SyncProgressPanel.tsx` and `App.tsx`.
- Tests:
  - `frontend/src/core/common/SyncProgressPanel.test.tsx` (extend);
  - `frontend/src/shell/components/syncScreens.test.tsx` (keep green).
- Locales and `loadingUx.test.ts`.

**Strings** (Japanese reference):

| key | ja | en | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `login.waitingSlow` | ログイン画面を開いています… | Opening the sign-in window… | 正在開啟登入視窗… | 正在打开登录窗口… | 開緊登入視窗… |
| `login.waitingVerySlow` | 開いたブラウザのウィンドウでログインを完了してください。いつでもキャンセルできます。 | Finish signing in in the browser window that opened. You can cancel at any time. | 請在開啟的瀏覽器視窗中完成登入。你可以隨時取消。 | 请在打开的浏览器窗口中完成登录。你可以随时取消。 | 請喺開咗嘅瀏覽器視窗完成登入。你隨時可以取消。 |
| `login.finishing` | まもなく完了します… | Almost done… | 即將完成… | 即将完成… | 就快搞掂… |
| `sync.preparing` | 同期の準備中… | Getting ready to sync… | 正在準備同步… | 正在准备同步… | 準備緊同步… |
| `sync.preparingVerySlow` | 新しいメッセージを確認しています。メッセージが多いと少し時間がかかります。 | Checking for new messages. A large archive takes a little longer. | 正在檢查新訊息。訊息多時會花一點時間。 | 正在检查新消息。消息多时会花一点时间。 | 檢查緊新訊息。訊息多會耐少少。 |

- [ ] **Step 1:** Write failing backend tests. Inject a fake `BrowserAuth.login` that awaits an `asyncio.Event` forever.
  - `cancel_login` during a login cancels it, releases `_browser_lock`, clears `_active_login_task`, saves no credentials, and returns `True`.
  - With no login in flight, it returns `False`.
  - API:
    - `POST /login` concurrent with `POST /login/cancel` → the login answers 409 `login_cancelled` and the cancel answers `{"cancelled": true}`;
    - an unknown service → 400;
    - a cancel after success → `{"cancelled": false}`, and the credentials stay saved.
  - `capture_logs`: `login_cancel` carries `service` and `outcome` only (no `session_dir`, no path).
- [ ] **Step 2:** Write failing `LoginModal` tests (fake timers; `/api/auth/login` held by a deferred promise):
  - after clicking Login: Login is `aria-busy`; Cancel and × are **enabled** (no `disabled`, no `aria-disabled`); Escape is not swallowed;
  - 3000 ms → 「ログイン画面を開いています…」; 10000 ms → the very-slow copy;
  - Cancel → the fetch is aborted, `POST /api/auth/login/cancel?service=…` is sent, the lock is released (`isLoginBusy()` false), `onClose` is called, no error text, `ui_wait login cancelled` is logged;
  - × and Escape behave the same;
  - a 409 `login_cancelled` response is treated as a cancel;
  - the POST answers OK → `finishing`: Cancel shows `disabledReason` 「まもなく完了します…」 and no cancel request is sent;
  - a failure → the existing error text;
  - a second dialog mounted while busy can cancel;
  - the Yodel geo check shows loading immediately.
- [ ] **Step 3:** Write failing `SyncProgressPanel` tests:
  - `running` with `total 0` → 「同期の準備中…」, an indeterminate bar (no `aria-valuenow`), and no "0 / 0" or "0%" text; at 10 s the very-slow copy;
  - `total` arrives → the determinate bar with today's numbers;
  - `complete` → unchanged;
  - `queued` with `total 0` → the indeterminate bar.
- [ ] **Step 4:** Run `uv run pytest backend/tests/test_auth_api.py backend/tests/test_auth_service.py -q` and `cd frontend && npx vitest run src/shell src/core/common src/i18n/loadingUx.test.ts`. Expect FAIL.
- [ ] **Step 5:** Implement.
- [ ] **Step 6:** Run Step 4's commands, `uv run mypy backend/services/auth_service.py backend/api/auth.py`, `uv run ruff check backend/api/auth.py backend/services/auth_service.py`, `npx vitest run src/design/guard.test.ts` and `npx tsc --noEmit`. Expect PASS.
- [ ] **Step 7:** Two commits, staged by file:
  - `fix(login): keep cancel available while signing in` (backend auth, `loginLock.ts`, `LoginModal.tsx`, tests and locales);
  - `fix(sync): show a scanning state before totals arrive` (`SyncProgressPanel.tsx`, `App.tsx`, tests and locales).

### Task L7: Share dialog preview and photo gate; last status and spinner migrations

**Findings and must-items:**
- Must #11, F32: the preview canvas stays blank until the photos and fonts load (`features/memories/recap/share/ShareDialog.tsx:192-205`, canvas at `:396`). An export started before the photos settle **silently uses `NO_ASSETS`** (`:254`). A photo load failure also becomes `NO_ASSETS` without telling the user (`:160`).
- Requirement 2 completion: the two gallery callers of the `DialogStatus` adapter, `core/media/MediaGalleryModal.tsx:444`, `:530` (after media M6) and `features/blogs/components/BlogPhotoGalleryModal.tsx:186`, `:216`, `:218` (after media M7), move to `StatusBlock`. Then the adapter is deleted. F14: if M7 shipped no error state separate from empty, add `StatusBlock kind="error"` with Retry there.
- F39 leftovers: `shell/components/SettingsModal.tsx` (5 raw spinners and a bare `{t('common.loading')}` at `:999`). This task runs after media M4, which edits that file.

**Files:**
- Modify `frontend/src/features/memories/recap/share/ShareDialog.tsx`:
  - **Preview:** a `previewDrawn` state, set after the first successful draw in the `:192-205` effect and reset on open. Until it is set, overlay the canvas box with `Skeleton shape="block" tone="sunken"` (same `aspect-[9/16] w-48`), plus a `Spinner size="sm" label={t('recap.share.previewLoading')}` revealed after 200 ms. The overlay is `aria-hidden` except for the spinner's status.
  - **Export gate:**
    - while `assets === null`, all three export buttons get `disabledReason={t('recap.share.preparingPhotos')}` (combined with the existing `blockedBy`: the busy reason wins while an export runs);
    - `runExport` never reaches `assets ?? NO_ASSETS` with `assets === null`. It returns early and logs `logRecapShare('export_blocked', { reason: 'assets_pending' })`. If `export_blocked` / `assets_pending` are not yet in `backend/tests/fixtures/memories_log_codes.json`, add them there; `memoriesLog.test.ts` and `test_client_log_api.py` read that fixture.
  - **Assets timeout:** `SHARE_ASSETS_TIMEOUT_MS = 15_000` around `loadShareAssets`. On timeout or failure, set `NO_ASSETS` **and** `assetsFailed = true`, shown as a `text-small text-secondary` status line 「写真を読み込めなかったため、写真なしで書き出します。」 above the buttons. Exports are then allowed, and the user knows.
  - **Export progress:** the footer's inline `role="progressbar"` (`:355-365`) becomes `ProgressBar` (determinate, the same label).
- Modify `frontend/src/core/media/MediaGalleryModal.tsx`: the `DialogStatus` empty states become `StatusBlock kind="empty"`. Any loading or error state M6 added uses `StatusBlock` (`surface="media_gallery"`).
- Modify `frontend/src/features/blogs/components/BlogPhotoGalleryModal.tsx`: loading, empty and no-backup become `StatusBlock`, plus `kind="error"` with Retry if missing (`surface="blog_gallery"`).
- Delete `frontend/src/core/common/DialogStatus.tsx` and `DialogStatus.test.tsx`. A `timeout 60 grep -rn "DialogStatus" frontend/src` must show no hits.
- Modify `frontend/src/shell/components/SettingsModal.tsx`: its 5 raw spinners become `Spinner`, and the `:999` loading text becomes `Spinner` with `label={t('common.loading')}` (`labelVisibility="always"`). If M4's thumbnail-cache row uses a raw bar, switch it to `ProgressBar`.
- Modify `frontend/src/design/loading-guard-baseline.json`: it must now be `{}`. If any entry remains, convert that file here; the list in L1–L7 covers every file in the L1 baseline.
- Tests:
  - `recap/share/ShareDialog.test.tsx` (extend);
  - `MediaGalleryModal.rC.test.tsx` and `.grid.test.tsx`;
  - `BlogPhotoGalleryModal.test.tsx`;
  - the `SettingsModal` tests.
- Locales and `loadingUx.test.ts`.

**Strings** (Japanese reference):

| key | ja | en | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `recap.share.previewLoading` | プレビューを準備中… | Preparing the preview… | 正在準備預覽… | 正在准备预览… | 準備緊預覽… |
| `recap.share.preparingPhotos` | 写真を準備中… | Preparing photos… | 正在準備照片… | 正在准备照片… | 準備緊相… |
| `recap.share.photosUnavailable` | 写真を読み込めなかったため、写真なしで書き出します。 | Photos couldn't load, so the export will have no photos. | 照片無法載入，匯出的內容將不含照片。 | 照片无法加载，导出的内容将不含照片。 | 相載入唔到，匯出嘅內容唔會有相。 |

- [ ] **Step 1:** Write failing `ShareDialog` tests (`loadShareAssets` mocked with a deferred promise; canvas stubbed):
  - on open: the skeleton overlay is present; the spinner appears at 200 ms, not at 199;
  - the export buttons are `aria-disabled` with the title 「写真を準備中…」, and clicking one starts no export (spy on `runExport` internals / `recordVideo`);
  - assets resolve → the first draw → the overlay is gone and the buttons are enabled;
  - assets reject or time out at 15 s → the 「写真を読み込めなかったため…」 line, the buttons enabled, and an export uses no photos;
  - export progress renders `ProgressBar` with `aria-valuenow`;
  - the existing share tests stay green.
- [ ] **Step 2:** Write failing gallery and settings tests:
  - the media gallery's empty tabs render `StatusBlock` empty (same text and icon);
  - the blog gallery's loading is delayed 200 ms, empty and no-backup are unchanged, and an error shows Retry, which refetches;
  - each `SettingsModal` spinner is a `Spinner` with `motion-reduce:animate-none`;
  - the guard: `loading-guard-baseline.json` equals `{}`.
- [ ] **Step 3:** Run `cd frontend && npx vitest run src/features/memories/recap src/core/media src/features/blogs src/shell src/design src/i18n/loadingUx.test.ts`. Expect FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run Step 3's command, `npx tsc --noEmit`, and `uv run pytest backend/tests/test_client_log_api.py -q` if a Memories log code was added. Expect PASS.
- [ ] **Step 6:** Three commits, staged by file:
  - `fix(recap): show the share preview loading and wait for photos`;
  - `refactor(ui): finish the move to StatusBlock and drop DialogStatus`;
  - `refactor(settings): use the shared spinner in settings`.

### Task L8: Whole-wave verification (Linux, then Windows CDP screenshots)

**Files:**
- Modify `CHANGELOG.md` `[Unreleased]`: one end-user line per `docs/DOC_FORMATS.md` (a bold lead-in, at most 3 sentences, no code identifiers), next to the 0.5.0 entries. For example: **Waiting is always visible.** Chats, Memories and dialogs now show a clear loading state, say when something takes longer than usual, and offer a retry if it times out. Signing in can be cancelled at any time.
- No other new code. Fix whatever the checks find inside the task that owns the file.

- [ ] **Step 1: Full frontend:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk/frontend
npx tsc --noEmit
npx vitest run
```

  The run includes:
  - `src/design/guard.test.ts`: 0 style violations in new files, and the loading ratchet at `{}`;
  - `src/i18n/loadingUx.test.ts` (5 locales) and `src/i18n/designSystem.test.ts`.
- [ ] **Step 2: Backend:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
uv run pytest backend/tests -q
uv run mypy backend/services/auth_service.py backend/api/auth.py backend/api/client_log.py
uv run ruff check backend && uv run ruff format --check backend
```

  The keyring test that fails headless is pre-existing (memory `keyring-test-fails-headless`). Note it and do not count it as a regression.
- [ ] **Step 3: Hygiene greps.** Expect no hits.

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
timeout 60 grep -rn "animate-spin" frontend/src --include=*.tsx | grep -v "\.test\." | grep -v "design/primitives/"
timeout 60 grep -rnE "LoadState|DialogStatus|BlogStatus" frontend/src
timeout 60 grep -rnE "disabled=\{isLoading\}" frontend/src/shell/components/LoginModal.tsx
timeout 60 grep -rnE "logWait\([^)]*(name|path|text|title|message)" frontend/src
timeout 60 grep -rnE "logger\.(info|warning|error)\([^)]*(path|session_dir)=" backend/api/auth.py
```

- [ ] **Step 4: Linux smoke (dev server).** Open `?view=design`, then the loading section. Play a wait and watch it go nothing → spinner → slow → very slow. Toggle the OS reduced-motion setting, or emulate it in the dev browser: spinners are static with visible labels, and skeletons do not pulse.
- [ ] **Step 5: Windows build** (the verify copy, as in `.superpowers/sdd/windows-acceptance.md` § Build; skip the build if media M9 just built the same commit):
  - in `C:\D\saka-verify\SakaDesk`, run `git fetch` and `git checkout -B feat/memories origin/feat/memories`, then `.\build.ps1 -ExeOnly`;
  - launch `dist\SakaDesk\SakaDesk.exe` with `SAKADESK_DATA_DIR=C:\D\saka-verify\appdata`, CDP on 9222 and `-WorkingDirectory` set to the exe dir. Close the live app if it holds the single-instance guard.
- [ ] **Step 6: Windows CDP check of each fixed wait (page screenshots only).**
  - **Tooling:** a throwaway CDP script on the Windows side under `C:\D\saka-verify\tools\` (for example `uv run --with websocket-client python cdp_waits.py`; nothing is added to the project). It attaches to the app's **page** target on 9222 and uses:
    - `Fetch.enable` with URL patterns to **hold** a request;
    - `Page.captureScreenshot` at fixed offsets;
    - `Fetch.continueRequest`, `Fetch.failRequest` or `Fetch.fulfillRequest` to release it;
    - `Emulation.setEmulatedMedia` (`prefers-reduced-motion: reduce`) for the reduced-motion pass.
  - **Shots:** for every row, take a screenshot at **0.1 s** (expect nothing new), **0.5 s** (the indicator), **3.5 s** (slow copy) and **11 s** (the explanation plus Cancel or a bar). Where a timeout exists, also take one after it. Then release the request and take a **loaded** shot. Save them to `C:\D\saka-verify\shots\loading\<row>-<offset>.png`.

  | Row | Finding | How to hold | Extra shot |
  |---|---|---|---|
  | `chat-switch` | F1, F3 | hold `/api/content/messages/*` or `group_messages/*` for an uncached room, then click it | `fail` → error plus Retry |
  | `chat-letters` | F2 | let messages through; hold the letters request | after 3 s the list renders |
  | `hub-first` | F27, F22 | hold `/api/memories/*/hub` and reload Memories | 20 s → timeout copy plus Retry (differs from the error shot) |
  | `hub-gathering` | F27 | `Fetch.fulfillRequest` `/hub` with the real body plus `"refreshing": true` | the gathering line visible; the next poll fulfilled with `false` → gone |
  | `album-bands` | F28 | hold `/api/memories/*/album/2*` (month payloads) | skeleton tiles plus the page wait line |
  | `memoir-step` | F24 | open a timeline, hold the next month, step › | the previous month dimmed plus a thin top bar |
  | `member-pane` | F25 | hold `/album/members` | skeleton rows; `fail` → inline Retry |
  | `login` | F17 | open the login dialog, hold `/api/auth/login` | at 11 s, click Cancel through `Runtime.evaluate`: the dialog closes and `/login/cancel` is sent. **Then `Fetch.failRequest` the held login so it never reaches the backend** (the Windows login is reused; never start a real login) |
  | `sync-scan` | F16 | `Fetch.fulfillRequest` `/api/sync/progress` with `{"state":"running","phase":"scanning","total":0,"completed":0}` | the indeterminate bar plus 「同期の準備中…」, no "0 %" |
  | `bubble-photo` | F5 | hold `/api/content/media/*` for one bubble picture | the pulse at 0.5 s, the reduced-motion spinner plus label in the reduced pass |
  | `share` | F32 | open recap → share, hold `/api/content/thumb/*` used by the share photos | the preview skeleton plus disabled export buttons with the reason |
  | `reduced-motion` | F11, F20, F39 | `Emulation.setEmulatedMedia` reduce; repeat `chat-switch`, `hub-first` and the design page | every spinner static with a visible label |

  - **Checks** (record pass or fail per row):
    - the 0.1 s shot shows no new indicator;
    - from 0.5 s a visible indicator, **never a blank area**;
    - copy at 3.5 s and 11 s;
    - a Cancel or bar at 11 s;
    - the timeout copy differs from the error copy.
  - **Record** the results in `.superpowers/sdd/loading-ux-verify.md`, with the shot paths.
- [ ] **Step 7: Logs.** In `C:\D\saka-verify\appdata` logs, read single known files by exact path. `ui_wait` lines carry only `surface`, `phase` and `wait_ms`. `login_cancel` carries `service` and `outcome`.
- [ ] **Step 8:** Record in the ledger (`.superpowers/sdd/progress.md`): pass or fail per row, the guard state and follow-ups. The audit's 0.5.x "Later" list is the follow-up backlog.
- [ ] **Step 9:** Commit `docs(changelog): note clearer loading states across the app`.

---

## Decisions for the user

- **D-L1: waits that cannot be cancelled (recommended: explanation plus an indeterminate bar, the rest of the screen stays usable).** The rule says "explanation plus Cancel or progress at 10 s". Several waits have no job to cancel and no measurable progress:
  - the hub's first build;
  - a Memories view load;
  - a large chat room (one `limit=0` request);
  - album bands.

  For these, the plan shows the explanation plus an **indeterminate** `ProgressBar`, and relies on the surrounding UI staying usable: the hub's entry cards, the room list, the member pane, and `PageHeader`'s back. It adds no "Stop" button that would only navigate away.
  - **Alternative A:** add an explicit "Back" / "Stop waiting" button at 10 s on every such surface.
  - **Alternative B:** expose real progress from the backend (index build percent, room size), which is not 0.5.0-sized.
- **D-L2: chat load timeout (recommended: 60 s).** Today the room fetch has no timeout, so a hung request spins forever. L5 adds `CHAT_LOAD_TIMEOUT_MS = 60_000` with the timeout copy and Retry. A full-room `limit=0` load of the largest room on the acceptance machine is well under that, but if you have rooms that legitimately take longer, choose a larger value.
- **D-L3: an album member or filter switch keeps the previous months dimmed (recommended: yes).** L3 extends the album's existing "kept while the cover changes" behaviour to member and filter switches within the same filter scope, the Spotify-style dim-and-swap. The alternative is the band skeletons on every switch (L4), which is more visual churn.

## Self-review

**Requirement coverage:**

| Requirement | Where |
|---|---|
| L1 first; media M5's `MediaTile` consumes it | L1; "Execution order" (L1 before M1); "Shared contracts → Media hand-off" (`Skeleton tone="data"`, compact `Spinner`, `StatusBlock` / `ProgressBar` for grid states); the dispatcher note for M5's brief |
| Timing tokens reveal 200 / slow 3 s / verySlow 10 s / min-visible 400 ms | L1 `motion.loading` + CSS vars; `settleDelay`, `useLoadingStages`, `useDelayedLoading` |
| `Spinner`, static and labelled under reduced motion | L1 (`motion-reduce:animate-none`, `sr-only motion-reduce:not-sr-only`, `compact` exception documented) |
| `Skeleton`, pulse off under reduced motion | L1 `SKELETON_PULSE` |
| `StatusBlock` loading / empty / error / timeout / slow | L1 (staged loading, required Retry by type, distinct timeout copy and icon) |
| `ProgressBar` determinate and indeterminate | L1; adopted in L2 (upgrade), L4 (album line), L6 (sync), L7 (share), and by StatusBlock at 10 s |
| `useDelayedLoading` / keep-previous helper | L1 `useDelayedLoading`, `useKeepPrevious`, `BusyContent`; L3 `useMemoriesQuery` `keepPrevious` |
| Tokens only; documented in DESIGN_SYSTEM.md; on `?view=design` | Global Constraints; L1 DS sections and the `DesignPage` loading section with a live wait |
| Guard flags new hand-built spinners | L1 loading ratchet in `guard.ts` / `guard.test.ts`; lowered in L2, L3, L5, L6, L7; `{}` asserted in L7 and L8 |
| `LoadState`, `DialogStatus`, `BlogStatus` → `StatusBlock`, no behaviour change beyond feedback | L2 (`DialogStatus` adapter plus direct callers, `BlogStatus` deleted), L3 (`LoadState` deleted, recap `Status`), L7 (gallery callers, adapter deleted); the migration rule in Global Constraints |
| F1, F2 blank chat (with F3, F4) | L5 (`roomPending`, `lettersPending`, `ChatSkeleton`, timeout and error with Retry) |
| F27 hub first run / gathering | L4 |
| F28 album month bands | L4 (band skeleton plus the page wait line) |
| F17 login trap | L6 (cancel endpoint, `cancelLogin`, enabled Cancel / × / Escape, `Button loading`, staged copy, `finishing` guard) |
| F39 reduced-motion spinners (with F11, F20) | L2 (7 spinners plus the remaining raw spinners), L5 (`:799`), L6 (sync, login, boot), L7 (settings), L1 (`Button`) |
| Remaining musts: F22 / F23 (L3), F24 / F25 (L3), F16 (L6), F5 (L5), F32 (L7) | as listed |
| Finding id and file:line cited per item | each task's "Findings" paragraph |
| Not duplicating the media plan (F14, F26, F40) | the header's "Not in this plan"; L7 only swaps state components in the M6 / M7 files after they land |
| Interleaving / conflict map | "Execution order" table |
| Binding constraints copied | Global Constraints |
| 5–8 tasks ending with whole-wave verification, Windows CDP screenshots only | L1–L8; L8 Step 6 table (one row per fixed wait, held via `Fetch`, screenshots via `Page.captureScreenshot`) |
| Tests for loading, slow, error, timeout and loaded per fix | every task's Step 1–3 (stage boundaries at 199 / 200 / 3000 / 10000 ms, error vs timeout copy, loaded) |

**Placeholders:** none. Every task names its files, interfaces, strings, tests, commands and commit messages. Three points are conditional by design, and each has a defined default:
- L7 adds the blog-gallery error state only if M7 did not;
- L7 switches M4's settings row to `ProgressBar` only if that row has a raw bar;
- L7 adds the share `export_blocked` log code to the fixture only if it is missing.

**Name consistency:** the same names are used throughout:
- `motion.loading` (`reveal`, `slow`, `verySlow`, `minVisible`);
- `LoadingStage` (`hidden|shown|slow|verySlow`) and `WaitPhase` (`slow|very_slow|timeout|cancelled`);
- `settleDelay`, `useLoadingStages`, `useDelayedLoading`, `useKeepPrevious`, `logWait`;
- `Spinner`, `Skeleton` (`SKELETON_PULSE`), `ProgressBar`, `BusyContent`, `StatusBlock`, `MemoriesStatus`, `ChatSkeleton`;
- the `ui_wait` event with `surface`, `phase` and `wait_ms`;
- `loading-guard-baseline.json` and `UPDATE_LOADING_BASELINE`;
- `CHAT_LOAD_TIMEOUT_MS`, `SHARE_ASSETS_TIMEOUT_MS`, `BAND_SKELETON_MAX`;
- `cancel_login`, `POST /api/auth/login/cancel`, `login_cancel`, `cancelLogin`.

**Risks and mitigations:**
- **Min-visible delays fast results by up to 400 ms.** It applies only once an indicator was actually shown (elapsed > 200 ms), so fast loads are never delayed. Covered by the `settleDelay` and query tests.
- **Many existing tests assert an indicator at 0 ms.** The migration rule allows advancing 200 ms in those tests, and the commit says so. No test may be deleted to pass.
- **Cancelling the login task mid-browser.** It reuses the existing supersede path, which already closes the browser and releases the lock. Credentials are saved only after `BrowserAuth.login` returns, so a cancel can never leave half-written credentials. A cancel in `finishing` is refused by design.
- **CDP `Fetch` holds on Windows touch only the app's page target.** The held login is always failed, never continued, so no login reaches the backend during verification.
