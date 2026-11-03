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
- Constants: `RING_TIMEOUT_MS = 30_000` and `ENDED_HOLD_MS = 800`.

### 2.5 Screen

- **Scope.** The overlay covers the chat area only. The member list stays usable; clicking it counts as a chat switch.
- **Layout.** A blurred photo backdrop fills the chat area, with an upright "phone" centred on it.
- **Ringing.** Photo, name and the text 着信中… (translated). Red decline and blue answer buttons sit on a white bottom bar. The photo pulses slowly and the buttons sway gently.
- **Connected.** Immersive FaceTime style: the photo fills the phone, the name and an `m:ss` timer sit at the top, and a single hang-up button floats over the photo. No other controls.
- **Ended.** The text 通話終了 (translated) over the dimmed photo for 0.8 s.
- **Keyboard.** Esc declines (ringing) or hangs up (connected). Enter answers (ringing).

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

- **Inputs:**
  - `service`, `selectedGroupDir`, `isGroupChat`, `messages`, `member`;
  - `enabled` (the setting), `isUnread`;
  - `fetchSeq`: a counter that `MessagesFeature` bumps when a fresh fetch for the selected chat completes;
  - `revealMessage(id)`, `scrollToMessage(id)`;
  - `audioUrlFor(message)`.
- **State and timers:**
  - It owns `phase: 'idle' | 'ringing' | 'connected' | 'ended'`, the current call message and photo URL, the dismissed set, the 30 s and 0.8 s timers, the preload, and `talkStartedAt` for the timer display.
  - Timers are cleared on every transition and on unmount.
- **Returns:** `{ phase, message, photoUrl, name, talkStartedAt, answer, decline, hangUp, onPlaybackEnded, onPlaybackError }`.
- **Logging:** all logging in §4.2 happens here.

### 3.3 `CallScreen.tsx` (presentational, reused by C)

```ts
interface CallScreenProps {
  phase: 'ringing' | 'connected' | 'ended';
  name: string;
  photoUrl: string;
  talkSeconds: number;
  onAnswer: () => void;
  onDecline: () => void;
  onHangUp: () => void;
}
```

No state beyond animation. Every visible string and button `aria-label` goes through `t()`.

### 3.4 `CallOverlay.tsx`

- An absolutely positioned layer over the chat area, with the blurred photo backdrop and `CallScreen` centred.
- It owns a hidden `<audio>` element:
  - volume comes from the existing `useAmplifiedVolume(VOLUME_STORAGE_KEY)` that `VoicePlayer` uses, so call volume matches the voice player;
  - `ended` calls `onPlaybackEnded` and `error` calls `onPlaybackError`.
- It owns the Esc/Enter key handlers. They are active only while the phase is not `idle`.

### 3.5 Changes to `MessagesFeature.tsx`

1. Add a `fetchSeq` state, bumped when `fetchMessages` for the selected chat finishes successfully.
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
- `call_skip` is logged once per (chat, candidate id, reason). A sync that reaches the same skip again does not log again.
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
5. **`MessagesFeature` integration:**
   - a 1:1 chat with an unheard voice shows the overlay;
   - a group chat does not;
   - setting off does not.
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
