# UI Health G — Accessibility and Keyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Second of three plans for the UI-health findings of the 0.5.0 audit (`/home/xtorker/repos/Project-Saka/audits/2026-11-13-sakadesk-0.5.0/ui/UI-HEALTH-REPORT.md` and `report-accessibility.md`). It is independent of **F** (performance) and **H** (CSS and theming); where they touch the same files each task names the exact element it edits and says how to merge. Recommended order F → G → H. **H Task 2** (forced colours) styles the ARIA states this plan adds (`aria-current`, `aria-selected`, `aria-pressed`); **H Task 3** owns `InlineTranslation.tsx` (its contrast, `aria-expanded` and `lang`), so this plan does not edit that file.

**What this plan closes** (`#n` = UI-HEALTH-REPORT priority; `A-xx` = row of Appendix A, from `report-accessibility.md`):

| Task | Closes |
|---|---|
| 1 | #3, A-K1 (+ perf P-A3): the unread shelter is a `<div onClick>`; hidden bubbles stay tabbable; "reveal all" only by long-press |
| 2 | #5, A-K2, A-D4 (+ perf P-B4, P-F2): the search dialog eats Tab and Enter; no combobox semantics; ↑/↓ fire during IME; results re-render on hover; stale searches |
| 3 | #7, A-M1: video controls unnamed, invisible seek focus, controls hide while focused, Space on buttons |
| 4 | #7, A-M2 (+ perf P-B8): voice controls unnamed, volume slider hidden but tabbable, one window key listener per bubble |
| 5 | #15 interim, A-D1, A-D6: background never inert; covered content focusable |
| 6 | A-D2, A-S6: toasts mount with their text; settings error toast unreachable over Settings; setting descriptions not linked |
| 7 | A-D3 (+ CSS lens "menu item focus 1.1:1"): menus focus the container; focused item has no visible ring |
| 8 | A-K3, A-K5: chat photos open only by mouse; viewers have no older/newer buttons; viewer arrows steal slider keys |
| 9 | A-S5, A-K7, A-S1, A-S2, A-S3: no `<main>`/skip link; timeline unnamed and Home/End ignore the target; selected conversation and session-expired state not exposed; Badge label on a span; calendar days named by number |
| 10 | #12 (transcript part), A-C1, A-M3, A-C3, A-C4, A-S4 (transcript part): transcript text 2.5–3.7:1; segments are divs; muted-on-sunken 4.39:1; About heart has no focus ring |
| 11 | A-K4, A-K8, A-K6, A-D5: ★ only in a context menu; follow-up time only on hover; service reorder by drag only; tabs without arrow keys |
| 12 | CHANGELOG and final verification |

**Goal:** Every action in SakaDesk can be reached and understood with a keyboard and a screen reader, without changing the accepted look for mouse users.

**Architecture:** Native elements first (buttons for the shelter, the photo and transcript segments; a combobox/listbox for search); names through translated `aria-label`s on the existing controls (no restyle); one `useInert` hook makes covered content and the background inert while dialogs are open (an interim to native `<dialog>`); one always-mounted `LiveRegion` primitive announces transient messages. Keyboard alternatives for pointer-only actions reuse existing menus and primitives.

**Tech Stack:** React 18.3, TypeScript 5 (strict), Tailwind 3.4, i18next; vitest 4 + Testing Library + user-event + msw 2; Playwright 1.57 (built-in role/name assertions). No new dependencies.

## Global Constraints

- Worktree: `/home/xtorker/repos/Project-Saka/SakaDesk-hardening`, branch `fix/050-security-hardening`. **Re-read every file before editing it and match code by text, not line number.** Where another plan already changed the element a step edits, keep its changes and add this step's attributes/classes to them (both are needed).
- Runtime: WebView2 (evergreen Chromium) only; current stable Chromium features without fallbacks (UI-HEALTH-REPORT §4).
- **UI design system is mandatory** (`SakaDesk-hardening/CLAUDE.md`, `docs/design/DESIGN_SYSTEM.md`): tokens and primitives only; no hex/`rgb()`/`hsl()`, no arbitrary radius/shadow/text/spacing values, no named palette classes in new code; `frontend/src/design/guard.test.ts` stays green (when a task removes literals, lower that file's entry in `frontend/src/design/guard-baseline.json`: `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts`, then check the diff only goes down). Focus rings follow DESIGN_SYSTEM §9 (2 px `ring-accent`). **No visual change for mouse users** except where the Decisions section names one.
- i18n: every new string has a key in all five locales (`frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json`, 2-space JSON, `ensure_ascii=False`, trailing newline). Tasks add keys with the script in Task 1 Step 1 and list them in `frontend/src/i18n/uiHealthAccessibility.test.ts`.
- Japanese content keeps `lang="ja"`; UI chrome is never marked.
- If `frontend/src/design/drift-guard-baseline.json` exists (Plan H Task 9), a task that removes palette classes, `z-40/50` or arbitrary values lowers it too: `UPDATE_DRIFT_BASELINE=1 npx vitest run src/design/guard.test.ts` (the diff only goes down).
- Breadcrumbs: new decision/skip/failure paths call `clientLog` with codes only (never text, names, URLs, paths).
- Frontend commands from `frontend/`: `npx vitest run <path>`, `npx tsc --noEmit`, `npm run lint` (0 errors, ≤ 20 warnings); snapshot updates with `npx vitest run <file> -u` followed by a review of the `.snap` diff. E2E: `npm run build && npx playwright test <spec> --reporter=line`, port 8000 free.
- Python: `uv run`, never pip.
- Commits: Conventional Commits `type(scope): subject`, imperative, ≤ 72 chars, no trailing period; `uv run git commit`; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- CHANGELOG under `## [Unreleased]` (`### Changed` / `### Fixed`), end-user wording, **bold lead-in**, ≤ 3 sentences, no code identifiers.
- WSL safety: never `find /` or scan `/mnt/*`; limit searches to the worktree with `-xdev`, exclude `node_modules`; wrap long searches in `timeout 60`.

## Decisions (reviewers: these are deliberate; the owner confirms the ones marked ⚑)

1. **Unread shelter = native `<button>`** named per kind ("Show unread photo"); the hidden bubble content is `inert` (its voice/video controls leave the Tab order and its text the accessibility tree). ⚑ **"Reveal all unread" becomes a ConversationMenu item** (Eye icon, accent like the other items; `disabledReason` when nothing is unread) opening the existing confirm. Long-press stays.
2. **Search is a combobox.** The field owns ↑/↓/Enter (`aria-activedescendant` over a `role="listbox"` of `role="option"` rows); Tab, Shift+Tab and Enter on any other control are native again; while an IME composes every key is left to it. Escape stays with the dialog layer (already IME-safe). The member suggestions become a plain group of buttons (they are actions, reached with Tab), and the filter input gets a keyboard focus ring. The main search field keeps no ring: it is the dialog's only text field, focused on open, and its caret is the indicator (⚑ owner may ask for a ring). Results are memoised and stale searches are aborted (perf report P-B4, P-F2).
3. **Player names without a restyle:** shared `media.*` keys name play/pause/mute/fullscreen and the ranges; ranges get `aria-valuetext` ("0:12 of 0:45", "70%"). ⚑ Keyboard focus on the seek range draws a 2 px `ring-accent` around the bar (keyboard focus only). Controls stay visible while focus is inside; Space on a focused button keeps the button's action. Voice: the volume slider shows while it has focus; inline shortcuts live on the player box (no window listener per bubble).
4. **Dialog layer, interim:** while any dialog is open, `#root` and every dialog below the top one are `inert`. **Native `<dialog>` + `showModal()` is won't-fix this wave:** the lifted incoming call's interleaved z-index (DESIGN_SYSTEM "Layering") and the toast layer depend on the custom stack; `inert` gives the background isolation the audit asked for now. Dialogs, portaled menus and the lifted call render in `<body>` outside `#root`, so they stay usable.
5. **Covered content is inert:** the off-canvas member sidebar while closed at narrow widths (reachable with 200 % zoom), the chat behind an open off-canvas sidebar, and the message list under an in-frame call.
6. **Announcements:** a `LiveRegion` primitive (always mounted, `role="status"`, polite). Clipboard toasts keep their look and announce through it. The settings error toast is suppressed while Settings or Setup is open (both already show the failure inline: Settings on the row, Setup by the folder field, which now also shows a generic save failure); setting rows link their description and error with `aria-describedby`, and the error line is a persistent live region.
7. ⚑ **Menus open on their first enabled item; items show `ring-2 ring-inset ring-accent` on keyboard focus** (today `bg-sunken`, 1.1:1). Mouse hover keeps `bg-sunken`.
8. **Chat photo = image inside a button** named "Open photo" (keyboard ring inset, like MediaTileButton). ⚑ **Older/newer overlay buttons** (`IconButton variant="overlay"`, chevrons, labels `media.older`/`media.newer`) on the photo viewer and the gallery detail, disabled-with-reason at the ends; arrows typed in a range input, a tab list or a menu are left to that control.
9. **Landmarks and names:** `<main id="sd-main">` around the content area; ⚑ one skip link ("Skip to content") as the first Tab stop, visible only while focused (brand sheet pill, top-left, toast layer); the chat timeline is a named `region` (it is focusable for keyboard scrolling, so it needs a role and name); Home/End jump only when the key was not typed into a control; selected conversation `aria-current="true"`; a disconnected group's name says "session expired"; Badge exposes its count as visually hidden text; calendar days are named with the full date (`dateStyle: 'full'`) plus the holiday.
10. ⚑ **Transcript text from tokens:** inactive lines `text-secondary` / `text-viewer-muted`, active `text-primary` / `text-viewer`, timestamps `text-muted` / `text-viewer-muted`, the hint `text-caption` (≥ 4.5:1 everywhere; inactive lines become darker on light surfaces and brighter on the viewer). Segments are buttons with `aria-current`. ⚑ YearStrip and the failed media tile use `text-secondary` on `bg-sunken` instead of `text-muted` (4.39:1 → 7:1). About's heart gets a keyboard ring.
11. **Keyboard paths for pointer-only actions:** ⚑ a ★ toggle (`aria-pressed`) in each bubble's trailing column, visible only while keyboard focus is in that row (mouse users see nothing new); the follow-up time also shows on keyboard focus; ⚑ the service rail menu (right-click, Shift+F10 or the Menu key) gains **Move up** / **Move down**; the media gallery and profile-image tabs follow the ARIA tabs pattern (arrows, Home/End, roving `tabIndex`, `role="tabpanel"`; no `aria-controls`, per the tabs guide).
12. **No new dependency:** Playwright's `toHaveAccessibleName` / `getByRole` replace `@axe-core/playwright`. ⚑ Adding axe as a dev dependency later is a reasonable follow-up (trusted, dev-only); not needed to verify this plan.
13. **`InlineTranslation.tsx` is Plan H Task 3's** (one owner per file): its contrast, `aria-expanded` and `lang` fixes are there.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/src/hooks/useInert.ts` | create if absent (Task 1; Plan F Task 5 creates the same file) | `inert` attribute hook |
| `frontend/src/features/messages/components/MessageBubble.tsx` | modify (Tasks 1, 8, 11) | shelter button, inert content, photo label, ★ toggle, focus time |
| `frontend/src/features/messages/components/ConversationMenu.tsx`, `frontend/src/features/messages/MessagesFeature.tsx` | modify (Tasks 1, 5, 9) | Reveal all item; inert covered content; timeline region |
| `frontend/src/features/search/**` | modify (Task 2) | combobox, listbox, memo, abort |
| `frontend/src/core/media/VideoPlayer.tsx`, `frontend/src/core/media/VoicePlayer.tsx` | modify (Tasks 3, 4, 6) | names, value text, focus, key scope, live clipboard |
| `frontend/src/design/dialog/dialogStack.ts` | modify (Task 5) | inert background and lower dialogs |
| `frontend/src/design/primitives/LiveRegion.tsx` | create (Task 6) | always-mounted polite status |
| `frontend/src/shell/App.tsx`, `frontend/src/shell/components/SettingRow.tsx`, `frontend/src/core/media/{MediaGalleryModal,PhotoDetailModal}.tsx` | modify (Tasks 6, 8, 9, 11) | toast placement, row descriptions, live toasts, step buttons, tabs |
| `frontend/src/design/primitives/Menu.tsx` | modify (Task 7) | first-item focus, focus ring |
| `frontend/src/core/media/PhotoPlayer.tsx`, `frontend/src/core/media/StepButtons.tsx` | modify / create (Task 8) | photo button; older/newer overlay buttons |
| `frontend/src/core/layout/Layout.tsx`, `frontend/src/shell/components/SkipLink.tsx`, `frontend/src/features/messages/hooks/useTimelineKeyNav.ts`, `frontend/src/features/messages/components/MemberList.tsx`, `frontend/src/core/layout/ServiceRail.tsx`, `frontend/src/design/primitives/Badge.tsx`, `frontend/src/core/modals/CalendarModal.tsx` | modify / create (Tasks 9, 11) | landmarks, names, states, rail reorder |
| `frontend/src/core/media/TranscriptPanel.tsx`, `frontend/src/features/memories/onThisDay/YearStrip.tsx`, `frontend/src/core/media/grid/MediaTile.tsx`, `frontend/src/core/modals/AboutModal.tsx` | modify (Task 10) | readable text, segment buttons, focus ring |
| `frontend/src/features/messages/components/ProfileImageViewer.tsx` | modify (Task 11) | tabs keyboard |
| `frontend/src/i18n/locales/*.json`, `frontend/src/i18n/uiHealthAccessibility.test.ts` | modify / create (Tasks 1–4, 8, 9, 11) | strings |
| `frontend/e2e/a11y-keyboard.spec.ts` | create (Tasks 1, 2, 5, 9) | real-browser keyboard and name checks |

---

### Task 1: The unread shelter is a button; "Reveal all" is in the conversation menu

**Files:**
- Create (if absent): `frontend/src/hooks/useInert.ts`
- Modify: `frontend/src/features/messages/components/MessageBubble.tsx`, `frontend/src/features/messages/components/ConversationMenu.tsx`, `frontend/src/features/messages/MessagesFeature.tsx`
- Modify: `frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json`
- Create: `frontend/src/i18n/uiHealthAccessibility.test.ts`, `frontend/src/features/messages/components/MessageBubble.shelter.test.tsx`, `frontend/e2e/a11y-keyboard.spec.ts`
- Modify: `frontend/src/features/messages/components/ConversationMenu.test.tsx`, `frontend/src/features/messages/components/__snapshots__/MessageBubble.test.tsx.snap`

**Interfaces:**
- Produces: `useInert(ref, on)` (same file Plan F Task 5 creates); `ConversationMenu` props `unreadCount?: number`, `onRevealAll?: () => void`; module-level `ShelterOverlay` in `MessageBubble.tsx`.

- [ ] **Step 1: Add the strings and their presence test**

Run from `frontend/` (the same script shape is reused by later tasks with their own `ADD`):

```bash
uv run python - <<'EOF'
import json, pathlib
ADD = {
    'en': {'messageList.revealUnread.text': 'Show unread message', 'messageList.revealUnread.picture': 'Show unread photo',
           'messageList.revealUnread.video': 'Show unread video', 'messageList.revealUnread.voice': 'Show unread voice message',
           'conversationMenu.revealAll': 'Reveal all unread', 'conversationMenu.revealAllNone': 'Nothing is unread in this chat'},
    'ja': {'messageList.revealUnread.text': '未読のメッセージを表示', 'messageList.revealUnread.picture': '未読の写真を表示',
           'messageList.revealUnread.video': '未読の動画を表示', 'messageList.revealUnread.voice': '未読のボイスを表示',
           'conversationMenu.revealAll': '未読をすべて表示', 'conversationMenu.revealAllNone': 'このトークに未読はありません'},
    'zh-TW': {'messageList.revealUnread.text': '顯示未讀訊息', 'messageList.revealUnread.picture': '顯示未讀照片',
              'messageList.revealUnread.video': '顯示未讀影片', 'messageList.revealUnread.voice': '顯示未讀語音',
              'conversationMenu.revealAll': '顯示全部未讀', 'conversationMenu.revealAllNone': '此對話沒有未讀訊息'},
    'zh-CN': {'messageList.revealUnread.text': '显示未读消息', 'messageList.revealUnread.picture': '显示未读照片',
              'messageList.revealUnread.video': '显示未读视频', 'messageList.revealUnread.voice': '显示未读语音',
              'conversationMenu.revealAll': '显示全部未读', 'conversationMenu.revealAllNone': '此对话没有未读消息'},
    'yue': {'messageList.revealUnread.text': '顯示未讀訊息', 'messageList.revealUnread.picture': '顯示未讀相',
            'messageList.revealUnread.video': '顯示未讀片', 'messageList.revealUnread.voice': '顯示未讀語音',
            'conversationMenu.revealAll': '顯示晒所有未讀', 'conversationMenu.revealAllNone': '呢個對話冇未讀訊息'},
}
for lang, keys in ADD.items():
    p = pathlib.Path(f'src/i18n/locales/{lang}.json')
    d = json.loads(p.read_text(encoding='utf-8'))
    for dotted, value in keys.items():
        node = d
        *parents, leaf = dotted.split('.')
        for k in parents:
            node = node.setdefault(k, {})
        node[leaf] = value
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
EOF
git diff --stat -- src/i18n/locales
```

Expected: five files changed, only additions.

Create `frontend/src/i18n/uiHealthAccessibility.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Strings of the UI-health accessibility plan (G); each task appends its keys. */
const KEYS: readonly string[] = [
    // Task 1
    'messageList.revealUnread.text', 'messageList.revealUnread.picture', 'messageList.revealUnread.video',
    'messageList.revealUnread.voice', 'conversationMenu.revealAll', 'conversationMenu.revealAllNone',
];

const lookup = (data: unknown, dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], data);

describe('UI health accessibility strings', () => {
    it.each(Object.entries(locales))('%s has every key', (_code, data) => {
        for (const dotted of KEYS) expect(lookup(data, dotted), dotted).toBeTruthy();
    });
});
```

Run: `cd frontend && npx vitest run src/i18n/uiHealthAccessibility.test.ts`
Expected: PASS.

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/features/messages/components/MessageBubble.shelter.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import type { Message } from '../../../types';
import { MessageBubble } from './MessageBubble';

const msg = (over: Partial<Message> = {}): Message => ({
    id: 1, content: 'こんにちは', timestamp: '2024-01-15T10:30:00Z', type: 'text', is_favorite: false, ...over,
});

describe('MessageBubble unread shelter (UI health #3)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        server.use(
            http.get('/api/app-state/translations', () => HttpResponse.json({})),
            http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
        );
    });

    it('is a named button that Enter and Space reveal', async () => {
        const onReveal = vi.fn();
        render(<MessageBubble message={msg()} member_name="n" service="hinatazaka46" isUnread onReveal={onReveal} />);
        const shelter = screen.getByRole('button', { name: 'Show unread message' });
        shelter.focus();
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard(' ');
        expect(onReveal).toHaveBeenCalledTimes(2);
    });

    it('names the shelter by kind', () => {
        render(<MessageBubble message={msg({ type: 'picture', content: null, media_file: 'p/1.jpg' })} member_name="n" service="hinatazaka46" isUnread onReveal={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Show unread photo' })).toBeInTheDocument();
    });

    it('makes the hidden content inert, and live again once revealed', () => {
        const { rerender } = render(<MessageBubble message={msg()} member_name="n" service="hinatazaka46" isUnread onReveal={vi.fn()} />);
        expect(screen.getByText('こんにちは').closest('[inert]')).not.toBeNull();
        rerender(<MessageBubble message={msg()} member_name="n" service="hinatazaka46" isUnread={false} onReveal={vi.fn()} />);
        expect(screen.getByText('こんにちは').closest('[inert]')).toBeNull();
    });
});
```

Append to `frontend/src/features/messages/components/ConversationMenu.test.tsx` (new `describe`; add `userEvent` import `import userEvent from '@testing-library/user-event';`):

```tsx
describe('ConversationMenu reveal all (UI health #3)', () => {
    const open = (unreadCount: number, onRevealAll = vi.fn()) => {
        render(
            <ConversationMenu
                conversationPath="p"
                isGroupChat={false}
                messages={[]}
                memberName="テスト 🌸"
                onOpenCalendar={vi.fn()}
                letters={[]}
                lettersStatus="ready"
                onJumpToLetter={vi.fn()}
                unreadCount={unreadCount}
                onRevealAll={onRevealAll}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /./ }));
        return onRevealAll;
    };

    it('offers Reveal all unread and calls onRevealAll', async () => {
        const onRevealAll = open(3);
        await userEvent.click(screen.getByRole('menuitem', { name: /Reveal all unread/ }));
        expect(onRevealAll).toHaveBeenCalledTimes(1);
    });

    it('keeps the item focusable with a reason when nothing is unread', async () => {
        const onRevealAll = open(0);
        const item = screen.getByRole('menuitem', { name: /Reveal all unread/ });
        expect(item).toHaveAttribute('aria-disabled', 'true');
        await userEvent.click(item);
        expect(onRevealAll).not.toHaveBeenCalled();
    });
});
```

(The test file renders in the default language; add `beforeAll(async () => { await i18n.changeLanguage('en'); })` with `import i18n from '../../../i18n';` at the top of the new `describe` if the file has none.)

- [ ] **Step 3: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/features/messages/components/MessageBubble.shelter.test.tsx src/features/messages/components/ConversationMenu.test.tsx`
Expected: FAIL — no button named "Show unread message"; no `[inert]` ancestor; no "Reveal all unread" item.

