# Sub-project B: In-App Incoming Call — Design

**Date:** 2026-11-03
**Repos touched:** `SakaDesk` only (frontend + one small backend endpoint and one setting). No pysaka change.
**Status:** Approved in brainstorming 2026-11-03. Awaiting review of the written spec.
**Programme context:** A (done) → **B in-app incoming call (this)** → C tray, background sync, Windows notifications and bottom-right call popup → D visual redesign. C reuses B's `CallScreen` component and `/api/client-log` endpoint.

---

## 1. Goals

1. Opening a member's 1:1 chat whose newest voice message is unheard plays it as an incoming call, the way the official app does.
2. The call has a ringing screen, a connected screen and a short "call ended" screen. Afterwards the chat is scrolled to that voice.
3. Every decision, skip and failure is logged to the backend `debug.log` as a structured breadcrumb, so a user's bug report shows why a call did or did not ring.
4. Users can turn the feature off in Settings.

**Out of scope:**
- Calls while the app is minimised or in the background, the tray, OS notifications and the bottom-right popup window. These belong to C.
- Ringtone audio. The call is silent: animation only.
- Subtitles or transcription on the call screen.
- Mute or speaker buttons.
- Calls in multi-member rooms.

---

## 2. Behaviour

### 2.1 Candidate

The **candidate** is the voice message (`type === 'voice'`) with the newest `timestamp`. Ties are broken by the larger `id`. Never pick by `id` alone: ids are not guaranteed to follow time.

Only the candidate can ring. Older unheard voices never ring; the user opens them the normal way.

"Unread" keeps the app's existing rule, unchanged: `id > readState.lastReadId && !readState.revealedIds.includes(id)`.

### 2.2 When to evaluate

Evaluate each time a **fresh** message fetch for the selected chat completes. That covers opening the chat and the refetch after every sync. Never evaluate on the cached render shown while the fetch runs: it can be stale and miss a newer voice.

### 2.3 Ring conditions

All of the following must hold, checked in this order. The first one that fails is the logged `reason`.

| # | condition | skip reason |
|---|-----------|-------------|
| 1 | Setting `incoming_call_enabled` is on | `disabled` |
| 2 | The chat is a member 1:1 chat (`!isGroupChat`) | `group_chat` |
| 3 | The chat has at least one voice message | `no_voice` |
| 4 | The candidate is unread | `already_read` |
| 5 | The member has a call-screen image or a chat icon (`memberImageUrl(member,'phone_image')`, else `memberImageUrl(member,'thumbnail')`) | `no_photo` |
| 6 | The candidate was not declined and did not time out during this visit | `dismissed_this_visit` |
| 7 | No call is currently active | `call_active` |
| 8 | The candidate's audio preloads successfully | `media_unavailable` (logged as `call_error`) |

Condition 8 exists because pysaka writes `media_file` when the download is **queued**, before the file is on disk. The audio element is preloaded before ringing. If preloading fails, the call does not ring and the next fresh fetch evaluates again. A successful preload also lets playback start instantly on answer.

**A visit** starts when the user selects a chat, and ends when they select another chat or switch service. Each new visit clears the dismissed set. A voice with a newer `timestamp` that arrives during a visit is a new candidate, so it rings even after the user declined an older one.

### 2.4 State machine

```
idle ──(conditions pass)──▶ ringing
ringing ──decline / Esc──────▶ idle            (candidate added to dismissed set; stays unread)
ringing ──30 s, no answer────▶ idle            (same as decline; logged as timeout)
ringing ──answer / Enter─────▶ connected       (revealMessage(candidate.id) is called immediately)
connected ──audio ended──────▶ ended
connected ──hang up / Esc────▶ ended
connected ──playback error───▶ ended           (logged as call_error playback_failed)
ended ──0.8 s───────────────▶ idle             (chat scrolls to the candidate, centred)
any phase ──chat/service switch──▶ idle        (no "ended" screen, no scroll; logged as call_cancel)
```

- Answering marks the voice heard immediately, through the existing `revealMessage` path, so read-state consolidation and the backend read-state sync work as today. Hanging up early does not undo this.
- Constants: `RING_TIMEOUT_MS = 30_000`, `ENDED_HOLD_MS = 800` and `PRELOAD_TIMEOUT_MS = 10_000`. A preload that neither loads nor fails within that time counts as `media_unavailable`.
- Only the latest evaluation's preload may start ringing. A visit change or a newer evaluation makes an in-flight preload's result void.

