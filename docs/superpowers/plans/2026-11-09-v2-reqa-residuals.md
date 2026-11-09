# v2 re-QA residuals (R-g) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the residual defects from the real-data re-QA (`/mnt/c/D/saka-verify/qa2/report.md`, screenshots `/mnt/c/D/saka-verify/qa2/shots/`).

**Architecture:** Small, local fixes; one backend performance change (Diagnostics disk usage off the request path).

**Tech Stack:** React + TS + Tailwind tokens, Vitest; FastAPI + pytest.

## Global Constraints

- Same binding constraints as R-f: read the "## Global Constraints" section of `docs/superpowers/plans/2026-11-08-v2-qa-fixes-letters.md` (tokens only + guard, i18n ×5, breadcrumbs on every decision/failure/skip path registered on both sides, backend pathlib/utf-8/async hygiene/logging, zero-drift docs, Conventional Commits via `uv run git commit` with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, never stage `.superpowers/`).
- Owner decisions still in force: floating sync pill; translate next to the time; the transcript "顯示文字" control is NOT changed in this plan (pending owner decision); bubble border / badge colours and primary gradient contrast unchanged.

---

### Task 1: Header ⋯ button hover on gradient headers (N1)
`features/messages/components/ConversationMenu.tsx:~89`: on gradient title headers the trigger's hover/open background is `#f3f4f6` under a white icon (≈1.1:1). Use the header glass tokens like the dialog close button (`hover:bg-header-glass`, open state the same; keep icon in header text colour); on Sakurazaka's light header keep a visible neutral hover. Test classes for both header styles. Commit `fix(chat): keep the header menu icon visible on hover`.

### Task 2: Avatar sizes everywhere (H5 residual, N5)
- Request a density-matched variant: member list 64 css px → choose `w` from the allow-list by `devicePixelRatio` (64 css × DPR, rounded up to the next allowed width; add `112`, `160` to the backend allow-list if that gives a closer match — update the allow-list test), or use `srcset` with the allowed widths and `sizes`. Pick the simpler correct option and document it in `resizedAvatarUrl`.
- Chat message avatars (40 px) and chat header avatar (`features/messages/MessagesFeature.tsx:~548,555`) and any other local-archive avatar drawn small: use `resizedAvatarUrl` with the matched width.
- Tests for width selection by DPR and for each call site. Commit `fix(media): request avatar sizes matched to the screen`.

### Task 3: Voice transcript footer corners (M7 residual)
`features/messages/components/MessageBubble.tsx:~447`: the footer starts 4px (`-mt-1`) above the bubble's rounded bottom corners, leaving a step. When a footer is attached, square the bubble's bottom corners and let the footer carry the bottom radius (one continuous bordered shape), no negative margin. Evidence `qa2/shots/hinatazaka46/voice-footer-corner-zoom-1280.png`. Test the class combination. Commit `fix(chat): join the transcript footer to the voice bubble`.

### Task 4: Favourite videos placeholder (L4 residual)
`core/modals/FavoritesModal.tsx:~114-120`: bare `<video preload="metadata">` shows an empty white box while loading. Show the same skeleton (`bg-sunken animate-pulse motion-reduce:animate-none`, overlaid, video kept laid out with `opacity-0`) until `loadeddata`/`loadedmetadata`; on error keep the existing fallback and log via the existing media fallback breadcrumb if one exists. Test. Commit `fix(favorites): show a placeholder while videos load`.

### Task 5: Diagnostics loads at once (L6)
`backend/api/diagnostics.py:~108-130, 171-196` walks the whole output folder (34 GB → ~160 s). Return the diagnostics summary immediately; compute disk usage in a background task with a short-lived cache (e.g. computed once per app run and refreshed on demand), exposing a `disk_usage: { state: 'pending' | 'ready', ... }` field; the frontend Diagnostics panel shows the rest at once and a small "calculating…" state in the Disk usage card until ready (poll or a refresh button — reuse existing Refresh). Copy JSON enabled as soon as the summary arrives. Structured logs for start/finish/failure (no paths). Tests: backend (summary returns without walking; background result; failure path), frontend (pending state, ready state). Commit `perf(diagnostics): compute disk usage in the background`.

### Task 6: Scroll position resets (N3, N9)
- Media gallery: switching tabs scrolls the body to the top (`core/media/MediaGalleryModal.tsx:~374`).
- Blog feed: switching All / 推 scrolls the feed to the top.
- Tests. Commit `fix(ui): start at the top after switching tabs or filters`.

### Task 7: Letter viewer polish (N6, N8)
- N6: ‹ › and ←/→ always move in time order (› = newer, matching the counter where the oldest is 1), regardless of whether it was opened from Sent letters (newest-first list) or the chat. Update tests.
- N8: at narrow widths (< 900 px) the stacked layout gives the image a reasonable share (e.g. image max 45% of the dialog height, text scrolls) and the text panel never cuts mid-line (padding/scroll container). Evidence `qa2/shots/hinatazaka46/letter-viewer-860.png`. Commit `fix(letters): consistent arrow order and a roomier narrow layout`.

### Task 8: Message link contrast (N4)
`features/messages/components/MessageBubble.tsx:~133`: links use the light group colour (3.0:1 on white). Use `text-accent-strong` (same hue family, ≥4.5:1) with underline on hover. Test. Commit `fix(chat): darker message links`.

### Task 9: CHANGELOG and full checks
`[Unreleased]` end-user entries (merge into existing sections): Diagnostics opens immediately; sharper chat avatars; tidier voice transcript edge; video favourites show a placeholder; tabs and filters start at the top; letter viewer arrows go in time order; links in messages are easier to read; the chat menu button stays visible on hover. Full suites (frontend vitest/tsc/eslint, backend pytest/ruff). Commit `docs(changelog): note re-QA fixes`.

### Task 10: Yodel unread covers back to the logo periwinkle (owner correction)
Owner (2026-11-09): Yodel's unread covers must keep the logo-derived periwinkle; the old green restored in R-e (commit 4d047f4) was wrong; per-OG penlight colours are a future plan. Set `yodel.official.shelter` in `frontend/src/design/tokens/groups.ts` back to `{ picture: '#b5c0ff', video: '#98a2ff', voice: '#7e85ff', text: '#6060e0' }` (style `classic`), replace the "unverified approximation" comment with: logo-derived on purpose; a per-OG (penlight) layer is planned. Re-pin `tokens.test.ts`; revert the doc wording added by 4d047f4 / R-f Task 6 in DESIGN_SYSTEM.md, the v2 spec §3.2 and `design/__fixtures__/README.md`; remove the CHANGELOG `[Unreleased]` Fixed entry "Yodel's unread covers have their original colours back". Commit `fix(design): keep Yodel unread covers on the logo palette`.