- [ ] **Step 4: Create the inert hook (skip if it exists)**

If `frontend/src/hooks/useInert.ts` does not exist yet, create it:

```ts
import { useLayoutEffect, type RefObject } from 'react';

/**
 * Sets or removes `inert` on the element (no focus, no clicks, out of the accessibility tree).
 * Set directly because React 18 does not pass `inert` through as a boolean prop (same pattern as
 * BusyContent and listSnapshot).
 */
export function useInert(ref: RefObject<HTMLElement | null>, on: boolean): void {
    useLayoutEffect(() => {
        ref.current?.toggleAttribute('inert', on);
    }, [ref, on]);
}
```

- [ ] **Step 5: Rewrite the shelter as a module-level button**

In `frontend/src/features/messages/components/MessageBubble.tsx`:

(a) Add `import { useInert } from '../../../hooks/useInert';`.

(b) After `shelterKind`, add the component:

```tsx
interface ShelterOverlayProps {
    type: string;
    service?: string;
    /** The bubble's corner classes (the shelter covers the bubble exactly). */
    corners: string;
    /** Translated name, by kind ("Show unread photo"). */
    label: string;
    onReveal: () => void;
    /** Long-press (reveal all) start / end, as before. */
    onPressStart: () => void;
    onPressEnd: () => void;
}

/**
 * The official unread shelter over a hidden bubble. A native button, so Enter and Space reveal it
 * too (UI health #3); declared at module level, so a bubble re-render never remounts it.
 */
const ShelterOverlay: React.FC<ShelterOverlayProps> = ({ type, service, corners, label, onReveal, onPressStart, onPressEnd }) => {
    const kind = shelterKind(type);
    const Icon = SHELTER_ICONS[kind];
    const look = groupTokens[serviceGroupId(service ?? null)].official.shelterStyle;
    return (
        <button
            type="button"
            data-testid="unread-shelter"
            aria-label={label}
            className={cn(
                'absolute inset-0 z-10 flex cursor-pointer items-center justify-center transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                corners,
                SHELTER_CLASSES[kind][look],
            )}
            onClick={(e) => {
                e.stopPropagation();
                onReveal();
            }}
            onMouseDown={onPressStart}
            onMouseUp={onPressEnd}
            onMouseLeave={onPressEnd}
            onTouchStart={onPressStart}
            onTouchEnd={onPressEnd}
        >
            <Icon aria-hidden="true" className="h-8 w-8" />
        </button>
    );
};
```

(c) Inside `MessageBubbleComponent`: delete the inner `const ShelterOverlay = () => { ... };` block, and after the long-press handlers add:

```tsx
    const reveal = useCallback(() => onReveal?.(), [onReveal]);
    // The hidden bubble's own controls and text leave the Tab order and the accessibility tree.
    const contentRef = useRef<HTMLDivElement>(null);
    useInert(contentRef, isUnread);
```

(d) Replace `{isUnread && <ShelterOverlay />}` with:

```tsx
                    {isUnread && (
                        <ShelterOverlay
                            type={message.type}
                            service={service}
                            corners={bubbleCorners}
                            label={t(`messageList.revealUnread.${shelterKind(message.type)}`)}
                            onReveal={reveal}
                            onPressStart={handleTouchStart}
                            onPressEnd={handleTouchEnd}
                        />
                    )}
```

(e) Add `ref={contentRef}` to the bubble content `<div className={cn('border border-group-bubble bg-card shadow-card ...` element (the one that gets `isUnread && 'pointer-events-none opacity-0'`).

- [ ] **Step 6: Reveal all in the conversation menu**

In `frontend/src/features/messages/components/ConversationMenu.tsx`:

(a) Import `Eye` from `lucide-react` (add to the existing import list).

(b) Add to `ChatHeaderMenuProps`:

```tsx
    /** Unread messages in the room; 0 keeps "Reveal all unread" focusable with a reason. */
    unreadCount?: number;
    /** Opens the reveal-all confirm (MessagesFeature's ConfirmDialog). */
    onRevealAll?: () => void;
```

and destructure `unreadCount = 0, onRevealAll,`.

(c) In the `<Menu>`, after the `menuItems.map(...)`, add:

```tsx
                        {onRevealAll && (
                            <MenuItem
                                icon={<Eye className="h-4 w-4 text-accent" />}
                                disabledReason={unreadCount === 0 ? t('conversationMenu.revealAllNone') : undefined}
                                logTarget="reveal_all"
                                onClick={() => {
                                    setShowMenu(false);
                                    onRevealAll();
                                }}
                            >
                                {t('conversationMenu.revealAll')}
                            </MenuItem>
                        )}
```

In `frontend/src/features/messages/MessagesFeature.tsx`: if `openRevealConfirm` does not exist (Plan F Task 4 adds it), add after the `jumpToLetter` callback:

```tsx
    const openRevealConfirm = useCallback(() => setShowRevealConfirm(true), []);
```

and pass to `<ConversationMenu>`: `unreadCount={displayUnreadCount}` and `onRevealAll={openRevealConfirm}`.

- [ ] **Step 7: Run the tests and refresh the snapshot**

Run: `cd frontend && npx vitest run src/features/messages/components/MessageBubble.test.tsx -u && git diff -- src/features/messages/components/__snapshots__/MessageBubble.test.tsx.snap | head -60`
Expected: the unread snapshot's shelter `<div>` became `<button type="button" aria-label="…">` with the focus-visible classes and `aria-hidden` on its icon; the bubble content div gains `inert=""`; nothing else changes.

Run: `cd frontend && npx vitest run src/features/messages src/i18n`
Expected: PASS.

- [ ] **Step 8: Real-browser keyboard check**

Create `frontend/e2e/a11y-keyboard.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, TZ, type FixtureMessage } from './fixtures/bigRoom'

// Keyboard and screen-reader contracts that need a real browser (UI health plan G).

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

test.describe('keyboard access', () => {
  let messages: { current: FixtureMessage[] }

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    messages = { current: buildBigRoom() }
  })

  test('an unread message is revealed from the keyboard', async ({ page }) => {
    await pinBigRoom(page, { messages, lastReadId: COUNT - 1 })
    await page.goto('/')
    await page.getByText('Big Room', { exact: true }).click()
    const shelter = page.getByRole('button', { name: 'Show unread message' })
    await expect(shelter).toBeVisible({ timeout: 10000 })
    await shelter.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Show unread message' })).toHaveCount(0)
    await expect(page.locator(`#msg-${COUNT}`)).toContainText(`Message ${COUNT}`)
  })
})
```

Run: `cd frontend && npm run build && npx playwright test e2e/a11y-keyboard.spec.ts --reporter=line`
Expected: 1 passed.

- [ ] **Step 9: Commit**

```bash
git add frontend/src frontend/e2e/a11y-keyboard.spec.ts
uv run git commit -m "fix(a11y): reveal unread messages from the keyboard" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The search dialog is a combobox that leaves Tab, Enter and the IME alone

**Files:**
- Modify: `frontend/src/features/search/SearchModal.tsx`, `frontend/src/features/search/components/SearchInput.tsx`, `frontend/src/features/search/components/SearchResultList.tsx`, `frontend/src/features/search/components/SearchResultItem.tsx`, `frontend/src/features/search/components/SearchFilterBar.tsx`
- Modify: `frontend/src/features/search/SearchModal.test.tsx`, `frontend/src/features/search/components/SearchResultItem.test.tsx`, `frontend/src/features/search/rCSearch.test.tsx`, `frontend/src/features/search/components/SearchFilterBar.test.tsx`
- Modify: `frontend/src/i18n/locales/*.json`, `frontend/src/i18n/uiHealthAccessibility.test.ts`
- Create: `frontend/src/features/search/SearchModal.keyboard.test.tsx`
- Modify: `frontend/e2e/a11y-keyboard.spec.ts`

**Interfaces:**
- Produces: `SearchInput` props `onKeyDown: React.KeyboardEventHandler<HTMLInputElement>`, `listId: string`, `activeId?: string`, `expanded: boolean`; `SearchResultList` props `listId: string`, `onHover: (index: number) => void` (replaces `onMouseEnterItem`); `SearchResultItem` props `index: number`, `optionId: string`, `onHover: (index: number) => void` (replaces `onMouseEnter`), and it is `React.memo`.

- [ ] **Step 1: Add the string**

Run the Task 1 Step 1 script with:

```python
ADD = {
    'en': {'search.resultsLabel': 'Search results'},
    'ja': {'search.resultsLabel': '検索結果'},
    'zh-TW': {'search.resultsLabel': '搜尋結果'},
    'zh-CN': {'search.resultsLabel': '搜索结果'},
    'yue': {'search.resultsLabel': '搜尋結果'},
}
```

and append `// Task 2` + `'search.resultsLabel',` to `KEYS` in `uiHealthAccessibility.test.ts`.

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/features/search/SearchModal.keyboard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '../../store/appStore';
import { SearchModal, type SearchModalHandle } from './SearchModal';
import type { SearchResponse } from './types';

const result = (id: number) => ({
    result_type: 'message' as const, message_id: id, content: `m${id}`, snippet: `<mark>m</mark>${id}`,
    service: 'hinatazaka46', group_id: 34, group_name: 'G', member_id: 58, member_name: '金村 美玖',
    timestamp: '2026-11-04T10:00:00Z', type: 'text' as const, is_group_chat: false,
});
const RESPONSE: SearchResponse = { query: 'm', normalized_query: 'm', total_count: 2, has_more: false, results: [result(1), result(2)] };
const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body });

async function openWithResults() {
    const ref = createRef<SearchModalHandle>();
    render(<SearchModal ref={ref} />);
    act(() => ref.current!.open());
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'm' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    return input;
}