### 2.5 Screen (revised 2026-11-04)

This replaces the first "phone frame" design, which was too small: its height was capped at 560 px, half of a typical chat area. The approved mockup is `C:\D\saka-verify\mockups\call-glass.html`. It is a local reference only and is not committed, because it embeds member photos.

**Principle: it must feel like a real call.** Nothing on screen may hint that this is a recording: no voice length, no progress bar, no "voice message" label.

- **Scope.** The overlay covers the chat area only. The member list stays usable; clicking it counts as a chat switch.
- **Backdrop.**
  - The same photo fills the chat area, blurred (64 px, saturate 1.35, brightness 0.9, scaled 1.1).
  - A radial vignette darkens the edges.
- **Portrait.**
  - The member's photo is shown frameless and upright, centred in the chat area.
  - Every photo is cropped to a **uniform 9:16**, using `object-fit: cover` anchored at `center 30%`.
  - Size: width = `min((areaHeight − 2·padY) × 9/16, areaWidth − 32 px, 1200 px × 9/16)`, where `padY = clamp(12px, 3.2% of area height, 40px)`. The photo shrinks with the window, and the tighter of height or width wins.
  - Corner radius `clamp(16px, 2.6% of area height, 34px)`, with a 1 px soft white rim and a deep drop shadow.
- **Halo** (the one signature element).
  - **Ringing:** a ring in the group colour around the portrait, with an outer glow that breathes (2.4 s ease-in-out, opacity 0.55↔1).
  - **Connected:** a thin, still ring.
  - **None** while ended.
- **Group colour.**
  - `--accent` comes from the service theme:
    - solid services use `modals.accentColor`: 日向坂 `#7cc7e8`, 乃木坂 `#9B59B6`, Yodel `#5a8a6a`;
    - the light service 櫻坂 uses `messages.bubbleBorder` (`#E85298`), the pink of its bubble edges.
  - `--accent-deep` is `color-mix(in srgb, var(--accent) 70%, #0b1a33)`.
- **Ringing.**
  - **Band:** a bottom band about 30% of the portrait height, using progressive blur like the premium voice player. Its backdrop blur is 22 px, masked from transparent to opaque at 62%. On top sits a dark gradient: 0 → 0.45 at 50% → 0.72.
  - **Text on the band:**
    - an eyebrow: an accent dot and the group display name (e.g. 日向坂46);
    - the name, bold, with a two-layer shadow so it stays legible on bright photos;
    - "Incoming call…" (`call.incoming`).
  - **Buttons:** decline and answer, each with a small visible label below (`call.decline` / `call.answer`).
  - **Layout by portrait width:**
    - 400 px or wider: the text block on the left and the buttons on the right, in one row;
    - narrower: stacked and centred;
    - below 230 px: the button labels are hidden and the icons stay.
- **Connected.**
  - A top progressive-blur band holds the name, a green live dot and an `m:ss` timer.
  - A soft bottom shade sits behind a single hang-up button, labelled `call.hangUp`.
  - No other controls.
- **Ended.**
  - The photo keeps its colour: brightness 0.72, saturate 0.92, blur 1.5 px, scale 1.02. Never greyscale.
  - A small dark-glass pill in the centre shows "Call ended" (`call.ended`) and the talk time in `m:ss`, for 0.8 s.
- **Buttons ("soft solid").**
  - Circles of `clamp(48px, 16% of portrait width, 72px)`, with the icon at 42%.
  - Decline and hang-up are the same soft red for every group: `linear-gradient(180deg, #ef6a70, #dc4b5a)`, with the phone icon rotated 135°.
  - Answer is the only button that carries the group style:
    - **solid services** (theme `messages.headerStyle === 'gradient'`: 日向坂, 乃木坂, Yodel): `linear-gradient(180deg, color-mix(var(--accent) 80%, white), color-mix(var(--accent-deep) 85%, var(--accent)))`;
    - **light services** (`headerStyle === 'light'`: 櫻坂), matching the app's white-with-pink sakura UI: a white fill (`rgba(255,255,255,.95)`), a 1.5 px inner ring and an icon in `--accent`.
  - Both: a 1 px inner white rim at 0.22, a faint top sheen, and shadow `0 6px 18px rgba(0,0,0,.28)`.
  - Hover scales to 1.05 and press to 0.96. Focus shows a 2 px white outline.
  - While ringing, the answer button emits two 1.5 px rings in the accent colour, which expand to 1.75× and fade out over 1.8 s.
- **Fluid sizing.** Every text size, padding and radius inside the portrait scales with the portrait width using container-query units, with the min/max listed above. Nothing clips at any window size down to about 300 px wide.
- **Motion.** The halo breathing and the answer rings are the only animations. Both stop under `prefers-reduced-motion`.
- **Keyboard.** Esc declines (ringing) or hangs up (connected). Enter answers (ringing).
- **Bottom-right popup (sub-project C).** It reuses `CallScreen` unchanged:
  - the window takes the card's 9:16 shape;
  - there is no backdrop;
  - the halo is drawn inside the edge (inset ring plus inner glow), so the window needs no transparent margin.

  This is recorded here so that C does not redesign the screen.

---

## 3. Components

New folder: `frontend/src/features/incomingCall/`.

### 3.1 `callDecision.ts` (pure)

```ts
export type CallSkipReason =
  | 'disabled' | 'group_chat' | 'no_voice' | 'already_read'
  | 'no_photo' | 'dismissed_this_visit' | 'call_active';

export interface CallDecisionInput {
  enabled: boolean;
  isGroupChat: boolean;
  messages: Message[];
  isUnread: (id: number) => boolean;
  photoUrl: string | undefined;
  dismissedIds: ReadonlySet<number>;
  callActive: boolean;
}

export type CallDecision =
  | { ring: true; message: Message }
  | { ring: false; reason: CallSkipReason; messageId?: number };

export function pickCandidate(messages: Message[]): Message | undefined;
export function decideCall(input: CallDecisionInput): CallDecision;
```

This module has no timers, network, DOM or React.

### 3.2 `useIncomingCall.ts` (state machine hook)

- **Inputs** (one `UseIncomingCallArgs` object):
  - `service` (the media service), `chatDir` (the selected chat dir), `isGroupChat`, `messages`, `member`, `name`;
  - `enabled` (the setting; `undefined` while settings load), `isUnread`;
  - `freshFetch: { seq, dir } | null`: `MessagesFeature` bumps `seq` when a fresh fetch completes for `dir`;
  - `revealMessage(id)`, `scrollToMessage(id)`;
  - `logContext`: the `parseReadStatePath` result.
  - An optional second argument `preload(url)` lets tests replace the audio preloader. The audio URL is built with the shared `buildMediaUrl` helper, which `MessageBubble` also uses.
- **State and timers:**
  - It owns `phase: 'idle' | 'ringing' | 'connected' | 'ended'`, the current call message and photo URL, the dismissed set, the 30 s and 0.8 s timers, the preload, and `talkStartedAt` for the timer display.
  - Timers are cleared on every transition and on unmount.
- **Returns:** `{ phase, message, photoUrl, name, talkStartedAt, answer, decline, hangUp, onPlaybackEnded, onPlaybackError }`.
- **Logging:** all logging in §4.2 happens here.

### 3.3 `CallScreen.tsx` + `callScreen.css` (presentational, reused by C)

```ts
export type AnswerStyle = 'solid' | 'light';

interface CallScreenProps {
  phase: 'ringing' | 'connected' | 'ended';
  name: string;
  groupLabel: string;      // service display name, e.g. 日向坂46 (not translated)
  photoUrl: string;
  talkSeconds: number;     // connected: live; ended: the final talk time
  answerStyle: AnswerStyle;
  onAnswer: () => void;
  onDecline: () => void;
  onHangUp: () => void;
}
```

- **Sizing.** The root fills its parent. The parent decides the size (the chat overlay's 9:16 frame, or C's popup window) and provides the CSS variables `--sd-accent` and `--sd-rad`.
- **Styling.**
  - The styles live in `callScreen.css`, plain CSS with an `sd-call-` prefix.
  - The design needs container-query units, `color-mix()`, a masked backdrop blur and keyframes, none of which Tailwind 3 expresses cleanly.
  - The file is imported by `CallScreen.tsx`.