describe('SearchModal keyboard (UI health #5)', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn();
        useAppStore.setState({ activeService: 'hinatazaka46', selectedServices: ['hinatazaka46'], selectedConversations: {}, targetMessageId: null });
        vi.stubGlobal('fetch', vi.fn((url: string) => (url.startsWith('/api/search?') ? json(RESPONSE) : json({}))));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('is a combobox pointing at the highlighted option', async () => {
        const input = await openWithResults();
        const options = screen.getAllByRole('option');
        expect(screen.getByRole('listbox', { name: 'Search results' })).toBeInTheDocument();
        expect(input).toHaveAttribute('aria-expanded', 'true');
        expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
        expect(options[0]).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
    });

    it('lets Tab move focus to the next control instead of the selection', async () => {
        const input = await openWithResults();
        input.focus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus();
        expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('lets Enter on a focused button do its own job', async () => {
        await openWithResults();
        screen.getByRole('button', { name: 'Filters' }).focus();
        await userEvent.keyboard('{Enter}');
        expect(useAppStore.getState().targetMessageId).toBeNull();
        expect(screen.getByRole('textbox', { name: /Filter by member/ })).toBeInTheDocument();
    });

    it('leaves the arrows to the IME while it composes', async () => {
        const input = await openWithResults();
        fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: true });
        fireEvent.keyDown(input, { key: 'ArrowDown', keyCode: 229 });
        expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('drops a slower answer to an older query', async () => {
        const slow = { ...RESPONSE, results: [result(9)] };
        let resolveOld: (v: unknown) => void = () => {};
        vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
            if (!url.startsWith('/api/search?')) return json({});
            if (url.includes('q=old')) {
                return new Promise((resolve, reject) => {
                    resolveOld = () => resolve({ ok: true, status: 200, json: async () => slow });
                    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                });
            }
            return json(RESPONSE);
        }));
        const ref = createRef<SearchModalHandle>();
        render(<SearchModal ref={ref} />);
        act(() => ref.current!.open());
        const input = await screen.findByRole('combobox');
        fireEvent.change(input, { target: { value: 'old' } });
        await new Promise((r) => setTimeout(r, 350)); // past the debounce: the old request is in flight
        fireEvent.change(input, { target: { value: 'new' } });
        await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
        act(() => resolveOld(undefined));
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.getAllByRole('option')).toHaveLength(2);
    });
});
```

Update `frontend/src/features/search/SearchModal.test.tsx`:
- replace every `screen.findByRole('textbox')` / `screen.getByRole('textbox')` with `'combobox'`:
  `cd frontend && sed -i "s/ByRole('textbox')/ByRole('combobox')/g" src/features/search/SearchModal.test.tsx`
- rename the test "moves the selection with arrows and Tab, and Enter opens a blog with its highlight" to "moves the selection with the arrows, and Enter opens a blog with its highlight", and delete its four Tab lines:

```tsx
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(rows()[0]).toHaveClass('bg-accent-subtle');
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(rows()[1]).toHaveClass('bg-accent-subtle');
```

  so that after `ArrowDown` (row 1) the next `ArrowUp` expects row 0 (unchanged lines below).

Update the other search tests to the new contract:
- `frontend/src/features/search/components/SearchResultItem.test.tsx` and `frontend/src/features/search/rCSearch.test.tsx`: replace `onMouseEnter={vi.fn()}` with `index={0} optionId="o-0" onHover={vi.fn()}`:
  `cd frontend && sed -i 's/onMouseEnter={vi.fn()}/index={0} optionId="o-0" onHover={vi.fn()}/g' src/features/search/components/SearchResultItem.test.tsx src/features/search/rCSearch.test.tsx`
- `frontend/src/features/search/components/SearchFilterBar.test.tsx`: the member suggestions are buttons now — replace `screen.findByRole('option', { name: /山下 瞳月/ })` with `screen.findByRole('button', { name: /山下 瞳月/ })`.

- [ ] **Step 3: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/features/search`
Expected: FAIL — no `combobox`/`listbox`/`option` roles; Tab is swallowed; ↑/↓ move while composing; the old answer replaces the new one.

- [ ] **Step 4: Implement the combobox, memo and abort**

`frontend/src/features/search/components/SearchInput.tsx` — add to the props interface:

```tsx
  /** The field's keys (↑ / ↓ / Enter over the results); the dialog keeps every other control's keys. */
  onKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
  /** Id of the results listbox the field controls. */
  listId: string;
  /** Id of the highlighted option (aria-activedescendant), when there is one. */
  activeId?: string;
  /** True while results are listed. */
  expanded: boolean;
```

destructure them, and give the `<input>`:

```tsx
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={activeId}
        onKeyDown={onKeyDown}
```

`frontend/src/features/search/components/SearchResultItem.tsx`:
- import `useMemo` from React (`import React, { useMemo } from 'react';`);
- props: replace `onMouseEnter: () => void;` with

```tsx
  index: number;
  /** DOM id of the option (the field's aria-activedescendant). */
  optionId: string;
  /** Pointer over the row: highlights it (stable: the list passes setSelectedIndex). */
  onHover: (index: number) => void;
```

- rename the component to `SearchResultItemComponent` (same parameters, with `index, optionId, onHover` instead of `onMouseEnter`);
- replace the inline sanitize with a memo placed after `processedSnippet`:

```tsx
  // Sanitized once per snippet, not on every hover (UI health P-B4).
  const snippetHtml = useMemo(
    () => (processedSnippet
      ? DOMPurify.sanitize(processedSnippet.replace(/\r?\n/g, ' '), { ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: ['class'] })
      : null),
    [processedSnippet],
  );
```

  and use `dangerouslySetInnerHTML={{ __html: snippetHtml ?? '' }}`;
- the row's root `<div>` gets `id={optionId}`, `role="option"`, `aria-selected={isSelected}` and `onMouseEnter={() => onHover(index)}`;
- at the end: `export const SearchResultItem = React.memo(SearchResultItemComponent);`

`frontend/src/features/search/components/SearchResultList.tsx` — props: replace `onMouseEnterItem` with `onHover: (index: number) => void;` and add `listId: string;`; import `useTranslation` from `'../../../i18n'`; the container:

```tsx
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={t('search.resultsLabel')}
      className="max-h-[calc(60vh-120px)] overflow-y-auto px-2 py-1"
    >
      {results.map((result, index) => (
        <SearchResultItem
          key={result.result_type === 'message' ? result.message_id : result.blog_id}
          result={result}
          index={index}
          optionId={`${listId}-${index}`}
          isSelected={index === selectedIndex}
          onSelect={onSelect}
          onHover={onHover}
          userNickname={userNicknames?.[result.service]}
        />
      ))}
    </div>
```

`frontend/src/features/search/SearchModal.tsx`:

(a) `import React, { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';` and add refs:

```tsx
  const listId = useId();
  // The running query's controller: a newer query (or closing) aborts it; load-more reads it to drop
  // results of a query that was replaced meanwhile.
  const searchAbortRef = useRef<AbortController | null>(null);
```

(b) Replace the debounced search effect with:

```tsx
  useEffect(() => {
    if (!query.trim() || isComposing) {
      setResults([]);
      setError(false);
      setIsLoading(false);
      setTotalCount(0);
      setHasMore(false);
      return;
    }

    setIsLoading(true);
    setError(false);
    const controller = new AbortController();
    searchAbortRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        const filterParams = buildFilterParams();
        const url = `/api/search?q=${encodeURIComponent(query.trim())}&limit=${PAGE_SIZE}&offset=0${filterParams ? '&' + filterParams : ''}`;
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data: SearchResponse = await response.json();
        if (controller.signal.aborted) return;
        // Show building banner if index is still being built, but
        // still render whatever partial results the backend returned.
        setIsIndexBuilding(!!data.is_building);
        setResults(data.results);
        logDialogLoad('search', 'ok', data.results.length);
        setTotalCount(data.total_count);
        setHasMore(data.has_more);
        setSelectedIndex(data.results.length > 0 ? 0 : -1);
      } catch (_err) {
        // Replaced by a newer query (or the dialog closed): not an error.
        if (controller.signal.aborted) {
          logDialogLoad('search', 'cancelled');
          return;
        }
        setError(true);
        logDialogLoad('search', 'error');
        setResults([]);
        setSelectedIndex(-1);
        setTotalCount(0);
        setHasMore(false);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, isComposing, buildFilterParams, searchGeneration]);
```

(c) In `handleLoadMore`, read the query's controller and drop replaced answers:

```tsx
    const controller = searchAbortRef.current;
    setIsLoadingMore(true);
    try {
      const filterParams = buildFilterParams();
      const url = `/api/search?q=${encodeURIComponent(query.trim())}&limit=${PAGE_SIZE}&offset=${results.length}${filterParams ? '&' + filterParams : ''}`;
      const response = await fetch(url, { signal: controller?.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: SearchResponse = await response.json();
      if (controller?.signal.aborted) return; // a newer query replaced this one
      setResults((prev) => [...prev, ...data.results]);
      setHasMore(data.has_more);
      setTotalCount(data.total_count);
      logDialogLoad('search_more', 'ok', data.results.length);
    } catch (_err) {
      if (controller?.signal.aborted) {
        logDialogLoad('search_more', 'cancelled');
        return;
      }
      // The button stays, so the user can try again.
      logDialogLoad('search_more', 'error');
    } finally {
      setIsLoadingMore(false);
    }
```

(d) Replace the keyboard handler with the field's handler:

```tsx
  // ─── Keyboard: the search field (a combobox) ───────────────────────────────
  // ↑ / ↓ move the highlighted result and Enter opens it. Every other control in the dialog keeps
  // its own keys (Tab, Enter on a button), and nothing is taken while an IME composes: its candidate
  // list uses the same keys. Escape is the dialog layer's (IME-safe).
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      switch (e.key) {
        case 'ArrowDown': {
          if (results.length === 0) return;
          e.preventDefault();
          setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
          break;
        }
        case 'ArrowUp': {
          if (results.length === 0) return;
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
          break;
        }
        case 'Enter': {
          if (selectedIndex >= 0 && selectedIndex < results.length) {
            e.preventDefault();
            handleNavigate(results[selectedIndex]);
          }
          break;
        }
      }
    },
    [results, selectedIndex, handleNavigate]
  );
```

(e) Remove `onKeyDown={handleKeyDown}` from `<Modal>`; pass to `<SearchInput>`:

```tsx
        onKeyDown={handleInputKeyDown}
        listId={listId}
        expanded={results.length > 0}
        activeId={selectedIndex >= 0 && selectedIndex < results.length ? `${listId}-${selectedIndex}` : undefined}
```

and to `<SearchResultList>`: `listId={listId}` and `onHover={setSelectedIndex}` (instead of `onMouseEnterItem`).

`frontend/src/features/search/components/SearchFilterBar.tsx` — the suggestions are actions reached with Tab, not a listbox:

```tsx
          {showDropdown && filteredItems.length > 0 && (
            <div role="group" aria-label={t('search.filterByMember')} className="absolute left-0 top-full mt-1 flex max-h-72 w-64 flex-col overflow-y-auto rounded-card bg-card p-1 shadow-card" style={{ zIndex: Z_INDEX.POPOVER }}>
              {filteredItems.map((item) => (
                <button
                  key={`${item.type}-${item.id}`}
                  type="button"
                  onClick={() => handleSelectItem(item)}
                  className="flex w-full items-center gap-2 rounded-pill px-3 py-2 text-left text-small transition-colors duration-fast ease-standard hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
```