- **No state** beyond CSS animation.
- **Strings.** Every visible string and every `aria-label` goes through `t()`. The visible button labels reuse `call.decline`, `call.answer` and `call.hangUp`, and are `aria-hidden` because the button already carries that name.

### 3.4 `CallOverlay.tsx`

- **Props:** `{ call, accentColor, answerStyle, groupLabel }`.
  - `MessagesFeature` passes the accent, the answer style (both from the service theme, §2.5) and `getServiceDisplayName(service)`.
- **Layout.** An absolutely positioned layer over the chat area:
  - the blurred ambient photo and the vignette;
  - a `container-type: size` stage;
  - a 9:16 frame sized by the §2.5 formula, holding the halo and `CallScreen`.
- **Audio.** It hosts `CallAudio`, keyed per call, with volume from `useAmplifiedVolume(VOLUME_STORAGE_KEY)`.
- **Keys and focus.** It owns the Esc/Enter handler, the focus-on-ring behaviour and the persistent live region. These are unchanged from the reviewed implementation.

### 3.5 Changes to `MessagesFeature.tsx`

1. Add a `freshFetch` state (`{ seq, dir }`), bumped when `fetchMessages` finishes successfully. Hide the unread jump buttons while a call is active: they sit above the chat area.
2. Add `scrollToMessage(id)`: find the index and call `virtuosoRef.scrollToIndex({ index, align: 'center' })`.
3. Call `useIncomingCall(...)` and render `<CallOverlay>` inside the chat-area container, next to `MessageList`.
4. Read the setting `appSettings.incoming_call_enabled`. Treat `undefined` (settings not loaded yet) as off, so a call never rings before settings load.

---

## 4. Logging

### 4.1 `POST /api/client-log` (new: `backend/api/client_log.py`)

- **Request body:** `{ "event": <str>, "fields": { <str>: <int | bool | str> } }`
- **Events allowed:** `call_ring`, `call_skip`, `call_answer`, `call_decline`, `call_timeout`, `call_end`, `call_cancel`, `call_error`. C extends this list.
- **Field keys allowed:** `service`, `group_id`, `member_id`, `message_id`, `reason`, `phase`, `ring_ms`, `talk_ms`, `error_type`.
- **Values:**
  - an `int` or a `bool`;
  - or a `str` matching `^[a-z0-9_]{1,40}$`. That allows codes and the service slug, never free text.
  - Floats, objects, arrays and null are rejected.
- **Rejections:** any unknown event, unknown key or invalid value returns 422 and nothing is logged.
- **Accepted events:**
  - logged with structlog as `logger.info(event, source="client", **fields)`;
  - `call_error` uses `warning`;
  - the response is `204`.

Frontend helper `frontend/src/utils/clientLog.ts`: `clientLog(event, fields)` is fire-and-forget. On failure it only calls `console.debug`. It never throws and never blocks the call flow.

### 4.2 Breadcrumbs

`service`, `group_id` and `member_id` come from `parseReadStatePath(selectedGroupDir)`.

| event | when | fields |
|-------|------|--------|
| `call_skip` | decision is "don't ring" | service, group_id, member_id, message_id (when there is a candidate), reason |
| `call_error` | preload fails / playback fails | service, group_id, member_id, message_id, error_type (`media_unavailable` / `playback_failed`), phase |
| `call_ring` | ringing starts | service, group_id, member_id, message_id |
| `call_answer` | answered | message_id, ring_ms |
| `call_decline` | declined | message_id, ring_ms |
| `call_timeout` | 30 s without answer | message_id |
| `call_end` | connected call ends | message_id, reason (`played` / `hung_up`), talk_ms |
| `call_cancel` | chat or service switch during a call | message_id, phase |

**Dedupe:**
- `call_skip` is logged only when its (candidate id, reason) differs from the last skip logged for that chat during the current visit. A sync that reaches the same skip again does not log again, but the next visit does.
- A preload that succeeds but may no longer ring is always logged as `call_skip`, using the chat context captured when the evaluation started:
  - `superseded`: a newer evaluation or a chat switch replaced it;
  - `already_read`: the voice was read while the preload ran;
  - `call_active`: a call is already showing.
- `call_error media_unavailable` is logged once per (chat, candidate id) per visit.

**Never logged:** member names, message text, URLs or file paths.

---

## 5. Setting

- **Backend `backend/api/settings.py`:**
  - `incoming_call_enabled: bool = True` on the settings model;
  - `Optional[bool]` on `SettingsUpdate`;
  - read with `config.get("incoming_call_enabled", True)` and written on update. Same pattern as `sync_read_to_phone`.
- **Frontend:**
  - `incoming_call_enabled?: boolean` on the settings type;
  - a toggle in `SettingsModal` styled like the existing toggles, with a one-line description. C later puts its popup toggle next to it.

---

## 6. Strings (all five locales)

| key | zh-TW | ja | en | zh-CN | yue |
|-----|-------|----|----|-------|-----|
| `call.incoming` | 來電中… | 着信中… | Incoming call… | 来电中… | 來電中… |
| `call.ended` | 通話結束 | 通話終了 | Call ended | 通话结束 | 通話結束 |
| `call.answer` (aria) | 接聽 | 応答 | Answer | 接听 | 接聽 |
| `call.decline` (aria) | 拒接 | 拒否 | Decline | 拒接 | 拒接 |
| `call.hangUp` (aria) | 掛斷 | 終了 | Hang up | 挂断 | 收線 |
| `settings.incomingCall` | 來電 | 着信 | Incoming calls | 来电 | 來電 |
| `settings.incomingCallDesc` | 打開有未聽語音的成員聊天室時，以來電方式播放最新語音 | 未再生のボイスがあるメンバーのトークを開くと、最新のボイスを着信として再生します | When you open a member's chat with an unheard voice message, play the newest one as an incoming call | 打开有未听语音的成员聊天室时，以来电方式播放最新语音 | 打開有未聽語音嘅成員聊天室時，以來電方式播放最新語音 |

---

## 7. Testing

### Frontend (vitest)

1. **`callDecision.test.ts`**
   - The ring case.
   - A newer `timestamp` with a smaller `id` wins.
   - A timestamp tie is broken by `id`.
   - Every skip reason, including `already_read` both via `lastReadId` and via `revealedIds`.
2. **`useIncomingCall.test.ts`** (fake timers, mocked `Audio` and `clientLog`)
   - A fresh fetch rings.
   - The cached render alone does not ring.
   - A preload failure does not ring and logs `call_error`.
   - Decline, then another sync: no re-ring. A chat switch and back: rings.
   - A newer voice during the visit rings.
   - Timeout after 30 s.
   - Answer calls `revealMessage`. Audio ended → 0.8 s → idle, and `scrollToMessage` is called.
   - Hang-up path.
   - A switch while ringing or connected cancels with no scroll and logs `call_cancel`.
   - `call_skip` is deduped.
   - Settings not loaded means no ring.
3. **`CallScreen.test.tsx`**: each phase renders its translated text, buttons call their callbacks, and aria labels are present.
4. **`CallOverlay.test.tsx`**: Esc/Enter, audio `ended` → `onPlaybackEnded`, and audio `error` → `onPlaybackError`.
5. **Integration harness (`incomingCall.integration.test.tsx`).** A small test component wires `useIncomingCall` and `CallOverlay` exactly as `MessagesFeature` does:
   - a 1:1 chat with an unheard voice shows the overlay;
   - a group chat does not;
   - setting off does not.

   `MessagesFeature` itself has no render tests today: it needs the store, Virtuoso and many endpoints. Its wiring is covered by the manual Windows check below.
6. **i18n:** the new keys are present in all five locales, and non-ASCII renders.

### Backend (pytest)

7. **`test_client_log.py`**
   - Accepted events are logged with `source="client"`. Use `structlog.testing.capture_logs`, not caplog.
   - `call_error` is logged at warning.
   - Each of these returns 422 and logs nothing: an unknown event, an unknown key, a string with a space, CJK, uppercase or more than 40 characters, a float, an object, an array, or null.
8. **Settings:** `incoming_call_enabled` defaults to True and round-trips through an update.

### Manual (Windows dev build on the `C:\D\saka-verify` copy, never the live archive)

- **Ringing and dismissal:** open a 1:1 chat with an unheard voice: it rings. Decline, then sync: no re-ring. Switch away and back: it rings.
- **Full call:** answer: the voice plays, then call ended, then the chat scrolls to that voice and the voice shows as heard.
- **No ring:** a multi-member room does not ring, and neither does any chat with the setting off.
- **Logs:** `debug.log` has a breadcrumb for each step above, with no names or text.