(the button's children are unchanged) and give the member filter `<input>` a keyboard ring: replace its `outline-none` with `rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent`.

- [ ] **Step 5: Run the tests**

Run: `cd frontend && npx vitest run src/features/search src/i18n src/core/dialogs.style.test.ts`
Expected: PASS.

- [ ] **Step 6: Real-browser check**

Append to `frontend/e2e/a11y-keyboard.spec.ts` inside the `describe`:

```ts
  test('Tab leaves the search field for the filters and Enter on the filter button opens them', async ({ page }) => {
    await pinBigRoom(page, { messages })
    await page.route('**/api/search?*', (route) => route.fulfill({ json: {
      query: 'Message', normalized_query: 'Message', total_count: 1, has_more: false,
      results: [{ result_type: 'message', message_id: 7, content: 'Message 7', snippet: '<mark>Message</mark> 7', service: 'hinatazaka46',
        group_id: 1, group_name: 'Big Room', member_id: 1, member_name: 'Big Room', timestamp: '2022-01-02T03:00:00Z', type: 'text', is_group_chat: false }],
    } }))
    await page.goto('/')
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox')
    await input.fill('Message')
    await expect(page.getByRole('option')).toHaveCount(1)
    await expect(input).toHaveAttribute('aria-activedescendant', /.+/)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Filters' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('textbox', { name: /Filter by member/ })).toBeVisible()
  })
```

Run: `cd frontend && npm run build && npx playwright test e2e/a11y-keyboard.spec.ts e2e/dialogs-app.spec.ts --reporter=line`
Expected: all passed.

- [ ] **Step 7: Commit**

```bash
git add frontend/src frontend/e2e/a11y-keyboard.spec.ts
uv run git commit -m "fix(search): make the field a combobox and leave Tab to the dialog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The video player's controls have names, value text and a visible focus

**Files:**
- Modify: `frontend/src/core/media/VideoPlayer.tsx`
- Modify: `frontend/src/i18n/locales/*.json`, `frontend/src/i18n/uiHealthAccessibility.test.ts`
- Create: `frontend/src/core/media/VideoPlayer.a11y.test.tsx`

**Interfaces:**
- Produces: keys `media.play`, `media.pause`, `media.mute`, `media.unmute`, `media.seek`, `media.volume`, `media.timeOf`, `media.volumeValue`, `media.fullscreen`, `media.exitFullscreen` (Task 4 reuses them).

- [ ] **Step 1: Add the strings**

Run the Task 1 Step 1 script with:

```python
ADD = {
    'en': {'media.play': 'Play', 'media.pause': 'Pause', 'media.mute': 'Mute', 'media.unmute': 'Unmute',
           'media.seek': 'Playback position', 'media.volume': 'Volume', 'media.timeOf': '{{current}} of {{total}}',
           'media.volumeValue': '{{percent}}%', 'media.fullscreen': 'Full screen', 'media.exitFullscreen': 'Exit full screen'},
    'ja': {'media.play': '再生', 'media.pause': '一時停止', 'media.mute': 'ミュート', 'media.unmute': 'ミュート解除',
           'media.seek': '再生位置', 'media.volume': '音量', 'media.timeOf': '{{total}} 中 {{current}}',
           'media.volumeValue': '{{percent}}%', 'media.fullscreen': '全画面表示', 'media.exitFullscreen': '全画面表示を終了'},
    'zh-TW': {'media.play': '播放', 'media.pause': '暫停', 'media.mute': '靜音', 'media.unmute': '取消靜音',
              'media.seek': '播放位置', 'media.volume': '音量', 'media.timeOf': '{{current}} / {{total}}',
              'media.volumeValue': '{{percent}}%', 'media.fullscreen': '全螢幕', 'media.exitFullscreen': '結束全螢幕'},
    'zh-CN': {'media.play': '播放', 'media.pause': '暂停', 'media.mute': '静音', 'media.unmute': '取消静音',
              'media.seek': '播放位置', 'media.volume': '音量', 'media.timeOf': '{{current}} / {{total}}',
              'media.volumeValue': '{{percent}}%', 'media.fullscreen': '全屏', 'media.exitFullscreen': '退出全屏'},
    'yue': {'media.play': '播放', 'media.pause': '暫停', 'media.mute': '靜音', 'media.unmute': '取消靜音',
            'media.seek': '播放位置', 'media.volume': '音量', 'media.timeOf': '{{current}} / {{total}}',
            'media.volumeValue': '{{percent}}%', 'media.fullscreen': '全螢幕', 'media.exitFullscreen': '離開全螢幕'},
}
```

and append the ten keys (under `// Task 3`) to `KEYS`.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/core/media/VideoPlayer.a11y.test.tsx`:

```tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { VideoPlayer } from './VideoPlayer';

describe('VideoPlayer accessible controls (UI health #7)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('names every control and describes the ranges', () => {
        render(<VideoPlayer src="/api/content/media/hinatazaka46/v.mp4" />);
        expect(screen.getAllByRole('button', { name: 'Play' })).toHaveLength(2); // the big centre button and the bar's
        expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument();
        const seek = screen.getByRole('slider', { name: 'Playback position' });
        expect(seek).toHaveAttribute('aria-valuetext', '0:00 of 0:00');
        expect(screen.getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuetext', expect.stringMatching(/^\d+%$/));
    });

    it('rings the bar while the seek range has keyboard focus', () => {
        render(<VideoPlayer src="/api/content/media/hinatazaka46/v.mp4" />);
        const seek = screen.getByRole('slider', { name: 'Playback position' });
        expect(seek.parentElement).toHaveClass('focus-within:ring-2', 'focus-within:ring-accent');
    });

    it('marks the subtitles toggle as pressed or not', () => {
        render(<VideoPlayer src="/api/content/media/hinatazaka46/v.mp4" variant="gallery" transcriptionSegments={[{ start: 0, end: 1, text: 'あ', confidence: 1 }]} />);
        expect(screen.getByRole('button', { name: 'Subtitles' })).toHaveAttribute('aria-pressed');
    });
});
```

Run: `cd frontend && npx vitest run src/core/media/VideoPlayer.a11y.test.tsx`
Expected: FAIL — unnamed buttons and sliders.

- [ ] **Step 3: Implement**

In `frontend/src/core/media/VideoPlayer.tsx` (names only — classes stay as they are unless stated):

(a) Big centre button: add `type="button"` and `aria-label={t('media.play')}`; give its icon `aria-hidden="true"`.

(b) Seek bar container `<div className="relative h-1 mb-2 group/seek">` → add `rounded-full focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2` (the input inside is transparent; the ring shows where focus is). The seek `<input type="range" ...>` gets:

```tsx
                        aria-label={t('media.seek')}
                        aria-valuetext={t('media.timeOf', { current: formatTime(currentTime), total: formatTime(duration) })}
```

(c) Bar play/pause button: `aria-label={isPlaying ? t('media.pause') : t('media.play')}`; its icons `aria-hidden="true"`.

(d) Mute button: `aria-label={isMuted || volume === 0 ? t('media.unmute') : t('media.mute')}`; icons `aria-hidden="true"`. Volume range: `aria-label={t('media.volume')}` and `aria-valuetext={t('media.volumeValue', { percent: Math.round(volume * 100) })}`.

(e) CC button: add `aria-pressed={showSubtitles}` and `aria-label={t('transcription.cc')}` (keep `title`).

(f) Fullscreen button: `aria-label={isFullscreen ? t('media.exitFullscreen') : t('media.fullscreen')}`; icons `aria-hidden="true"`.

(g) Controls stay while focus is inside. Replace `resetControlsTimeout` with:

```tsx
    // Auto-hide controls shortly after the mouse stops moving, but never while keyboard focus is in
    // the player (a focused control must stay visible; UI health #7).
    const resetControlsTimeout = useCallback(() => {
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => {
            if (isPlaying && !containerRef.current?.contains(document.activeElement)) setShowControls(false);
        }, 800);
    }, [isPlaying]);
```

and add `onFocusCapture={resetControlsTimeout}` to the player container (`ref={containerRef}` div, next to `onMouseMove`).

(h) In the viewer-mode window key handler, Space on a focused button keeps the button's action:

```tsx
                case ' ':
                    if (el?.closest('button')) return; // the focused button's own action
                    e.preventDefault();
                    togglePlay();
                    break;
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/core/media src/i18n`
Expected: PASS (`VideoPlayer.test.tsx` included; it queries by test id / roles that are unchanged).

- [ ] **Step 5: Commit**

```bash
git add frontend/src
uv run git commit -m "fix(a11y): name the video controls and keep them while focused" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The voice player is named, keeps its keys to itself and shows volume on focus

**Files:**
- Modify: `frontend/src/core/media/VoicePlayer.tsx`
- Create: `frontend/src/core/media/VoicePlayer.a11y.test.tsx`
- Modify: `frontend/src/core/media/__snapshots__/VoicePlayer.test.tsx.snap` (refresh)

**Interfaces:**
- Consumes: the `media.*` keys from Task 3 (if Task 3 has not run, run its Step 1 first).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/core/media/VoicePlayer.a11y.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { VoicePlayer } from './VoicePlayer';

describe('VoicePlayer accessible controls (UI health #7)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    afterEach(() => vi.restoreAllMocks());

    it('names the inline controls and describes the ranges', () => {
        render(<VoicePlayer src="/api/content/media/hinatazaka46/v.m4a" />);
        expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Mute/ })).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('aria-valuetext', '0:00 of 0:00');
        expect(screen.getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuetext', expect.stringMatching(/%$/));
    });

    it('shows the volume slider while it has focus', () => {
        render(<VoicePlayer src="/api/content/media/hinatazaka46/v.m4a" />);
        const volume = screen.getByRole('slider', { name: 'Volume' });
        act(() => volume.focus()); // focus + focusin: React's onFocus listens to focusin
        expect(volume.parentElement).toHaveClass('opacity-100');
    });

    it('adds no window key listener for an inline bubble', () => {
        const spy = vi.spyOn(window, 'addEventListener');
        render(<VoicePlayer src="/api/content/media/hinatazaka46/v.m4a" />);
        expect(spy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
    });

    it('names the skip buttons in the viewer card', () => {
        render(<VoicePlayer src="/api/content/media/hinatazaka46/v.m4a" variant="premium" viewerMode />);
        expect(screen.getByRole('button', { name: /Back 5 seconds/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Forward 5 seconds/ })).toBeInTheDocument();
    });
});
```

Run: `cd frontend && npx vitest run src/core/media/VoicePlayer.a11y.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement**

In `frontend/src/core/media/VoicePlayer.tsx`:

(a) `SkipButton`: add `type="button"` and `aria-label={title}`; the icon and the "5" span get `aria-hidden="true"`.

(b) Both play buttons (premium `w-12 h-12` and compact `w-10 h-10`): `aria-label={isPlaying ? t('media.pause') : t('media.play')}`; their Play/Pause icons `aria-hidden="true"`.

(c) Both seek ranges: add

```tsx
                            aria-label={t('media.seek')}
                            aria-valuetext={t('media.timeOf', { current: formatTime(currentTime), total: formatTime(duration) })}
```

and on each seek bar container (`<div className="relative h-1 bg-sunken rounded-full overflow-hidden">` and `<div className="relative h-1 bg-control-off rounded-full overflow-hidden">`) add `focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2`.

(d) Both mute buttons: add `aria-label={isMuted ? t('voicePlayer.unmute') : t('voicePlayer.mute')}` (keep `title`); icons `aria-hidden="true"`.

(e) Both volume wrappers (`<div className="relative flex items-center" onMouseEnter={handleVolumeMouseEnter} onMouseLeave={handleVolumeMouseLeave}>`) also open on keyboard focus: add `onFocusCapture={handleVolumeMouseEnter}` and `onBlurCapture={handleVolumeMouseLeave}`. Both volume ranges: `aria-label={t('media.volume')}` and `aria-valuetext={t('media.volumeValue', { percent: Math.round(volume * 100) })}`.

(f) Replace the keyboard `useEffect` (the one with `window.addEventListener('keydown', handleKeyDown)`) with:

```tsx
    // Player shortcuts. Viewer mode: window-wide (the viewer has no focusable player box), except in a
    // field or menu, and Space on a focused button keeps that button's action. Inline bubbles: on their
    // own box only (UI health P-B8: one window listener per voice bubble before).
    const handleShortcut = useCallback((e: KeyboardEvent | React.KeyboardEvent): void => {
        if (e.defaultPrevented) return;
        const el = e.target instanceof HTMLElement ? e.target : null;
        if (el?.closest('[role="menu"], input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
        if (!viewerMode && el?.tagName === 'BUTTON') return;
        switch (e.key) {
            case ' ':
                if (el?.closest('button')) return;
                e.preventDefault();
                togglePlay();
                break;
            case 'ArrowLeft':
                if (!viewerMode) {
                    e.preventDefault();
                    handleSkipBack();
                }
                break;
            case 'ArrowRight':
                if (!viewerMode) {
                    e.preventDefault();
                    handleSkipForward();
                }
                break;
            case 'ArrowUp':
                if (viewerMode) {
                    e.preventDefault();
                    setVolume(Math.min(volume + 0.05, 1));
                }
                break;
            case 'ArrowDown':
                if (viewerMode) {
                    e.preventDefault();
                    setVolume(Math.max(volume - 0.05, 0));
                }
                break;
            case 'm':
            case 'M':
                e.preventDefault();
                handleMuteToggle();
                break;
        }
    }, [viewerMode, togglePlay, handleSkipBack, handleSkipForward, handleMuteToggle, volume, setVolume]);

    useEffect(() => {
        if (!viewerMode) return;
        const onKey = (e: KeyboardEvent) => handleShortcut(e);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [viewerMode, handleShortcut]);
```

and add `onKeyDown={viewerMode ? undefined : handleShortcut}` to every element that carries `ref={containerRef}` (the compact bubble box and the premium card).

- [ ] **Step 3: Run the tests and refresh the snapshots**

Run: `cd frontend && npx vitest run src/core/media/VoicePlayer.test.tsx -u && git diff -- src/core/media/__snapshots__ | head -80`
Expected: the snapshot diff only adds `aria-label` / `aria-valuetext` / `aria-hidden` / `type="button"` attributes and the `focus-within:` classes.

Run: `cd frontend && npx vitest run src/core/media src/features/messages`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
uv run git commit -m "fix(a11y): name the voice controls and scope their shortcuts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: While a dialog is open the rest of the app is inert; covered content too

**Files:**
- Modify: `frontend/src/design/dialog/dialogStack.ts`
- Create: `frontend/src/design/dialog/dialogStack.inert.test.ts`
- Create: `frontend/src/hooks/useMediaQuery.ts`, `frontend/src/hooks/useMediaQuery.test.ts`
- Create (if absent): `frontend/src/hooks/useInert.ts` (Task 1 Step 4)
- Modify: `frontend/src/features/messages/MessagesFeature.tsx`
- Modify: `frontend/e2e/a11y-keyboard.spec.ts`

**Interfaces:**
- Produces: `useMediaQuery(query: string): boolean` (false without `matchMedia`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/design/dialog/dialogStack.inert.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { popDialog, pushDialog, resetDialogStack } from './dialogStack';

/** A dialog frame inside its own backdrop, in <body> (as Modal portals it). */
function frame(): HTMLElement {
    const backdrop = document.createElement('div');
    const el = document.createElement('div');
    backdrop.append(el);
    document.body.append(backdrop);
    return el;
}

describe('dialog layer inert background (UI health #15, interim)', () => {
    let root: HTMLElement;
    beforeEach(() => {
        root = document.createElement('div');
        root.id = 'root';
        document.body.append(root);
    });
    afterEach(() => {
        resetDialogStack();
        document.body.innerHTML = '';
    });

    it('makes #root inert while any dialog is open', () => {
        const a = frame();
        const entry = pushDialog({ node: () => a, dismissible: true });
        expect(root).toHaveAttribute('inert');
        expect(a.parentElement).not.toHaveAttribute('inert');
        popDialog(entry);
        expect(root).not.toHaveAttribute('inert');
    });

    it('makes every dialog below the top one inert, and gives it back when the top closes', () => {
        const a = frame();
        const b = frame();
        const first = pushDialog({ node: () => a, dismissible: true });
        const second = pushDialog({ node: () => b, dismissible: true });
        expect(a.parentElement).toHaveAttribute('inert');
        expect(b.parentElement).not.toHaveAttribute('inert');
        popDialog(second);
        expect(a.parentElement).not.toHaveAttribute('inert');
        expect(root).toHaveAttribute('inert');
        popDialog(first);
        expect(root).not.toHaveAttribute('inert');
    });

    it('clears #root on a reset', () => {
        const a = frame();
        pushDialog({ node: () => a, dismissible: true });
        resetDialogStack();
        expect(root).not.toHaveAttribute('inert');
    });
});
```

Create `frontend/src/hooks/useMediaQuery.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

describe('useMediaQuery', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('is false without matchMedia', () => {
        vi.stubGlobal('matchMedia', undefined);
        expect(renderHook(() => useMediaQuery('(max-width: 767.98px)')).result.current).toBe(false);
    });

    it('follows the query', () => {
        let matches = true;
        const listeners = new Set<() => void>();
        vi.stubGlobal('matchMedia', () => ({
            get matches() { return matches; },
            addEventListener: (_: string, cb: () => void) => listeners.add(cb),
            removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
        }));
        const { result } = renderHook(() => useMediaQuery('(max-width: 767.98px)'));
        expect(result.current).toBe(true);
        matches = false;
        act(() => listeners.forEach((cb) => cb()));
        expect(result.current).toBe(false);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/design/dialog/dialogStack.inert.test.ts src/hooks/useMediaQuery.test.ts`
Expected: FAIL — `#root` never gets `inert`; `./useMediaQuery` missing.

- [ ] **Step 3: Implement the inert layer**

In `frontend/src/design/dialog/dialogStack.ts`, after `notify()` add:

```ts
/**
 * While any dialog is open, the app root (`#root`) and every dialog below the top one are inert
 * (UI health #15, an interim to native <dialog>): Tab, clicks and a screen reader's virtual cursor
 * stay in the top dialog. Dialogs, portaled menus and the lifted incoming call render in <body>
 * outside #root, so they stay usable; a lower dialog becomes live again when the one above closes,
 * before its focus is restored (focusRestore runs in a microtask).
 */
function syncInert(): void {
    if (typeof document === 'undefined') return;
    document.getElementById('root')?.toggleAttribute('inert', stack.length > 0);
    stack.forEach((entry, i) => {
        entry.node()?.parentElement?.toggleAttribute('inert', i < stack.length - 1);
    });
}
```

and call `syncInert();` right before `notify();` in `pushDialog`, `popDialog` and `resetDialogStack`.

Create `frontend/src/hooks/useMediaQuery.ts`:

```ts
import { useCallback, useSyncExternalStore } from 'react';

const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** Whether `query` matches now, kept current; false where `matchMedia` is missing (tests, SSR). */
export function useMediaQuery(query: string): boolean {
    const subscribe = useCallback((onChange: () => void) => {
        if (!hasMatchMedia()) return () => {};
        const list = window.matchMedia(query);
        list.addEventListener('change', onChange);
        return () => list.removeEventListener('change', onChange);
    }, [query]);
    const read = () => (hasMatchMedia() ? window.matchMedia(query).matches : false);
    return useSyncExternalStore(subscribe, read, () => false);
}
```

- [ ] **Step 4: Covered content in the chat is inert**

In `frontend/src/features/messages/MessagesFeature.tsx` (imports: `useInert` from `'../../hooks/useInert'`, `useMediaQuery` from `'../../hooks/useMediaQuery'`):

(a) After the `isSidebarOpen` state add:

```tsx
    // Below md (a narrow window or a zoomed page) the member list slides over the chat: closed, it is
    // off-screen and must not take focus; open, the chat behind its scrim must not (UI health A-D6).
    const narrow = useMediaQuery('(max-width: 767.98px)');
    const sidebarRef = useRef<HTMLDivElement>(null);
    const chatRef = useRef<HTMLDivElement>(null);
    useInert(sidebarRef, narrow && !isSidebarOpen);
    useInert(chatRef, narrow && isSidebarOpen);
```

(b) After `const callActive = incomingCall.phase !== 'idle';` add:

```tsx
    // The list under an in-frame call is covered by it: no focus and no virtual cursor there.
    const listWrapRef = useRef<HTMLDivElement>(null);
    useInert(listWrapRef, callActive);
```

(c) Attach the refs: `ref={sidebarRef}` on the sidebar wrapper (`<div className={cn('fixed inset-y-0 left-0 z-30 transform ...`); wrap `<ContentSheet className="relative"> … </ContentSheet>` in `<div ref={chatRef} className="contents"> … </div>`; wrap `{listShown && selectedGroupDir && messagesService && ( <MessageList … /> )}` in `<div ref={listWrapRef} className="contents"> … </div>` (`contents` keeps the flex/absolute layout exactly as it is; `inert` still applies to the descendants).

- [ ] **Step 5: Run the unit tests**

Run: `cd frontend && npx vitest run src/design src/hooks src/features/messages src/core`
Expected: PASS (existing Modal/Menu tests have no `#root`, so `syncInert` is a no-op there).

- [ ] **Step 6: Real-browser check**

Append to `frontend/e2e/a11y-keyboard.spec.ts` inside the `describe`:

```ts
  test('an open dialog makes the app behind it inert and gives it back on close', async ({ page }) => {
    await pinBigRoom(page, { messages })
    await page.goto('/')
    await page.getByText('Big Room', { exact: true }).click()
    await page.getByTitle('More options').click()
    await page.getByText('Date Search', { exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Date Search' })
    await expect(dialog).toBeVisible()
    await expect(page.locator('#root')).toHaveAttribute('inert', '')
    // Tab cycles inside the dialog only.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('#root')).not.toHaveAttribute('inert', '')
  })
```

Run: `cd frontend && npm run build && npx playwright test e2e/a11y-keyboard.spec.ts e2e/dialogs-chat.spec.ts e2e/dialogs-app.spec.ts --reporter=line`
Expected: all passed.

- [ ] **Step 7: Commit**

```bash
git add frontend/src frontend/e2e/a11y-keyboard.spec.ts
uv run git commit -m "fix(a11y): make the app behind dialogs and covered panes inert" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Transient messages are announced; errors are shown where focus is

**Files:**
- Create: `frontend/src/design/primitives/LiveRegion.tsx`; export it from `frontend/src/design/primitives/index.ts`
- Create: `frontend/src/shell/components/SettingsErrorToast.tsx`, `frontend/src/shell/components/SettingsErrorToast.test.tsx`
- Modify: `frontend/src/shell/App.tsx`, `frontend/src/shell/components/SettingRow.tsx`
- Modify: `frontend/src/core/media/VideoPlayer.tsx`, `frontend/src/core/media/MediaGalleryModal.tsx`, `frontend/src/core/media/PhotoDetailModal.tsx`
- Create: `frontend/src/design/primitives/LiveRegion.test.tsx`, `frontend/src/shell/components/SettingRow.test.tsx`
- Modify: `frontend/src/core/dialogs.style.test.ts` (add the new shell file to `FILES`)

**Interfaces:**
- Produces: `LiveRegion({ message: string })`; `SettingsErrorToast({ errorKey: string | null, suppressed: boolean, onDebug: () => void, onClose: () => void })`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/design/primitives/LiveRegion.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveRegion } from './LiveRegion';

describe('LiveRegion', () => {
    it('is always in the document, empty until there is a message', () => {
        const { rerender } = render(<LiveRegion message="" />);
        const region = screen.getByRole('status');
        expect(region).toHaveAttribute('aria-live', 'polite');
        expect(region).toBeEmptyDOMElement();
        rerender(<LiveRegion message="コピーしました" />);
        expect(screen.getByRole('status')).toBe(region);
        expect(region).toHaveTextContent('コピーしました');
        expect(region).toHaveClass('sr-only');
    });
});
```

Create `frontend/src/shell/components/SettingsErrorToast.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { SettingsErrorToast } from './SettingsErrorToast';

describe('SettingsErrorToast', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('shows the error as an alert with its actions', () => {
        render(<SettingsErrorToast errorKey="settings.saveFailed" suppressed={false} onDebug={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('settings.saveFailed'));
        expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    it('stays hidden while a dialog that shows the error itself is open', () => {
        render(<SettingsErrorToast errorKey="settings.saveFailed" suppressed onDebug={vi.fn()} onClose={vi.fn()} />);
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
```

Create `frontend/src/shell/components/SettingRow.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingRow } from './SettingRow';

describe('SettingRow descriptions (UI health A-S6)', () => {
    it('links the control to the description, and to the error when there is one', () => {
        const { rerender } = render(
            <SettingRow label="通知" description="新着メッセージを知らせます 🔔" control={<button type="button">切替</button>} />,
        );
        expect(screen.getByRole('button', { name: '切替' })).toHaveAccessibleDescription('新着メッセージを知らせます 🔔');
        rerender(
            <SettingRow label="通知" description="新着メッセージを知らせます 🔔" error="保存できませんでした" control={<button type="button">切替</button>} />,
        );
        expect(screen.getByRole('button', { name: '切替' })).toHaveAccessibleDescription('新着メッセージを知らせます 🔔 保存できませんでした');
    });

    it('keeps a description the control names itself', () => {
        render(
            <>
                <p id="own">自分の説明</p>
                <SettingRow label="通知" description="行の説明" control={<button type="button" aria-describedby="own">切替</button>} />
            </>,
        );
        expect(screen.getByRole('button', { name: '切替' })).toHaveAccessibleDescription('自分の説明');
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/design/primitives/LiveRegion.test.tsx src/shell/components/SettingsErrorToast.test.tsx src/shell/components/SettingRow.test.tsx`
Expected: FAIL — missing modules; the row control has no description.

- [ ] **Step 3: Implement**

Create `frontend/src/design/primitives/LiveRegion.tsx`:

```tsx
import React from 'react';
import { cn } from '../../utils/classnames';

/**
 * An always-mounted, visually hidden polite status (UI health A-D2): a region that mounts together
 * with its text is often not announced, so this one stays in the document and only its text
 * changes (the CallOverlay pattern). Pass '' when there is nothing to say.
 */
export const LiveRegion: React.FC<{ message: string; className?: string }> = ({ message, className }) => (
    <div role="status" aria-live="polite" className={cn('sr-only', className)}>{message}</div>
);
```

and add `export { LiveRegion } from './LiveRegion';` to `frontend/src/design/primitives/index.ts`.

Create `frontend/src/shell/components/SettingsErrorToast.tsx` (the markup moved from `App.tsx` unchanged, plus `suppressed`):

```tsx
import React from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Button, IconButton } from '../../design/primitives';
import { Z_INDEX } from '../../constants/zIndex';
import { useTranslation } from '../../i18n';

export interface SettingsErrorToastProps {
    /** i18n key of the newest settings save error, or null. */
    errorKey: string | null;
    /**
     * True while Settings or Setup is open: both show the failure inline (the row, the folder field),
     * and a toast behind a modal dialog would be missed and unreachable (UI health A-D2).
     */
    suppressed: boolean;
    onDebug: () => void;
    onClose: () => void;
}

/** A status card on the toast layer for a settings save that failed outside the dialogs. */
export const SettingsErrorToast: React.FC<SettingsErrorToastProps> = ({ errorKey, suppressed, onDebug, onClose }) => {
    const { t } = useTranslation();
    if (!errorKey || suppressed) return null;
    return (
        <div
            data-testid="settings-error-toast"
            role="alert"
            style={{ zIndex: Z_INDEX.TOAST }}
            className="fixed bottom-4 right-4 flex max-w-sm items-center gap-3 rounded-card bg-card p-4 shadow-card animate-reveal motion-reduce:animate-none"
        >
            <AlertCircle aria-hidden="true" className="h-5 w-5 shrink-0 text-status-danger" />
            <div className="min-w-0 flex-1">
                <p className="text-small font-semibold text-primary">{t('common.error')}</p>
                <p className="text-caption text-secondary">{t(errorKey)}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={onDebug}>
                {t('common.debug')}
            </Button>
            <IconButton size="sm" variant="ghost" aria-label={t('common.close')} icon={<X />} onClick={onClose} />
        </div>
    );
};
```

Add `'../shell/components/SettingsErrorToast.tsx',` to `FILES` in `frontend/src/core/dialogs.style.test.ts`.

In `frontend/src/shell/App.tsx`: import `SettingsErrorToast` from `./components/SettingsErrorToast`; replace the whole `{settingsErrorKey && ( <div data-testid="settings-error-toast" … </div> )}` block with

```tsx
                <SettingsErrorToast
                    errorKey={settingsErrorKey}
                    suppressed={showSettingsModal || showSetupWizard}
                    onDebug={() => setShowDiagnostics(true)}
                    onClose={clearSettingsError}
                />
```

and give the wizard the generic failure too: `<SetupWizard … folderErrorKey={folderErrorKey ?? settingsErrorKey} />` (the wizard saves only the folder, so a failed save is about the folder). Remove now-unused imports from `App.tsx` (`AlertCircle`, `X`, `Z_INDEX`, `Button`/`IconButton` if nothing else uses them — `tsc` tells).

Replace `frontend/src/shell/components/SettingRow.tsx` with:

```tsx
import React, { useId } from 'react';

interface SettingRowProps {
    label: React.ReactNode;
    /** Id for the label heading, to name a group under it (the sync-mode radios). */
    labelId?: string;
    description?: React.ReactNode;
    /** Id for the description, so a field under the row can name it in `aria-describedby`. */
    descriptionId?: string;
    /** Control on the right of the label (a Switch, a Button). It is described by the description and the error. */
    control?: React.ReactNode;
    /** Content under the label (radio groups, fields). */
    children?: React.ReactNode;
    /** Shown under the row when saving it failed (or, on the output folder row, when its picker failed). */
    error?: string;
    /** Id for the error, so a field under the row can name it in `aria-describedby`. */
    errorId?: string;
}

/** One setting: label + description, a control on the right, optional content below. */
export const SettingRow: React.FC<SettingRowProps> = ({ label, labelId, description, descriptionId, control, children, error, errorId }) => {
    const autoId = useId();
    const descId = description ? (descriptionId ?? `${autoId}-desc`) : undefined;
    const errId = error ? (errorId ?? `${autoId}-err`) : undefined;
    const describedBy = [descId, errId].filter(Boolean).join(' ') || undefined;
    // The control reads the row's description and error (UI health A-S6), unless it names its own.
    const linkedControl = describedBy && React.isValidElement<{ 'aria-describedby'?: string }>(control) && !control.props['aria-describedby']
        ? React.cloneElement(control, { 'aria-describedby': describedBy })
        : control;
    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
                <h3 id={labelId} className="flex items-center gap-2 text-body font-semibold text-primary">{label}</h3>
                {linkedControl}
            </div>
            {description && <p id={descId} className="max-w-md text-small text-muted">{description}</p>}
            {children}
            {error && <p id={errId} role="status" className="text-small text-status-danger">{error}</p>}
        </section>
    );
};
```

Clipboard toasts announce through a `LiveRegion` (their visual stays):
- `frontend/src/core/media/VideoPlayer.tsx`: give the clipboard toast `<div className="absolute top-4 left-1/2 …">` `aria-hidden="true"`, and add right after it (inside `playerNode`) `{goldenFingerActive && !effectiveViewerMode && <LiveRegion message={clipboardToast ?? ''} />}` (import `LiveRegion` with the other primitives). It is mounted only where the inline copy exists, so chats get no extra regions.
- `frontend/src/core/media/MediaGalleryModal.tsx`: in the detail viewer's clipboard toast replace `role="status"` with `aria-hidden="true"`, and add `<LiveRegion message={clipboardToast ?? ''} />` next to it, outside the `{clipboardToast && …}` condition (inside the detail `<Modal>`, so it exists only while a detail is open).
- `frontend/src/core/media/PhotoDetailModal.tsx`: the same for its `toastMessage` toast (`aria-hidden="true"` on the visual, `<LiveRegion message={toastMessage ?? ''} />` always rendered in the viewer).

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/design src/shell src/core`
Expected: PASS (`SettingsModal.saving.test.tsx` still finds each row's `role="status"` error).

- [ ] **Step 5: Commit**

```bash
git add frontend/src
uv run git commit -m "fix(a11y): announce toasts and keep settings errors in view" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Menus open on their first item and show where keyboard focus is

**Files:**
- Modify: `frontend/src/design/primitives/Menu.tsx`, `frontend/src/design/primitives/Menu.test.tsx`
- Modify: `frontend/src/design/DesignPage.test.tsx`, `frontend/src/features/memories/album/PhotoTile.test.tsx`

- [ ] **Step 1: Update the tests to the new contract (they fail first)**

In `frontend/src/design/primitives/Menu.test.tsx`:
- test "is a labelled menu of menuitems and takes focus": replace `expect(menu).toHaveFocus();` with `expect(screen.getByRole('menuitemradio', { name: '1x' })).toHaveFocus();` and add `expect(screen.getByRole('menuitemradio', { name: '1x' })).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-inset', 'focus-visible:ring-accent');`
- test "arrow keys, Home and End move between enabled items": delete the first `await userEvent.keyboard('{ArrowDown}');` (the menu now opens on 一; the next lines expect 一, then 三, …).
- test "Escape closes only the menu…" and "focus moving into the menu is not pulled back…": replace `expect(screen.getByRole('menu')).toHaveFocus();` with `expect(screen.getByRole('menuitem', { name: '一' })).toHaveFocus();`
- test "arrows work inside; Tab closes…": replace `await userEvent.keyboard('{ArrowDown}');` + `expect(screen.getByRole('menuitem', { name: '一' })).toHaveFocus();` with `await userEvent.keyboard('{ArrowDown}');` + `expect(screen.getByRole('menuitem', { name: '二' })).toHaveFocus();`
- add:

```tsx
    it('skips items with a disabled reason when it opens, unless all have one', () => {
        render(
            <Menu aria-label="m" onClose={vi.fn()}>
                <MenuItem disabledReason="理由">一</MenuItem>
                <MenuItem>二</MenuItem>
            </Menu>,
        );
        expect(screen.getByRole('menuitem', { name: '二' })).toHaveFocus();
    });
```

In `frontend/src/design/DesignPage.test.tsx`: replace `expect(screen.getByRole('menu')).toHaveFocus();` with `expect(screen.getByRole('menu').querySelector('[role^="menuitem"]')).toHaveFocus();`.
In `frontend/src/features/memories/album/PhotoTile.test.tsx`: replace `expect(menu).toHaveFocus();` with `expect(within(menu).getByRole('menuitem', { name: 'Make this the month cover' })).toHaveFocus();` (add `within` to the Testing Library import).

Run: `cd frontend && npx vitest run src/design/primitives/Menu.test.tsx src/design/DesignPage.test.tsx src/features/memories/album/PhotoTile.test.tsx`
Expected: FAIL — focus is on the menu container; no ring classes.

- [ ] **Step 2: Implement**

In `frontend/src/design/primitives/Menu.tsx`, in the mount effect replace `menu?.focus({ preventScroll: true });` with:

```tsx
        // Opening focuses the first enabled item (UI health A-D3; the menu pattern): an item with a
        // disabled reason is skipped unless every item has one. An empty menu takes focus itself.
        const items = Array.from(menu?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
        const first = items.find((el) => el.getAttribute('aria-disabled') !== 'true') ?? items[0];
        (first ?? menu)?.focus({ preventScroll: true });
```

and in `MenuItem`'s class list replace `'transition-colors duration-fast ease-standard hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none',` with

```tsx
                    // Keyboard focus: the §9 accent ring, inset (the item fills the menu); hover keeps the grey.
                    'transition-colors duration-fast ease-standard hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
```

- [ ] **Step 3: Run the menu users' tests**

Run: `cd frontend && npx vitest run src/design src/features src/core src/shell`
Expected: PASS. (If another suite still expects focus on the menu container, change it the same way: the first item, never the container.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src
uv run git commit -m "fix(a11y): open menus on their first item with a focus ring" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Photos open from the keyboard; viewers step with older/newer buttons

**Files:**
- Modify: `frontend/src/core/media/PhotoPlayer.tsx`, `frontend/src/features/messages/components/MessageBubble.tsx`
- Create: `frontend/src/core/media/StepButtons.tsx`, `frontend/src/core/media/StepButtons.test.tsx`
- Modify: `frontend/src/core/media/PhotoDetailModal.tsx`, `frontend/src/core/media/MediaGalleryModal.tsx`
- Modify: `frontend/src/i18n/locales/*.json`, `frontend/src/i18n/uiHealthAccessibility.test.ts`
- Create: `frontend/src/core/media/PhotoPlayer.button.test.tsx`
- Modify: `frontend/src/features/messages/components/__snapshots__/MessageBubble.test.tsx.snap`

**Interfaces:**
- Produces: `PhotoPlayer` prop `actionLabel?: string`; `StepButtons({ hasOlder, hasNewer, onOlder, onNewer })`; keys `messageList.openPhoto`, `media.older`, `media.newer`, `media.noOlder`, `media.noNewer`.

- [ ] **Step 1: Add the strings**

Run the Task 1 Step 1 script with:

```python
ADD = {
    'en': {'messageList.openPhoto': 'Open photo', 'media.older': 'Older', 'media.newer': 'Newer',
           'media.noOlder': 'This is the oldest one', 'media.noNewer': 'This is the newest one'},
    'ja': {'messageList.openPhoto': '写真を開く', 'media.older': '古い方へ', 'media.newer': '新しい方へ',
           'media.noOlder': 'これが一番古いものです', 'media.noNewer': 'これが一番新しいものです'},
    'zh-TW': {'messageList.openPhoto': '開啟照片', 'media.older': '較早', 'media.newer': '較新',
              'media.noOlder': '這是最早的一則', 'media.noNewer': '這是最新的一則'},
    'zh-CN': {'messageList.openPhoto': '打开照片', 'media.older': '较早', 'media.newer': '较新',
              'media.noOlder': '这是最早的一条', 'media.noNewer': '这是最新的一条'},
    'yue': {'messageList.openPhoto': '打開相', 'media.older': '較舊', 'media.newer': '較新',
            'media.noOlder': '呢個係最舊嘅', 'media.noNewer': '呢個係最新嘅'},
}
```

and append the five keys (under `// Task 8`) to `KEYS`.

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/core/media/PhotoPlayer.button.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoPlayer } from './PhotoPlayer';

describe('PhotoPlayer bubble that opens the viewer (UI health A-K3)', () => {
    it('is a named button that Enter opens', async () => {
        const onClick = vi.fn();
        render(<PhotoPlayer variant="bubble" src="/p.jpg" alt="Attachment" actionLabel="Open photo" onClick={onClick} />);
        const button = screen.getByRole('button', { name: 'Open photo' });
        button.focus();
        await userEvent.keyboard('{Enter}');
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(button).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-inset', 'focus-visible:ring-accent');
    });

    it('stays a plain image without a click handler', () => {
        render(<PhotoPlayer variant="bubble" src="/p.jpg" alt="Attachment" />);
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByRole('img', { name: 'Attachment' })).toBeInTheDocument();
    });
});
```

Create `frontend/src/core/media/StepButtons.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { StepButtons } from './StepButtons';

describe('StepButtons', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('steps older and newer, and says why at an end', async () => {
        const onOlder = vi.fn();
        const onNewer = vi.fn();
        render(<StepButtons hasOlder hasNewer={false} onOlder={onOlder} onNewer={onNewer} />);
        await userEvent.click(screen.getByRole('button', { name: 'Older' }));
        expect(onOlder).toHaveBeenCalledTimes(1);
        const newer = screen.getByRole('button', { name: 'Newer' });
        expect(newer).toHaveAttribute('aria-disabled', 'true');
        expect(newer).toHaveAttribute('title', 'This is the newest one');
        await userEvent.click(newer);
        expect(onNewer).not.toHaveBeenCalled();
    });
});
```

Run: `cd frontend && npx vitest run src/core/media/PhotoPlayer.button.test.tsx src/core/media/StepButtons.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`frontend/src/core/media/PhotoPlayer.tsx`:
- add to `PhotoPlayerProps`:

```tsx
    /** Bubble with `onClick`: the button's name ("Open photo"). Default: `alt`. */
    actionLabel?: string;
```

  and destructure `actionLabel`;
- replace the bubble branch (from `// bubble (default for in-chat thumbnails)` to the end of the component's return) with:

```tsx
    // bubble (default for in-chat thumbnails)
    if (hasError) return fallback(cn('w-full h-full', className));
    const image = (
        <img
            ref={imgRef}
            src={shownSrc}
            alt={alt}
            loading={effectiveLoading}
            onError={fail}
            onLoad={() => markLoaded(shownSrc)}
            className={cn(
                'w-full h-full object-contain',
                onLoad && 'transition-opacity duration-base ease-standard motion-reduce:transition-none',
                onLoad && (loadedSrc === shownSrc ? 'opacity-100' : 'opacity-0'),
                className,
            )}
        />
    );
    if (!onClick) return image;
    // A picture that opens the viewer is a button, so the keyboard opens it too (UI health A-K3).
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={actionLabel ?? alt}
            className="block h-full w-full cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
            {image}
        </button>
    );
```

  (Keep any other attribute the current bubble `<img>` has — e.g. `decoding="async"` from Plan F Task 6 — on `image`.)

`frontend/src/features/messages/components/MessageBubble.tsx`: pass `actionLabel={t('messageList.openPhoto')}` to the bubble `<PhotoPlayer variant="bubble" …>`.

Create `frontend/src/core/media/StepButtons.tsx`:

```tsx
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../../design/primitives';
import { useTranslation } from '../../i18n';

export interface StepButtonsProps {
    hasOlder: boolean;
    hasNewer: boolean;
    onOlder: () => void;
    onNewer: () => void;
}

/**
 * Older / newer overlay buttons on a dark viewer (UI health A-K5; DESIGN_SYSTEM "Left is older,
 * right is newer"). At an end the button stays focusable and says why it does nothing
 * (aria-disabled + title), as the zoom buttons do.
 */
export const StepButtons: React.FC<StepButtonsProps> = ({ hasOlder, hasNewer, onOlder, onNewer }) => {
    const { t } = useTranslation();
    return (
        <>
            <IconButton
                variant="overlay"
                className="absolute left-4 top-1/2 z-10 -translate-y-1/2"
                aria-label={t('media.older')}
                title={hasOlder ? undefined : t('media.noOlder')}
                aria-disabled={!hasOlder || undefined}
                icon={<ChevronLeft />}
                onClick={() => { if (hasOlder) onOlder(); }}
            />
            <IconButton
                variant="overlay"
                className="absolute right-4 top-1/2 z-10 -translate-y-1/2"
                aria-label={t('media.newer')}
                title={hasNewer ? undefined : t('media.noNewer')}
                aria-disabled={!hasNewer || undefined}
                icon={<ChevronRight />}
                onClick={() => { if (hasNewer) onNewer(); }}
            />
        </>
    );
};
```

`frontend/src/core/media/PhotoDetailModal.tsx`:
- import `StepButtons`; render `<StepButtons hasOlder={older !== null} hasNewer={newer !== null} onOlder={() => { if (older !== null) onNavigate(older); }} onNewer={() => { if (newer !== null) onNavigate(newer); }} />` right after the close `IconButton`;
- at the top of `handleKeyDown` add:

```tsx
        // Keys typed in a range (video seek / volume), a tab list or a menu belong to that control.
        if (e.target instanceof Element && e.target.closest('input[type="range"], [role="slider"], [role="tablist"], [role="menu"]')) return;
```

`frontend/src/core/media/MediaGalleryModal.tsx`:
- import `StepButtons`; in `renderDetailView`, after `const detailIdx = …` add `const { older, newer } = timeNeighbours(detailIdx, currentTabItems.length, 'newest_first');` and render after the close `IconButton`:

```tsx
                {currentTabItems.length > 1 && (
                    <StepButtons
                        hasOlder={older !== null}
                        hasNewer={newer !== null}
                        onOlder={() => { if (older !== null) setSelectedMedia(currentTabItems[older]); }}
                        onNewer={() => { if (newer !== null) setSelectedMedia(currentTabItems[newer]); }}
                    />
                )}
```

- at the top of `handleDetailKeyDown` add the same `closest(...)` guard (`e.target`).

- [ ] **Step 4: Refresh the bubble snapshot and run the tests**

Run: `cd frontend && npx vitest run src/features/messages/components/MessageBubble.test.tsx -u && git diff -- src/features/messages/components/__snapshots__ | head -40`
Expected: the picture snapshot's `<img>` is now inside `<button type="button" aria-label="Open photo" class="block h-full w-full cursor-pointer …">` and loses its own `cursor-pointer`; nothing else changes.

Run: `cd frontend && npx vitest run src/core/media src/features/messages src/i18n`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
uv run git commit -m "fix(a11y): open photos by keyboard and step viewers with buttons" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Landmarks, a skip link, and names for states that were only visual

**Files:**
- Create: `frontend/src/shell/components/SkipLink.tsx`
- Modify: `frontend/src/shell/App.tsx`, `frontend/src/core/layout/Layout.tsx`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx`, `frontend/src/features/messages/hooks/useTimelineKeyNav.ts`, `frontend/src/features/messages/hooks/useTimelineKeyNav.test.ts`
- Modify: `frontend/src/features/messages/components/MemberList.tsx`, `frontend/src/core/layout/ServiceRail.tsx`
- Modify: `frontend/src/design/primitives/Badge.tsx`, `frontend/src/design/primitives/Indicators.test.tsx`
- Modify: `frontend/src/core/modals/CalendarModal.tsx`, `frontend/src/core/modals/rCChatDialogs.test.tsx`, `frontend/e2e/timeline-scroll.spec.ts`
- Modify: `frontend/src/i18n/locales/*.json`, `frontend/src/i18n/uiHealthAccessibility.test.ts`
- Create: `frontend/src/shell/components/SkipLink.test.tsx`, `frontend/src/core/layout/Landmarks.test.tsx`
- Modify: `frontend/e2e/a11y-keyboard.spec.ts`

**Interfaces:**
- Produces: `<main id="sd-main">` in `Layout`; `SkipLink({ targetId })`; keys `a11y.skipToContent`, `messageList.timeline`, `serviceRail.serviceDisconnected`.

- [ ] **Step 1: Add the strings**

Run the Task 1 Step 1 script with:

```python
ADD = {
    'en': {'a11y.skipToContent': 'Skip to content', 'messageList.timeline': 'Messages',
           'serviceRail.serviceDisconnected': '{{name}}, session expired - click to re-login'},
    'ja': {'a11y.skipToContent': 'コンテンツへスキップ', 'messageList.timeline': 'メッセージ',
           'serviceRail.serviceDisconnected': '{{name}}、セッション切れ - クリックして再ログイン'},
    'zh-TW': {'a11y.skipToContent': '跳至內容', 'messageList.timeline': '訊息',
              'serviceRail.serviceDisconnected': '{{name}}，工作階段已過期 - 點擊重新登入'},
    'zh-CN': {'a11y.skipToContent': '跳到内容', 'messageList.timeline': '消息',
              'serviceRail.serviceDisconnected': '{{name}}，会话已过期 - 点击重新登录'},
    'yue': {'a11y.skipToContent': '跳去內容', 'messageList.timeline': '訊息',
            'serviceRail.serviceDisconnected': '{{name}}，Session 過咗期 - Click 呢度重新登入'},
}
```

and append the three keys (under `// Task 9`) to `KEYS`.

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/shell/components/SkipLink.test.tsx`:

```tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { SkipLink } from './SkipLink';

describe('SkipLink', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('is the first Tab stop and moves focus to the target', async () => {
        render(<><SkipLink targetId="sd-main" /><button type="button">rail</button><main id="sd-main" tabIndex={-1}>content</main></>);
        await userEvent.tab();
        const link = screen.getByRole('button', { name: 'Skip to content' });
        expect(link).toHaveFocus();
        expect(link).toHaveClass('sr-only', 'focus-visible:not-sr-only');
        await userEvent.keyboard('{Enter}');
        expect(screen.getByRole('main')).toHaveFocus();
    });
});
```

Create `frontend/src/core/layout/Landmarks.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { Badge } from '../../design/primitives';
import { Layout } from './Layout';

vi.mock('./ContentArea', () => ({ ContentArea: () => <div>content</div> }));
vi.mock('./FeatureRail', () => ({ FeatureRail: () => null }));
vi.mock('./ServiceRail', () => ({ ServiceRail: () => <nav aria-label="Groups" /> }));

describe('landmarks and names (UI health A-S5, A-S2)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('puts the content area in the one main landmark', () => {
        useAppStore.setState({ activeService: 'hinatazaka46', selectedServices: ['hinatazaka46'] });
        render(<Layout messagesContent={null} onAddService={vi.fn()} onOpenSettings={vi.fn()} onReportIssue={vi.fn()} onOpenAbout={vi.fn()} onOpenSearch={vi.fn()} />);
        expect(screen.getByRole('main')).toHaveAttribute('id', 'sd-main');
        expect(screen.getByRole('main')).toHaveTextContent('content');
    });

    it('exposes a badge count as text, not as a label on a span', () => {
        const { container } = render(<Badge count={3} />);
        expect(container.querySelector('[aria-label]')).toBeNull();
        expect(container).toHaveTextContent('3 unread');
    });
});
```

Append to `frontend/src/features/messages/hooks/useTimelineKeyNav.test.ts` (inside its `describe`; it already imports `renderHook` and the hook):

```ts
    it('leaves Home and End to a range or a field', () => {
        const jumpTo = vi.fn();
        const { result } = renderHook(() => useTimelineKeyNav(jumpTo, false));
        const slider = document.createElement('input');
        slider.type = 'range';
        const preventDefault = vi.fn();
        result.current({ key: 'Home', repeat: false, target: slider, preventDefault, stopPropagation: vi.fn() } as unknown as React.KeyboardEvent);
        expect(jumpTo).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
    });
```

(add `import type React from 'react';` if the file has no React import).

Update `frontend/src/design/primitives/Indicators.test.tsx` — the Badge case becomes:

```tsx
        render(<Badge count={count} />);
        const badge = screen.getByText(text).parentElement!;
        expect(badge).toHaveTextContent(`${count} unread`);
        expect(badge).not.toHaveAttribute('aria-label');
        expect(badge).toHaveClass('bg-accent', 'rounded-pill');
        expect(badge).toHaveClass('shadow-accent-unread');
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/shell/components/SkipLink.test.tsx src/core/layout/Landmarks.test.tsx src/features/messages/hooks/useTimelineKeyNav.test.ts src/design/primitives/Indicators.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement**

Create `frontend/src/shell/components/SkipLink.tsx`:

```tsx
import React from 'react';
import { useTranslation } from '../../i18n';
import { Z_INDEX } from '../../constants/zIndex';
import { brandScopeStyle } from '../../design/brandScope';

/**
 * The one skip link (UI health A-S5): the first Tab stop, visible only while it has keyboard focus,
 * moving focus past the group and feature rails to the content (`<main id={targetId}>`). A button,
 * not an in-page `#` link, so the URL fragment (the launch token's place) is never touched.
 */
export const SkipLink: React.FC<{ targetId: string }> = ({ targetId }) => {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            onClick={() => document.getElementById(targetId)?.focus()}
            style={{ ...brandScopeStyle(), zIndex: Z_INDEX.TOAST }}
            className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-2 focus-visible:top-2 focus-visible:rounded-md focus-visible:bg-sheet focus-visible:px-3 focus-visible:py-2 focus-visible:text-small focus-visible:font-semibold focus-visible:text-primary focus-visible:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            {t('a11y.skipToContent')}
        </button>
    );
};
```

`frontend/src/shell/App.tsx`: import `SkipLink` from `./components/SkipLink` and render `{!isOnboarding && !showSyncModal && <SkipLink targetId="sd-main" />}` as the first child of the root `<div className="flex h-screen flex-col overflow-hidden bg-window font-sans">`.

`frontend/src/core/layout/Layout.tsx`: wrap the `<ContentArea … />` element in

```tsx
                    {/* The one main landmark; the skip link moves focus here (tabIndex -1: focusable by script only). */}
                    <main id="sd-main" tabIndex={-1} className="flex h-full min-w-0 flex-1 outline-none">
                        <ContentArea … />
                    </main>
```

`frontend/src/features/messages/MessagesFeature.tsx`: on the timeline `<div ref={timelineRef} data-testid="chat-timeline" … tabIndex={0} onKeyDown={handleKeyDown}>` add `role="region"` and `aria-label={t('messageList.timeline')}` (it is focusable for keyboard scrolling, so it needs a role and a name).

`frontend/src/features/messages/hooks/useTimelineKeyNav.ts`: at the top of the returned callback add:

```ts
        // Keys typed into a control inside a bubble (a seek or volume range, a field, a menu) are its own.
        if (e.target instanceof Element && e.target.closest('input, textarea, select, [role="slider"], [role="menu"], [role="listbox"], [contenteditable="true"]')) return;
```

`frontend/src/features/messages/components/MemberList.tsx`: on the group `<button key={group.id} …>` add `aria-current={isSelected ? 'true' : undefined}`.

`frontend/src/core/layout/ServiceRail.tsx`: on the service `<button …>` replace `aria-label={getServiceDisplayName(service)}` with

```tsx
                                aria-label={isServiceDisconnected(service)
                                    ? t('serviceRail.serviceDisconnected', { name: getServiceDisplayName(service) })
                                    : getServiceDisplayName(service)}
```

and give the disconnected badge `aria-hidden="true"` (its meaning is now in the name).

`frontend/src/design/primitives/Badge.tsx` — the returned element becomes:

```tsx
        <span
            className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-accent px-1.5',
                'text-caption font-semibold text-inverse shadow-accent-unread',
                className,
            )}
        >
            {/* A plain span cannot carry a name: the count is read from visually hidden text (UI health A-S2). */}
            <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
            <span className="sr-only">{t('common.unreadCount', { count })}</span>
        </span>
```

`frontend/src/core/modals/CalendarModal.tsx` — inside each day button, replace `<span>{date.getDate()}</span>` with

```tsx
                                    <span aria-hidden="true">{date.getDate()}</span>
                                    {/* The full date names the day (UI health A-S3); the holiday follows. */}
                                    <span className="sr-only">{date.toLocaleDateString(i18n.language, { dateStyle: 'full' })}</span>
```

(`i18n` is imported from `'../../i18n'` if the file does not have it.) Then update the tests that found days by their bare number:
- `frontend/e2e/timeline-scroll.spec.ts`: replace `dialog.getByRole('button', { name: '15', exact: true })` with `dialog.locator('button[data-day="15"]:not([data-outside])')` (four places) and `dialog.getByRole('button', { name: '10', exact: true }).first()` with `dialog.locator('button[data-day="10"]:not([data-outside])').first()`;
- `frontend/src/core/modals/rCChatDialogs.test.tsx`: replace `screen.getAllByRole('button', { name: '10' })[0]` with `document.querySelector<HTMLButtonElement>('button[data-day="10"]:not([data-outside])')!` and the `'11'` query the same way;
- run `cd frontend && timeout 60 grep -rn "name: '[0-9]\{1,2\}'" src e2e --include=*.ts --include=*.tsx` and convert any other calendar-day query the same way (year buttons such as `'2024'` are four digits and unaffected).

- [ ] **Step 5: Run the tests**

Run: `cd frontend && npx vitest run src/shell src/core src/design src/features/messages src/i18n`
Expected: PASS.

- [ ] **Step 6: Real-browser check**

Append to `frontend/e2e/a11y-keyboard.spec.ts` inside the `describe`:

```ts
  test('the skip link is the first Tab stop and lands in main; names are exposed', async ({ page }) => {
    await pinBigRoom(page, { messages })
    await page.goto('/')
    await page.getByText('Big Room', { exact: true }).click()
    await page.locator('body').click({ position: { x: 1, y: 1 } })
    await page.keyboard.press('Tab')
    const skip = page.getByRole('button', { name: 'Skip to content' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('main')).toBeFocused()
    await expect(page.getByRole('region', { name: 'Messages' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Big Room', exact: true })).toHaveAttribute('aria-current', 'true')
  })
```

Run: `cd frontend && npm run build && npx playwright test e2e/a11y-keyboard.spec.ts e2e/timeline-scroll.spec.ts --reporter=line`
Expected: all passed.

- [ ] **Step 7: Commit**

```bash
git add frontend/src frontend/e2e
uv run git commit -m "fix(a11y): add main and a skip link; expose selection and state" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Transcript text is readable and its lines are buttons

**Files:**
- Modify: `frontend/src/core/media/TranscriptPanel.tsx`, `frontend/src/core/media/TranscriptPanel.test.tsx`
- Modify: `frontend/src/features/memories/onThisDay/YearStrip.tsx`, `frontend/src/core/media/grid/MediaTile.tsx`, `frontend/src/core/modals/AboutModal.tsx`
- Modify: `frontend/src/design/guard-baseline.json`
- Create: `frontend/src/core/media/TranscriptPanel.a11y.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/core/media/TranscriptPanel.a11y.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { TranscriptPanel } from './TranscriptPanel';

const segments = [
    { start: 0, end: 2, text: 'おはよう', confidence: 0.9 },
    { start: 2, end: 4, text: 'ございます🌸', confidence: 0.9 },
];

describe('TranscriptPanel readable and operable (UI health #12)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('makes each line a button that seeks, marking the current one', async () => {
        const onSeek = vi.fn();
        render(<TranscriptPanel segments={segments} currentTime={2.5} onSeek={onSeek} defaultExpanded variant="dark" />);
        const current = screen.getByRole('button', { name: /ございます/ });
        expect(current).toHaveAttribute('aria-current', 'true');
        await userEvent.click(screen.getByRole('button', { name: /おはよう/ }));
        expect(onSeek).toHaveBeenCalledWith(0);
    });

    it('draws its text with token colours, none inline', () => {
        const { container } = render(<TranscriptPanel segments={segments} currentTime={0} onSeek={vi.fn()} defaultExpanded variant="light" />);
        const inlineColours = Array.from(container.querySelectorAll<HTMLElement>('[style]')).filter((el) => /color:/.test(el.getAttribute('style') ?? ''));
        expect(inlineColours).toEqual([]);
        expect(screen.getByRole('button', { name: /おはよう/ }).querySelector('[lang="ja"]')).toHaveClass('text-viewer');
    });

    it('says whether the panel is open', () => {
        render(<TranscriptPanel segments={segments} currentTime={0} onSeek={vi.fn()} variant="dark" />);
        expect(screen.getByRole('button', { name: /Voice Content/ })).toHaveAttribute('aria-expanded', 'false');
    });
});
```

Run: `cd frontend && npx vitest run src/core/media/TranscriptPanel.a11y.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement the transcript panel**

In `frontend/src/core/media/TranscriptPanel.tsx`, below `const isLight = variant === 'light';` add:

```tsx
    // Text colours from tokens (UI health #12): ≥ 4.5:1 on the dark viewer (`light`) and on light
    // surfaces (`dark`). The accent stays only on the dark variant's toggle and active time (data colour).
    const tone = isLight
        ? { meta: 'text-viewer-muted', line: 'text-viewer-muted', active: 'text-viewer', activeTime: 'text-viewer-muted', activeBg: 'bg-viewer-control' }
        : { meta: 'text-muted', line: 'text-secondary', active: 'text-primary', activeTime: '', activeBg: '' };
```

Replace the `noSpeech` return with:

```tsx
        return (
            <div className={cn('flex items-center gap-1.5 py-1 text-caption', tone.meta)}>
                <span>{t('transcription.transcript')}</span>
                <span>· {t('transcription.noSpeech')}</span>
                {onRerun && (
                    <button
                        onClick={onRerun}
                        className={cn('rounded-xs p-0.5 transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', tone.meta)}
                        type="button"
                        title={t('transcription.rerun')}
                        aria-label={t('transcription.rerun')}
                    >
                        <RefreshCw aria-hidden="true" className="h-3 w-3" />
                    </button>
                )}
            </div>
        );
```

Replace the main return's toggle header and segments with:

```tsx
        <div>
            {/* Toggle header */}
            <div className="flex items-center gap-1">
                <button
                    onClick={() => setExpanded(!expanded)}
                    aria-expanded={expanded}
                    className={cn('flex items-center gap-1 rounded-xs py-1 text-left text-caption focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', isLight && tone.meta)}
                    style={isLight ? undefined : { color: accentColor }}
                    type="button"
                >
                    <Chevron aria-hidden="true" className="h-3 w-3" />
                    {t('transcription.transcript')}
                </button>
                {onRerun && (
                    <button
                        onClick={onRerun}
                        className={cn('rounded-xs p-0.5 transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', tone.meta)}
                        type="button"
                        title={t('transcription.rerun')}
                        aria-label={t('transcription.rerun')}
                    >
                        <RefreshCw aria-hidden="true" className="h-3 w-3" />
                    </button>
                )}
            </div>

            {/* Segments — optional translucent backdrop (withBackdrop) keeps
                text readable over gradients / backdrop-blur bars. Off by
                default for chat bubbles and other flat surfaces. */}
            {expanded && (
                <div
                    ref={containerRef}
                    className={`max-h-32 overflow-y-auto text-xs leading-relaxed mt-1${
                        withBackdrop
                            ? ` rounded-sm px-2 py-1.5 backdrop-blur-sm ${isLight ? 'bg-black/40' : 'bg-white/85'}`
                            : ''
                    }`}
                    // Mark "user scrolled" only on real input (wheel/touch), not on
                    // the browser scroll events emitted by our own smooth scrollTo —
                    // using onScroll here latched the flag after each auto-scroll and
                    // made centering skip every other active segment.
                    onWheel={() => { userScrolledRef.current = true; }}
                    onTouchMove={() => { userScrolledRef.current = true; }}
                >
                    {segments.map((seg, i) => {
                        const isActive = i === activeIndex;
                        const lowConfidence = seg.confidence < 0.4;
                        return (
                            <button
                                key={i}
                                ref={isActive ? activeRef : undefined}
                                type="button"
                                aria-current={isActive ? 'true' : undefined}
                                className={cn(
                                    'block w-full rounded-xs px-1 py-0.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                                    isActive && tone.activeBg,
                                )}
                                style={isActive && !isLight ? { background: withAlpha(accentColor, 8) } : undefined}
                                onClick={() => onSeek?.(seg.start)}
                            >
                                <span
                                    className={cn('mr-1.5 tabular-nums', isActive ? tone.activeTime : tone.meta)}
                                    style={isActive && !isLight ? { color: accentColor } : undefined}
                                >
                                    {formatTimestamp(seg.start)}
                                </span>
                                <span
                                    lang="ja"
                                    className={cn(isActive ? cn(tone.active, 'font-medium') : tone.line, lowConfidence && 'underline decoration-dotted underline-offset-[3px]')}
                                    style={lowConfidence ? { textDecorationColor: 'var(--ds-semantic-warning-text)' } : undefined}
                                    title={lowConfidence ? `⚠ ${t('transcription.lowConfidence', { pct: Math.round(seg.confidence * 100) })}` : undefined}
                                >
                                    {seg.text}
                                </span>
                            </button>
                        );
                    })}
                    <div className={cn('mt-1 text-right text-caption', tone.meta)}>
                        {t('transcription.clickToJump')}
                    </div>
                </div>
            )}
        </div>
```

Add `import { cn } from '../../utils/classnames';` and change `activeRef`'s type to `useRef<HTMLButtonElement>(null)` (it was a div ref). The `withBackdrop` palette classes stay as they are (no visual change requested; Plan H's widened guard ratchets them).

Note: `underline-offset-[3px]` is an arbitrary value outside the guarded families (radius/shadow/text/spacing) and equals the old inline `textUnderlineOffset: '3px'`.

- [ ] **Step 3: Readable muted text on sunken and the About heart ring**

- `frontend/src/features/memories/onThisDay/YearStrip.tsx`: in the preview card header `<div className="flex items-baseline gap-2 text-caption text-muted">` replace `text-muted` with `text-secondary`.
- `frontend/src/core/media/grid/MediaTile.tsx`: in `FailedTile` replace `text-muted` with `text-secondary` in `cn(FILL, 'flex flex-col items-center justify-center gap-1 bg-sunken p-2 text-center text-muted')`.
- `frontend/src/core/modals/AboutModal.tsx`: on the heart button replace `focus:outline-none` with `rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`.

- [ ] **Step 4: Lower the guard baseline and run the tests**

Run: `cd frontend && UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff -- src/design/guard-baseline.json`
Expected: only `core/media/TranscriptPanel.tsx` goes down (from 16); no other entry changes.

Run: `cd frontend && npx vitest run src/core src/features/memories src/design`
Expected: PASS (update `TranscriptPanel.test.tsx` only where it asserted the old inline colours: assert the new token classes instead).

- [ ] **Step 5: Commit**

```bash
git add frontend/src
uv run git commit -m "fix(a11y): make transcript text readable and its lines buttons" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Keyboard paths for ★, follow-up times, rail order and tabs

**Files:**
- Modify: `frontend/src/features/messages/components/MessageBubble.tsx`
- Modify: `frontend/src/core/layout/ServiceRail.tsx`, `frontend/src/core/layout/ServiceRail.test.tsx`
- Modify: `frontend/src/core/media/MediaGalleryModal.tsx`, `frontend/src/features/messages/components/ProfileImageViewer.tsx`
- Modify: `frontend/src/i18n/locales/*.json`, `frontend/src/i18n/uiHealthAccessibility.test.ts`
- Create: `frontend/src/features/messages/components/MessageBubble.keyboard.test.tsx`, `frontend/src/core/media/MediaGalleryModal.tabs.test.tsx`

**Interfaces:**
- Produces: keys `messageList.favorite`, `serviceRail.moveUp`, `serviceRail.moveDown`.

- [ ] **Step 1: Add the strings**

Run the Task 1 Step 1 script with:

```python
ADD = {
    'en': {'messageList.favorite': 'Favorite', 'serviceRail.moveUp': 'Move up', 'serviceRail.moveDown': 'Move down'},
    'ja': {'messageList.favorite': 'お気に入り', 'serviceRail.moveUp': '上へ移動', 'serviceRail.moveDown': '下へ移動'},
    'zh-TW': {'messageList.favorite': '我的最愛', 'serviceRail.moveUp': '上移', 'serviceRail.moveDown': '下移'},
    'zh-CN': {'messageList.favorite': '收藏', 'serviceRail.moveUp': '上移', 'serviceRail.moveDown': '下移'},
    'yue': {'messageList.favorite': '收藏', 'serviceRail.moveUp': '移上', 'serviceRail.moveDown': '移落'},
}
```

and append the three keys (under `// Task 11`) to `KEYS`.

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/features/messages/components/MessageBubble.keyboard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import type { Message } from '../../../types';
import { MessageBubble } from './MessageBubble';

const msg: Message = { id: 7, content: 'またね', timestamp: '2024-01-15T10:30:00Z', type: 'text', is_favorite: false };

describe('MessageBubble keyboard paths (UI health A-K4, A-K8)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        server.use(http.get('/api/app-state/translations', () => HttpResponse.json({})));
    });

    it('offers a ★ toggle, hidden until keyboard focus is in the row', async () => {
        const onToggleFavorite = vi.fn();
        render(<MessageBubble message={msg} member_name="n" onToggleFavorite={onToggleFavorite} />);
        const star = screen.getByRole('button', { name: 'Favorite' });
        expect(star).toHaveAttribute('aria-pressed', 'false');
        expect(star).toHaveClass('opacity-0', 'focus-visible:opacity-100');
        star.focus();
        await userEvent.keyboard('{Enter}');
        expect(onToggleFavorite).toHaveBeenCalledWith(7, false);
    });

    it('has no ★ toggle on an unread or read-only bubble', () => {
        const { rerender } = render(<MessageBubble message={msg} member_name="n" isUnread onToggleFavorite={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Favorite' })).toBeNull();
        rerender(<MessageBubble message={msg} member_name="n" readOnly onToggleFavorite={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Favorite' })).toBeNull();
    });

    it('shows a follow-up time on keyboard focus too', () => {
        const { container } = render(<MessageBubble message={msg} member_name="n" runStart={false} onToggleFavorite={vi.fn()} />);
        expect(container.querySelector('[data-testid="message-trailing"] time')).toHaveClass('group-has-[:focus-visible]/row:opacity-100');
    });
});
```

Append to `frontend/src/core/layout/ServiceRail.test.tsx` (it already has `renderRail()` with `hinatazaka46` and `sakurazaka46`):

```tsx
describe('ServiceRail reorder from the menu (UI health A-K6)', () => {
    it('moves a group down from its context menu', async () => {
        useAppStore.setState({ selectedServices: ['hinatazaka46', 'sakurazaka46'], serviceOrder: ['hinatazaka46', 'sakurazaka46', 'nogizaka46', 'yodel'] });
        renderRail();
        fireEvent.contextMenu(screen.getAllByRole('button', { name: /46/ })[0]);
        expect(screen.queryByRole('menuitem', { name: 'Move up' })).toBeNull(); // already first
        await userEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
        expect(useAppStore.getState().serviceOrder.slice(0, 2)).toEqual(['sakurazaka46', 'hinatazaka46']);
    });

    it('opens the menu at the button when the keyboard asks for it', () => {
        renderRail();
        fireEvent.contextMenu(screen.getAllByRole('button', { name: /46/ })[1], { clientX: 0, clientY: 0 });
        expect(screen.getByRole('menuitem', { name: 'Move up' })).toBeInTheDocument();
    });
});
```

Create `frontend/src/core/media/MediaGalleryModal.tabs.test.tsx`:

```tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { MediaGalleryModal } from './MediaGalleryModal';

describe('MediaGalleryModal tabs (UI health A-D5)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('moves between tabs with the arrow keys and labels the panel', async () => {
        render(<MediaGalleryModal isOpen onClose={() => {}} messages={[]} memberName="n" serviceId="hinatazaka46" />);
        const photos = screen.getByRole('tab', { name: 'Photos' });
        expect(photos).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('tab', { name: 'Videos' })).toHaveAttribute('tabindex', '-1');
        photos.focus();
        await userEvent.keyboard('{ArrowRight}');
        const videos = screen.getByRole('tab', { name: 'Videos' });
        expect(videos).toHaveFocus();
        expect(videos).toHaveAttribute('aria-selected', 'true');
        await userEvent.keyboard('{End}');
        expect(screen.getByRole('tab', { name: 'Voice messages' })).toHaveFocus();
        expect(screen.getByRole('tabpanel', { name: 'Voice messages' })).toBeInTheDocument();
    });
});
```

(If `MediaGalleryModal` requires more props, copy them from `ConversationMenu`'s `<MediaGalleryModal …>` call.)

Run: `cd frontend && npx vitest run src/features/messages/components/MessageBubble.keyboard.test.tsx src/core/layout/ServiceRail.test.tsx src/core/media/MediaGalleryModal.tabs.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the bubble paths**

In `frontend/src/features/messages/components/MessageBubble.tsx` (use the bubble's current star value: `starred` if the file defines it — Plan F Task 2 — otherwise `message.is_favorite`):

(a) After `const favoriteStar = …` add:

```tsx
    // Keyboard path to ★ (UI health A-K4): a toggle in the trailing column, shown only while keyboard
    // focus is in this row (mouse users keep the context menu and see nothing new). Not on a sheltered
    // or keepsake bubble.
    const starToggle = !readOnly && !isUnread && onToggleFavorite && (
        <button
            type="button"
            aria-pressed={starred}
            aria-label={t('messageList.favorite')}
            onClick={handleToggleFavorite}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-secondary opacity-0 transition-opacity duration-fast ease-standard focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent group-has-[:focus-visible]/row:opacity-100"
        >
            <Star aria-hidden="true" className={cn('h-3.5 w-3.5', starred && 'fill-current text-semantic-star')} />
        </button>
    );
```

(b) The trailing column renders when any of its pieces exists: change `{(translateButton || !runStart) && (` to `{(translateButton || !runStart || starToggle) && (`, and put `{starToggle}` as its first child.

(c) On the follow-up `<time …>` in the trailing column, add `group-has-[:focus-visible]/row:opacity-100` next to `group-hover/row:opacity-100`.

- [ ] **Step 4: Rail order from the menu**

In `frontend/src/core/layout/ServiceRail.tsx`:

(a) Replace `handleContextMenu` with:

```tsx
    const handleContextMenu = (e: React.MouseEvent, serviceId: string) => {
        e.preventDefault();
        // A keyboard-opened menu (Shift+F10, the Menu key) has no pointer position: open it at the button.
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const fromKeyboard = e.clientX === 0 && e.clientY === 0;
        setContextMenu({ serviceId, x: fromKeyboard ? rect.right : e.clientX, y: fromKeyboard ? rect.top : e.clientY });
    };
```

(b) Add, before `handleDrop`:

```tsx
    // One rail move (drag-and-drop, or the menu's Move up / Move down: UI health A-K6). The new rail
    // order is merged into the global order: selected-service slots take the new rail order.
    const moveService = useCallback((from: number, to: number) => {
        if (from === to || to < 0 || to >= services.length) return;
        const newRail = [...services];
        const [moved] = newRail.splice(from, 1);
        newRail.splice(to, 0, moved);
        const selectedSet = new Set(services);
        let railIdx = 0;
        setServiceOrder(getServiceOrder().map((id) => (selectedSet.has(id) ? newRail[railIdx++] : id)));
    }, [services, getServiceOrder, setServiceOrder]);
```

and make `handleDrop` use it: after its early return, replace everything from `// Compute new rail order` through `setServiceOrder(newGlobal);` with `moveService(dragIndex, targetIndex);` (keep the final `handleDragEnd();`), with deps `[dragIndex, moveService, handleDragEnd]`.

(c) The context menu becomes:

```tsx
            {contextMenu && (() => {
                const at = services.indexOf(contextMenu.serviceId);
                return (
                    <Menu aria-label={t('common.moreOptions')} onClose={() => setContextMenu(null)} point={{ x: contextMenu.x, y: contextMenu.y }} estimatedSize={{ width: 176, height: 136 }}>
                        {at > 0 && <MenuItem onClick={() => { moveService(at, at - 1); setContextMenu(null); }}>{t('serviceRail.moveUp')}</MenuItem>}
                        {at < services.length - 1 && <MenuItem onClick={() => { moveService(at, at + 1); setContextMenu(null); }}>{t('serviceRail.moveDown')}</MenuItem>}
                        <MenuItem destructive onClick={handleRemoveService}>{t('common.removeService')}</MenuItem>
                    </Menu>
                );
            })()}
```

- [ ] **Step 5: Tabs follow the tabs pattern**

`frontend/src/core/media/MediaGalleryModal.tsx` — in `renderTabs`, give the tablist keys and the tabs roving focus:

```tsx
    const tabsId = useId();
    const tabRefs = useRef<Partial<Record<MediaTab, HTMLButtonElement | null>>>({});
    // Arrows, Home and End move between the tabs and select them (UI health A-D5; the tabs pattern).
    const onTabsKeyDown = (e: React.KeyboardEvent) => {
        const ids = MEDIA_TABS.map((tab) => tab.id);
        const at = ids.indexOf(activeTab);
        const next = e.key === 'ArrowRight' ? (at + 1) % ids.length
            : e.key === 'ArrowLeft' ? (at - 1 + ids.length) % ids.length
            : e.key === 'Home' ? 0
            : e.key === 'End' ? ids.length - 1
            : -1;
        if (next === -1) return;
        e.preventDefault();
        e.stopPropagation();
        selectTab(ids[next]);
        tabRefs.current[ids[next]]?.focus();
    };
```

(declare these hooks with the component's other hooks, above `renderTabs`; add `useId` to the React import). On the tablist add `onKeyDown={onTabsKeyDown}`; on each tab button add `ref={(el) => { tabRefs.current[tab.id] = el; }}`, `id={`${tabsId}-${tab.id}`}` and `tabIndex={selected ? 0 : -1}`. Wrap the gallery `<Modal>`'s children (everything between `>` and `</Modal>` of the main gallery dialog) in

```tsx
                <div role="tabpanel" aria-labelledby={`${tabsId}-${activeTab}`}>
                    {/* existing children */}
                </div>
```

(no `aria-controls` on the tabs: the tabs guide notes no screen reader uses it).

`frontend/src/features/messages/components/ProfileImageViewer.tsx` — the same keyboard on its tablist (kinds in `available` order), and stop the keys from reaching the viewer's ← / → photo stepping:

```tsx
    const tabRefs = useRef<Partial<Record<ProfileImageKind, HTMLButtonElement | null>>>({});
    const onTabsKeyDown = (e: React.KeyboardEvent) => {
        const at = available.indexOf(kind);
        const next = e.key === 'ArrowRight' ? (at + 1) % available.length
            : e.key === 'ArrowLeft' ? (at - 1 + available.length) % available.length
            : e.key === 'Home' ? 0
            : e.key === 'End' ? available.length - 1
            : -1;
        if (next === -1) return;
        e.preventDefault();
        e.stopPropagation(); // the viewer's ← / → step photos only outside the tabs
        setKind(available[next]);
        setIndex(0);
        tabRefs.current[available[next]]?.focus();
    };
```

with `onKeyDown={onTabsKeyDown}` on its tablist and `ref` + `tabIndex={k === kind ? 0 : -1}` on each tab (`useRef` from React).

- [ ] **Step 6: Run the tests**

Run: `cd frontend && npx vitest run src/features/messages src/core src/i18n`
Expected: PASS. Refresh the bubble snapshot if a snapshot case renders an `onToggleFavorite` bubble (`npx vitest run src/features/messages/components/MessageBubble.test.tsx -u`; the diff must only add the hidden ★ button and the `group-has-[:focus-visible]/row:opacity-100` class).

- [ ] **Step 7: Commit**

```bash
git add frontend/src
uv run git commit -m "fix(a11y): add keyboard paths for stars, rail order and tabs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: CHANGELOG and final verification

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]`)

- [ ] **Step 1: Add the entries**

Under `## [Unreleased]` → `### Fixed`:

```markdown
- **Unread messages could not be revealed with the keyboard.** The unread cover
  is now a button you can reach with Tab and open with Enter or Space, and
  "Reveal all unread" is in the chat's ⋯ menu.
- **The search box no longer traps Tab and Enter.** You can now reach the
  filters and "Load more" with the keyboard, and the arrow keys no longer move
  the selection while you pick a Japanese or Chinese candidate.
- **Screen readers can now use the media players.** Play, mute, full screen and
  the position and volume sliders are named, the controls stay visible while
  you use them from the keyboard, and photos in a chat open with Enter.
- **Keyboard focus stays inside an open dialog.** The app behind a dialog can no
  longer be reached with Tab or a screen reader, and menus now open on their
  first item with a visible focus ring.
- **Voice transcripts are easier to read** and each line can be chosen with the
  keyboard to jump to that moment.
```

Under `### Changed`:

```markdown
- **More things work without a mouse.** A "Skip to content" link appears when
  you press Tab, the photo viewer has older and newer buttons, groups can be
  moved up or down from their menu, and messages can be starred from the
  keyboard.
```

- [ ] **Step 2: Full verification**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest run
npm run build && npx playwright test e2e/a11y-keyboard.spec.ts e2e/timeline-scroll.spec.ts e2e/dialogs-app.spec.ts e2e/dialogs-chat.spec.ts --reporter=line
```

Expected: tsc clean; eslint 0 errors (≤ 20 warnings); vitest all pass (guard, dialog style and i18n tests included); the e2e specs pass.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
uv run git commit -m "docs(changelog): note the keyboard and screen reader fixes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Guidance used (modern-web-guidance)

- **`accessibility`** — Task 1's inert hidden bubble ("Static, non-interactive, and hidden elements (whether hidden temporarily or permanently) must not be focusable"); Task 9's landmark and skip link ("Use one `<main>` landmark per page", "Provide skip links prior to repeated content … or long/infinite lists"), the Badge fix ("Don't put `aria-label`/`aria-labelledby` on elements that shouldn't be named: … plain `<div>`, `<span>`"), and the timeline region despite "`region` should be a last resort" (it is the one focusable scroll area and needs a role and name); Tasks 3, 7, 8 rings ("Mandatory - Don't disable browser native focus indicators without providing a replacement custom focus indicator").
- **`dialog`** — Task 5 keeps the custom layer and adds inert as an interim because the guide's native path replaces it entirely ("The browser provides: inert page, focus containment, top layer … DON'T add `role="dialog"`, `aria-modal`, a focus trap, `inert` toggling"), which conflicts with the lifted-call layering this wave (Decision 4).
- **`navigation-drawer`** — Task 5's off-canvas member list ("Mark the rest of the page `inert` while the drawer is open"), applied in both directions at narrow widths.
- **`menu`** — Task 7 opens on the first item ("`nomemory` makes reopening start at the first item") with the existing roles (focusgroup is not used: Chromium-only behaviour would still need the current fallback).
- **`persistent-toast-notifications`** — Task 6 suppresses the settings toast behind Settings/Setup ("DON'T surface toast notifications in the background while a modal dialog is open") and uses always-present regions ("Use an ARIA live region, ensuring that the container is present in the page on load").
- **`ime-safe-enter-submit`** — Task 2 returns early for every key while composing, with the Safari-safe pair ("Pairing `event.isComposing` with `event.keyCode === 229`").
- **`carousel`** — Task 8's older/newer buttons ("Use HTML `<button>` elements for previous/next controls", "do not intercept keys from links, form fields, or buttons").
- **`tabs`** — Task 11's tabs ("Set `role=tabpanel` on the tab panels and use `aria-labelledby`", "Do not add `aria-controls` to the tabs: no screen reader uses it").
- **`color`** — Task 10's token colours ("Maintain 4.5:1 for normal text").
- **`switch`**, **`html`** — checked for the Switch primitive and native-element choices; the Switch already has `role="switch"`/`aria-checked` and needs no change here (its forced-colours state is Plan H Task 2).

## Windows owner checks

Record results in `.superpowers/sdd/windows-acceptance.md` under "Plan G".

1. **Narrator (Win+Ctrl+Enter), chat.** Tab into a chat with unread messages: Narrator says "Show unread photo, button" (or message/video/voice); Enter reveals it. The ⋯ menu reads "Reveal all unread". Narrator's scan mode (Caps Lock+Space) does not read text under an open dialog.
2. **Narrator, players.** On a voice bubble: "Play, button", "Playback position, slider, 0:00 of 0:23", "Volume, slider, 100%". In the photo viewer: "Older, button" / "Newer, button"; at the newest photo, "Newer" says why it does nothing.
3. **Search with an IME (Microsoft IME Japanese, then Chinese Pinyin/Bopomofo).** Type a word, use ↑/↓ to pick a candidate: the result selection does not move; after confirming, ↑/↓ moves the results and Enter opens one. Tab from the field reaches the filter button; Enter there opens the filters.
4. **Keyboard only, 125 % / 150 % / 200 % scaling.** First Tab shows "Skip to content" at the top-left; Enter lands in the content. Menus open with the first item ringed. At 200 % page zoom (Ctrl + plus) with a narrow window, the member list slides in and Tab never reaches it while it is closed.
5. **Dialogs.** Open Settings and Tab around: focus never leaves the dialog; trigger a save failure (e.g. a read-only output folder): the row shows the error and no toast appears behind the dialog.
6. **High Contrast themes** — checked in Plan H; here confirm the new focus rings are visible in "Night sky" (they are transparent outlines there and turn into the theme's focus colour).

## Self-review

- **Spec coverage:** every row of `report-accessibility.md` maps to a task here, to Plan H (InlineTranslation contrast/`aria-expanded`/`lang`, the forced-colours parts, the §12 gradient captions) or to a won't-fix with reason (Appendix A). UI-HEALTH-REPORT #3, #5, #7, #12 (transcript), #15 (interim) and the focus/keyboard quick wins (menu ring, first-item focus, `aria-current`, timeline region, `<main>` + skip link) are covered.
- **Placeholders:** none; every step shows its code and every command its expected result.
- **Names:** `useInert`, `ShelterOverlay`, `reveal`, `contentRef`, `onRevealAll`, `unreadCount`, `handleInputKeyDown`, `listId`, `optionId`, `onHover`, `searchAbortRef`, `syncInert`, `useMediaQuery`, `LiveRegion`, `SettingsErrorToast`, `StepButtons`, `actionLabel`, `SkipLink`, `sd-main`, `tone`, `starToggle`, `moveService`, `onTabsKeyDown` are consistent across tasks and tests.

## Appendix A — Triage of `report-accessibility.md`

| Id | Finding (report section) | Status |
|---|---|---|
| A-K1 | Shelter `<div onClick>`; reveal all by long-press only; hidden bubble controls tabbable (Keyboard, Top 1) | task G1 |
| A-K2 | Search swallows Tab, hijacks Enter, no combobox roles, IME arrows (Keyboard, Top 2) | task G2 |
| A-K3 | Chat pictures open via `<img onClick>` (Keyboard) | task G8 |
| A-K4 | Favourite only via right-click / long-press (Keyboard) | task G11 |
| A-K5 | Photo viewers without prev/next buttons; frame arrows cancel slider keys (Keyboard) | task G8 |
| A-K6 | Service reorder by drag only; remove via context menu only (Keyboard) | task G11 (menu opens from Shift+F10 / Menu key too) |
| A-K7 | Timeline `tabIndex=0` wrapper without role/name; Home/End ignore target (Keyboard) | task G9 |
| A-K8 | Follow-up bubble time only on hover (Keyboard) | task G11 |
| A-M1 | VideoPlayer unnamed controls, invisible seek, auto-hide while focused, CC state, Space on buttons (Media) | task G3 |
| A-M2 | VoicePlayer unnamed play/seek, title-only mute, hidden-but-tabbable volume, window-wide keys (Media) | task G4 |
| A-M3 | Transcript segments are `div onClick` (Media) | task G10 |
| A-D1 | Custom div dialogs; background never inert (Dialogs) | task G5 (interim `inert`); native `<dialog>` won't-fix this wave (Decision 4) |
| A-D2 | Settings error toast outside the trap; toasts mount with text; VideoPlayer toast no role (Dialogs) | task G6 |
| A-D3 | Menu focuses the container; focused item 1.1:1 (Dialogs) | task G7 |
| A-D4 | Filter listbox of tabbable option buttons; inputs `outline-none` without replacement (Dialogs) | task G2 (suggestions become a button group; filter input ring); main search field ring ⚑ (Decision 2) |
| A-D5 | Tabs without arrows/tabpanel; underline invisible in forced colours; ←/→ on tab changes photo (Dialogs) | task G11; the forced-colours underline is Plan H Task 2 (`[aria-selected="true"]` outline) |
| A-D6 | Covered content focusable (off-canvas sidebar, list under the call) (Dialogs) | task G5 |
| A-S1 | Selected conversation ring-only (no `aria-current`); "session expired" in `title` only (SR) | task G9; the forced-colours ring is Plan H Task 2 |
| A-S2 | Badge `aria-label` on a plain span (SR) | task G9 |
| A-S3 | Calendar days named by number (SR) | task G9 |
| A-S4 | Title-only names (transcript rerun, voice skip/mute, ShareDialog); translation toggle without `aria-expanded`; translated text without `lang` (SR) | transcript rerun → G10; voice skip/mute → G4; translation toggle and `lang` → Plan H Task 3; ShareDialog close (memories/recap/share/ShareDialog.tsx:553) → won't-fix here: it is an `IconButton`-equivalent with a visible title in a rarely used export dialog — add `aria-label` opportunistically when the recap is next touched |
| A-S5 | No `<main>`, no skip link (SR) | task G9 |
| A-S6 | SettingRow description/error not `aria-describedby` (SR) | task G6 |
| A-C1 | Transcript and translation-toggle text 1.5–3.7:1, hard-coded hex (Contrast, Top 5) | transcript → G10; InlineTranslation → Plan H Task 3 |
| A-C2 | White member name/caption on light gradient ends; Sakurazaka pink on white (Contrast, §12 deviation) | won't-fix: an accepted deviation (DESIGN_SYSTEM §12, user decisions D1/R-c); Windows High Contrast already replaces gradients and text colours with system colours (Plan H, Windows owner check 1); a `prefers-contrast: more` override would change the accepted look for those users without a request |
| A-C3 | `text-muted` on `bg-sunken` 4.39:1 (YearStrip, MediaTile) (Contrast) | task G10 |
| A-C4 | About heart `focus:outline-none` without replacement (Contrast) | task G10 |
