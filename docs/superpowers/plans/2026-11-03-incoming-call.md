# In-App Incoming Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening a member's 1:1 chat whose newest voice message is unheard plays it as an incoming call, with every decision logged to the backend `debug.log`.

**Architecture:**
- **Frontend-only decision.** A pure function decides whether to ring. A hook runs the `idle → ringing → connected → ended` state machine. A presentational `CallScreen` draws the phone, and C reuses it. `CallOverlay` covers the chat area and plays the audio.
- **Backend.** One whitelisted `POST /api/client-log` endpoint writes UI breadcrumbs into structlog. One new setting, `incoming_call_enabled`.

**Tech Stack:** React 18 + TypeScript, vitest + Testing Library + MSW, framer-motion, lucide-react, i18next; FastAPI + pydantic v2 + structlog, pytest.

**Spec:** `docs/superpowers/specs/2026-11-03-incoming-call-design.md`

## Global Constraints

### Decision rules
- **Candidate.** The voice message (`type === 'voice'`) with the newest `timestamp`. Ties go to the larger `id`. Never pick by `id` alone.
- **Unread** is unchanged: `id > readState.lastReadId && !readState.revealedIds.includes(id)`.
- **Ring conditions, in this order** (the first failure is the logged reason):
  1. `disabled`
  2. `group_chat`
  3. `no_voice`
  4. `already_read`
  5. `no_photo`
  6. `dismissed_this_visit`
  7. `call_active`
  8. then the preload; a failure is logged as `call_error` with `error_type=media_unavailable`.
- **Evaluate** only after a fresh fetch completes for the selected chat (`freshFetch.dir === chatDir`). Never on the cached render.
- **Settings.** `undefined` (not loaded yet) counts as disabled. A loaded setting with the field missing defaults to `true`.

### State machine and timing
- Constants: `RING_TIMEOUT_MS = 30_000`, `ENDED_HOLD_MS = 800`, `PRELOAD_TIMEOUT_MS = 10_000`.
- **Ringing:**
  - Decline or timeout: the candidate joins the visit's dismissed set and stays unread.
  - Answer: call `revealMessage(id)` immediately.
- **Connected → ended → idle:** the ended screen holds for 0.8 s, then idle, then `scrollToMessage(id)`.
- **Chat or service switch** in any phase: idle immediately. No ended screen, no scroll. Log `call_cancel`.
- **Dismissed set** is per visit and cleared when `chatDir` changes.

### Screen and copy
- The overlay covers the chat area only. Esc declines or hangs up; Enter answers.
- No ringtone, no subtitles, no mute or speaker buttons.
- Copy is translated in all five locales: en, ja, zh-TW, zh-CN, yue.

### `/api/client-log`
- **Events:** `call_ring`, `call_skip`, `call_answer`, `call_decline`, `call_timeout`, `call_end`, `call_cancel`, `call_error`.
- **Field keys:** `service`, `group_id`, `member_id`, `message_id`, `reason`, `phase`, `ring_ms`, `talk_ms`, `error_type`.
- **Values:** strict int, strict bool, or a str matching `^[a-z0-9_]{1,40}$`.
- **Responses:** anything else gets 422 and nothing is logged. A valid event is logged with `source="client"` and answered with 204. `call_error` logs at warning, the rest at info.
- **Never log** member names, message text, URLs or file paths.

### Project rules
- **Tooling:** uv only (`uv run pytest`). Frontend commands run in `frontend/` (`npx vitest run …`, `npx tsc --noEmit`).
- **Commits:**
  - `uv run git commit -F <unique msg file>`; message files go in the scratchpad.
  - Conventional Commits, whole subject line ≤ 72 characters.
  - Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Code:**
  - No hardcoded user-facing strings: use `t()`.
  - Backend: `pathlib` and `encoding="utf-8"` for any file I/O; no `print()`.
- **CHANGELOG** entries are for end users: a bold lead-in, at most 3 sentences, no code identifiers.

---

## File Structure

| file | status | responsibility |
|------|--------|----------------|
| `backend/api/client_log.py` | create | whitelisted breadcrumb sink |
| `backend/main.py` | modify | register router |
| `backend/tests/test_client_log_api.py` | create | endpoint tests |
| `backend/api/settings.py` | modify | `incoming_call_enabled` |
| `tests/test_api_settings.py` | modify | setting tests |
| `frontend/src/utils/clientLog.ts` (+ `.test.ts`) | create | fire-and-forget poster |
| `frontend/src/__tests__/mocks/handlers.ts` | modify | MSW handler for client-log |
| `frontend/src/features/messages/MessagesFeature.tsx` | modify | `AppSettings` field, wiring (Task 6) |
| `frontend/src/shell/components/SettingsModal.tsx` | modify | toggle |
| `frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json` | modify | `call.*`, `settings.incomingCall*` |
| `frontend/src/i18n/incomingCall.test.ts` | create | locale presence |
| `frontend/src/features/messages/mediaUrl.ts` (+ `.test.ts`) | create | shared media URL builder |
| `frontend/src/features/messages/components/MessageBubble.tsx` | modify | use `buildMediaUrl` |
| `frontend/src/features/incomingCall/callDecision.ts` (+ `.test.ts`) | create | pure decision |
| `frontend/src/features/incomingCall/preloadAudio.ts` (+ `.test.ts`) | create | audio preload with timeout |
| `frontend/src/features/incomingCall/useIncomingCall.ts` (+ `.test.ts`) | create | state machine + logging |
| `frontend/src/features/incomingCall/CallScreen.tsx` (+ `.test.tsx`) | create | phone UI (reused by C) |
| `frontend/src/features/incomingCall/CallOverlay.tsx` (+ `.test.tsx`) | create | chat-area overlay + audio + keys |
| `frontend/src/core/media/VoicePlayer.tsx` | modify | export the volume storage key |
| `frontend/src/features/incomingCall/incomingCall.integration.test.tsx` | create | harness test |
| `CHANGELOG.md` | modify | Unreleased → Added |

---

### Task 1: Client breadcrumb endpoint and poster

**Files:**
- Create: `backend/api/client_log.py`, `backend/tests/test_client_log_api.py`, `frontend/src/utils/clientLog.ts`, `frontend/src/utils/clientLog.test.ts`
- Modify: `backend/main.py` (the import list at line 55 and the `include_router` block at about line 357), `frontend/src/__tests__/mocks/handlers.ts`

**Interfaces:**
- Produces:
  - `POST /api/client-log` (204 / 422);
  - TS: `clientLog(event: ClientLogEvent, fields?: ClientLogFields): void`, plus the types `ClientLogEvent` and `ClientLogFields`.

- [ ] **Step 1: Write the failing backend test** — `backend/tests/test_client_log_api.py`

```python
"""Tests for POST /api/client-log (whitelisted UI breadcrumbs)."""

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app

client = TestClient(app)


def _client_events(logs):
    return [e for e in logs if e.get("source") == "client"]


def test_valid_event_is_logged_with_client_source():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "call_ring",
                "fields": {
                    "service": "hinatazaka46",
                    "group_id": 43,
                    "member_id": 58,
                    "message_id": 123456,
                },
            },
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert len(events) == 1
    assert events[0]["event"] == "call_ring"
    assert events[0]["log_level"] == "info"
    assert events[0]["service"] == "hinatazaka46"
    assert events[0]["message_id"] == 123456


def test_fields_may_be_omitted():
    with capture_logs() as logs:
        res = client.post("/api/client-log", json={"event": "call_timeout"})
    assert res.status_code == 204
    assert len(_client_events(logs)) == 1


def test_bool_value_is_accepted():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log", json={"event": "call_skip", "fields": {"reason": "disabled", "ring_ms": True}}
        )
    assert res.status_code == 204
    assert _client_events(logs)[0]["ring_ms"] is True


def test_call_error_logs_at_warning():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={"event": "call_error", "fields": {"error_type": "playback_failed", "phase": "connected"}},
        )
    assert res.status_code == 204
    assert _client_events(logs)[0]["log_level"] == "warning"


@pytest.mark.parametrize(
    "body",
    [
        {"event": "not_an_event"},
        {"event": "call_ring", "fields": {"member_name": "x"}},
        {"event": "call_ring", "fields": {"reason": "has space"}},
        {"event": "call_ring", "fields": {"reason": "金村"}},
        {"event": "call_ring", "fields": {"reason": "Upper"}},
        {"event": "call_ring", "fields": {"reason": "a" * 41}},
        {"event": "call_ring", "fields": {"reason": ""}},
        {"event": "call_ring", "fields": {"reason": "abc\n"}},
        {"event": "call_ring", "fields": {"ring_ms": 1.5}},
        {"event": "call_ring", "fields": {"ring_ms": None}},
        {"event": "call_ring", "fields": {"ring_ms": {"a": 1}}},
        {"event": "call_ring", "fields": {"ring_ms": [1]}},
        {"event": "call_ring", "fields": {"reason": "/api/content/media/x"}},
    ],
)
def test_invalid_body_is_rejected_and_not_logged(body):
    with capture_logs() as logs:
        res = client.post("/api/client-log", json=body)
    assert res.status_code == 422
    assert _client_events(logs) == []
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest backend/tests/test_client_log_api.py -q`
Expected: FAIL. The route does not exist yet; 404 is not 204/422.

- [ ] **Step 3: Implement** `backend/api/client_log.py`

```python
"""Frontend breadcrumb sink.

The webview has no log file of its own, so UI decision paths (such as the
incoming-call flow) POST structured events here and they land in debug.log.
Only whitelisted event names, field keys and code-like values are accepted,
so free text, names, URLs or paths can never reach the log.
"""

from typing import Annotated, Literal, Union

import structlog
from fastapi import APIRouter, Response
from pydantic import BaseModel, StrictBool, StrictInt, StringConstraints, field_validator

router = APIRouter(prefix="/api/client-log", tags=["client-log"])
logger = structlog.get_logger(__name__)

ClientEvent = Literal[
    "call_ring",
    "call_skip",
    "call_answer",
    "call_decline",
    "call_timeout",
    "call_end",
    "call_cancel",
    "call_error",
]

ALLOWED_FIELDS = frozenset(
    {
        "service",
        "group_id",
        "member_id",
        "message_id",
        "reason",
        "phase",
        "ring_ms",
        "talk_ms",
        "error_type",
    }
)
WARNING_EVENTS = frozenset({"call_error"})

CodeStr = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]{1,40}$")]
FieldValue = Union[StrictBool, StrictInt, CodeStr]


class ClientLogEntry(BaseModel):
    event: ClientEvent
    fields: dict[str, FieldValue] = {}

    @field_validator("fields")
    @classmethod
    def _only_known_keys(cls, value: dict[str, FieldValue]) -> dict[str, FieldValue]:
        # Do not echo the offending keys back: they are client-supplied text.
        if not set(value) <= ALLOWED_FIELDS:
            raise ValueError("unknown field key")
        return value


@router.post("", status_code=204)
async def post_client_log(entry: ClientLogEntry) -> Response:
    """Record one whitelisted UI breadcrumb in the backend log."""
    log = logger.warning if entry.event in WARNING_EVENTS else logger.info
    log(entry.event, source="client", **entry.fields)
    return Response(status_code=204)
```

In `backend/main.py`, add `client_log,` to the `from backend.api import (...)` list, and add `app.include_router(client_log.router)` after `app.include_router(chat_features.router)`.

- [ ] **Step 4: Run the backend tests**

Run: `uv run pytest backend/tests/test_client_log_api.py -q`
Expected: all pass.

If the `"abc\n"` case returns 204, the regex engine is matching `$` before a trailing newline. Change the pattern to `r"^[a-z0-9_]{1,40}\Z"` and re-run.

- [ ] **Step 5: Write the failing frontend test** — `frontend/src/utils/clientLog.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../__tests__/mocks/server';
import { clientLog } from './clientLog';

afterEach(() => vi.restoreAllMocks());

describe('clientLog', () => {
    it('posts the event and fields as JSON', async () => {
        let received: unknown = null;
        server.use(
            http.post('/api/client-log', async ({ request }) => {
                received = await request.json();
                return new HttpResponse(null, { status: 204 });
            }),
        );
        clientLog('call_ring', { service: 'hinatazaka46', message_id: 7 });
        await vi.waitFor(() => expect(received).not.toBeNull());
        expect(received).toEqual({ event: 'call_ring', fields: { service: 'hinatazaka46', message_id: 7 } });
    });

    it('never throws when the server rejects', async () => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        server.use(http.post('/api/client-log', () => new HttpResponse(null, { status: 422 })));
        expect(() => clientLog('call_skip', { reason: 'disabled' })).not.toThrow();
        await vi.waitFor(() => expect(debug).toHaveBeenCalled());
    });

    it('never throws when the network fails', async () => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        server.use(http.post('/api/client-log', () => HttpResponse.error()));
        expect(() => clientLog('call_timeout', { message_id: 1 })).not.toThrow();
        await vi.waitFor(() => expect(debug).toHaveBeenCalled());
    });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run (in `frontend/`): `npx vitest run src/utils/clientLog.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 7: Implement** `frontend/src/utils/clientLog.ts`, and add the MSW handler

```ts
/**
 * Fire-and-forget UI breadcrumbs → backend debug.log (POST /api/client-log).
 * The backend whitelists events, keys and values; never pass names, text,
 * URLs or paths. Failures are swallowed so logging can't break a UI flow.
 */
export type ClientLogEvent =
    | 'call_ring' | 'call_skip' | 'call_answer' | 'call_decline'
    | 'call_timeout' | 'call_end' | 'call_cancel' | 'call_error';

export type ClientLogFieldKey =
    | 'service' | 'group_id' | 'member_id' | 'message_id' | 'reason'
    | 'phase' | 'ring_ms' | 'talk_ms' | 'error_type';

export type ClientLogFields = Partial<Record<ClientLogFieldKey, number | boolean | string>>;

export function clientLog(event: ClientLogEvent, fields: ClientLogFields = {}): void {
    try {
        fetch('/api/client-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, fields }),
        })
            .then(res => {
                if (!res.ok) console.debug('[clientLog] rejected', event, res.status);
            })
            .catch(err => console.debug('[clientLog] failed', event, err));
    } catch (err) {
        console.debug('[clientLog] failed', event, err);
    }
}
```

In `frontend/src/__tests__/mocks/handlers.ts`, add this to the handlers array, next to the `/api/read-states/batch` handler:

```ts
  // UI breadcrumbs (fire-and-forget)
  http.post('/api/client-log', () => {
    return new HttpResponse(null, { status: 204 })
  }),
```

- [ ] **Step 8: Run the tests**

Run (in `frontend/`): `npx vitest run src/utils/clientLog.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/api/client_log.py backend/main.py backend/tests/test_client_log_api.py frontend/src/utils/clientLog.ts frontend/src/utils/clientLog.test.ts frontend/src/__tests__/mocks/handlers.ts
uv run git commit -F <msg>   # feat(log): add whitelisted client breadcrumb endpoint
```

---

### Task 2: `incoming_call_enabled` setting, toggle and all strings

**Files:**
- Modify: `backend/api/settings.py` (the settings model near line 97, `SettingsUpdate` near line 114, and both `SettingsResponse(...)` constructions plus `_apply`)
- Modify: `tests/test_api_settings.py`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx` (the `AppSettings` interface only)
- Modify: `frontend/src/shell/components/SettingsModal.tsx` (general tab)
- Modify: `frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json`
- Create: `frontend/src/i18n/incomingCall.test.ts`

**Interfaces:**
- Produces:
  - `AppSettings.incoming_call_enabled?: boolean`;
  - i18n keys `call.incoming`, `call.ended`, `call.answer`, `call.decline`, `call.hangUp`, `settings.incomingCall`, `settings.incomingCallDesc`.

- [ ] **Step 1: Write the failing backend tests** — append to `tests/test_api_settings.py`

```python
@pytest.mark.asyncio
async def test_incoming_call_enabled_defaults_true(client, isolated_settings):
    response = client.get("/api/settings")
    assert response.status_code == 200
    assert response.json()["incoming_call_enabled"] is True


@pytest.mark.asyncio
async def test_incoming_call_enabled_round_trips(client, isolated_settings):
    response = client.post("/api/settings", json={"incoming_call_enabled": False})
    assert response.status_code == 200
    assert response.json()["incoming_call_enabled"] is False
    assert client.get("/api/settings").json()["incoming_call_enabled"] is False
    saved = json.loads(isolated_settings.read_text(encoding="utf-8"))
    assert saved["incoming_call_enabled"] is False
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest tests/test_api_settings.py -q -k incoming_call`
Expected: FAIL with a `KeyError` on `incoming_call_enabled`.

- [ ] **Step 3: Implement the backend setting**

In `backend/api/settings.py`, follow the `sync_read_to_phone` pattern exactly.
- In the settings response model, after `sync_read_to_phone`:
  ```python
      incoming_call_enabled: bool = True  # Ring when opening a 1:1 chat whose newest voice is unheard
  ```
- In `SettingsUpdate`:
  ```python
      incoming_call_enabled: Optional[bool] = None
  ```
- In both `SettingsResponse(...)` constructions (`get_settings` and `update_settings`):
  ```python
          incoming_call_enabled=config.get("incoming_call_enabled", True),
  ```
- In `_apply`:
  ```python
          if update.incoming_call_enabled is not None:
              config["incoming_call_enabled"] = update.incoming_call_enabled
  ```

- [ ] **Step 4: Run the backend tests**

Run: `uv run pytest tests/test_api_settings.py -q`
Expected: all pass.

- [ ] **Step 5: Write the failing locale test** — `frontend/src/i18n/incomingCall.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

const EXPECTED = {
    en: { incoming: 'Incoming call…', ended: 'Call ended' },
    ja: { incoming: '着信中…', ended: '通話終了' },
    'zh-TW': { incoming: '來電中…', ended: '通話結束' },
    'zh-CN': { incoming: '来电中…', ended: '通话结束' },
    yue: { incoming: '來電中…', ended: '通話結束' },
} as const;

describe('incoming call strings', () => {
    it.each(Object.entries(locales))('%s has every call and setting key', (_code, data) => {
        const call = (data as Record<string, Record<string, string>>).call;
        const settings = (data as Record<string, Record<string, string>>).settings;
        for (const key of ['incoming', 'ended', 'answer', 'decline', 'hangUp']) {
            expect(call?.[key], key).toBeTruthy();
        }
        expect(settings.incomingCall).toBeTruthy();
        expect(settings.incomingCallDesc).toBeTruthy();
    });

    it.each(Object.entries(EXPECTED))('%s uses the agreed wording', (code, want) => {
        const call = (locales[code as keyof typeof locales] as Record<string, Record<string, string>>).call;
        expect(call.incoming).toBe(want.incoming);
        expect(call.ended).toBe(want.ended);
    });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run (in `frontend/`): `npx vitest run src/i18n/incomingCall.test.ts`
Expected: FAIL (`call` is undefined).

- [ ] **Step 7: Add the strings**

In each locale JSON:
- add a new top-level `"call"` object (place it right after the top-level `"settings"` object);
- add the two `settings` keys right after `"syncReadToPhoneDesc"`.

Values:

| locale | call.incoming | call.ended | call.answer | call.decline | call.hangUp | settings.incomingCall | settings.incomingCallDesc |
|---|---|---|---|---|---|---|---|
| en | Incoming call… | Call ended | Answer | Decline | Hang up | Incoming calls | When you open a member's chat with an unheard voice message, play the newest one as an incoming call |
| ja | 着信中… | 通話終了 | 応答 | 拒否 | 終了 | 着信 | 未再生のボイスがあるメンバーのトークを開くと、最新のボイスを着信として再生します |
| zh-TW | 來電中… | 通話結束 | 接聽 | 拒接 | 掛斷 | 來電 | 打開有未聽語音的成員聊天室時，以來電方式播放最新語音 |
| zh-CN | 来电中… | 通话结束 | 接听 | 拒接 | 挂断 | 来电 | 打开有未听语音的成员聊天室时，以来电方式播放最新语音 |
| yue | 來電中… | 通話結束 | 接聽 | 拒接 | 收線 | 來電 | 打開有未聽語音嘅成員聊天室時，以來電方式播放最新語音 |

The ellipsis is the single character `…` (U+2026). Keep the JSON valid.

- [ ] **Step 8: Add the frontend setting field and the toggle**

In `MessagesFeature.tsx`, in `interface AppSettings`, after `sync_read_to_phone?`:

```ts
    incoming_call_enabled?: boolean;  // ring when opening a 1:1 chat whose newest voice is unheard (default on)
```

In `SettingsModal.tsx`, in the `activeTab === 'general'` block, directly after the Output Folder `<div>…</div>` and before `</>)}`:

```tsx
                    {/* Incoming call (default on) */}
                    <div>
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-700">
                                {t('settings.incomingCall')}
                            </label>
                            <button
                                role="switch"
                                aria-checked={appSettings.incoming_call_enabled ?? true}
                                aria-label={t('settings.incomingCall')}
                                onClick={() => onSaveSettings({ incoming_call_enabled: !(appSettings.incoming_call_enabled ?? true) })}
                                className={`relative w-12 h-6 rounded-full transition-colors ${
                                    (appSettings.incoming_call_enabled ?? true) ? 'bg-blue-400' : 'bg-gray-300'
                                }`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                                    (appSettings.incoming_call_enabled ?? true) ? 'translate-x-7' : 'translate-x-1'
                                }`} />
                            </button>
                        </div>
                        <p className="mt-2 max-w-md text-xs leading-relaxed text-gray-500">
                            {t('settings.incomingCallDesc')}
                        </p>
                    </div>
```

- [ ] **Step 9: Run the checks**

Run (in `frontend/`): `npx vitest run src/i18n/incomingCall.test.ts && npx tsc --noEmit`
Expected: PASS, and no type errors.

- [ ] **Step 10: Commit**

```bash
git add backend/api/settings.py tests/test_api_settings.py frontend/src/features/messages/MessagesFeature.tsx frontend/src/shell/components/SettingsModal.tsx frontend/src/i18n/locales/*.json frontend/src/i18n/incomingCall.test.ts
uv run git commit -F <msg>   # feat(settings): add incoming call toggle and strings
```

---

### Task 3: Shared media URL builder and the pure call decision

**Files:**
- Create: `frontend/src/features/messages/mediaUrl.ts`, `frontend/src/features/messages/mediaUrl.test.ts`
- Modify: `frontend/src/features/messages/components/MessageBubble.tsx`, at about lines 204–209 (the `mediaUrl` const)
- Create: `frontend/src/features/incomingCall/callDecision.ts`, `frontend/src/features/incomingCall/callDecision.test.ts`

**Interfaces:**
- Produces:
  - `buildMediaUrl(service: string, mediaFile: string, apiBase?: string): string`; the default `apiBase` is `'/api/content/media'`;
  - `pickCandidate(messages: Message[]): Message | undefined`;
  - `decideCall(input: CallDecisionInput): CallDecision`;
  - the types `CallSkipReason`, `CallDecisionInput` and `CallDecision`, exactly as in the code below.

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/messages/mediaUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMediaUrl } from './mediaUrl';

describe('buildMediaUrl', () => {
    it('encodes the service and each path segment, keeping slashes', () => {
        expect(buildMediaUrl('日向坂46', 'messages/34 金村 美玖/58 金村 美玖/voice/1.m4a')).toBe(
            '/api/content/media/%E6%97%A5%E5%90%91%E5%9D%8246/messages/34%20%E9%87%91%E6%9D%91%20%E7%BE%8E%E7%8E%96/58%20%E9%87%91%E6%9D%91%20%E7%BE%8E%E7%8E%96/voice/1.m4a',
        );
    });

    it('honours a custom api base', () => {
        expect(buildMediaUrl('s', 'a/b.m4a', '/x')).toBe('/x/s/a/b.m4a');
    });
});
```

`frontend/src/features/incomingCall/callDecision.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Message } from '../../types';
import { decideCall, pickCandidate, type CallDecisionInput } from './callDecision';

const msg = (id: number, timestamp: string, type: Message['type'] = 'voice'): Message => ({
    id, timestamp, type, is_favorite: false, content: null,
    media_file: type === 'voice' ? `messages/1 a/2 b/voice/${id}.m4a` : undefined,
});

const base = (over: Partial<CallDecisionInput> = {}): CallDecisionInput => ({
    enabled: true,
    isGroupChat: false,
    messages: [msg(10, '2026-11-01T10:00:00Z')],
    isUnread: () => true,
    photoUrl: '/img/phone.jpg',
    dismissedIds: new Set<number>(),
    callActive: false,
    ...over,
});

describe('pickCandidate', () => {
    it('ignores non-voice messages', () => {
        expect(pickCandidate([msg(1, '2026-11-02T00:00:00Z', 'text')])).toBeUndefined();
    });

    it('picks by newest timestamp, not by id', () => {
        const older = msg(99, '2026-11-01T00:00:00Z');
        const newer = msg(5, '2026-11-02T00:00:00Z');
        expect(pickCandidate([older, newer])?.id).toBe(5);
        expect(pickCandidate([newer, older])?.id).toBe(5);
    });

    it('breaks a timestamp tie by the larger id', () => {
        const a = msg(7, '2026-11-02T00:00:00Z');
        const b = msg(8, '2026-11-02T00:00:00Z');
        expect(pickCandidate([b, a])?.id).toBe(8);
    });
});

describe('decideCall', () => {
    it('rings for an unread newest voice in a 1:1 chat', () => {
        const d = decideCall(base());
        expect(d).toEqual({ ring: true, message: expect.objectContaining({ id: 10 }) });
    });

    it.each([
        ['disabled', { enabled: false }],
        ['group_chat', { isGroupChat: true }],
        ['no_voice', { messages: [msg(1, '2026-11-01T00:00:00Z', 'text')] }],
    ] as const)('skips with %s before looking at a candidate', (reason, over) => {
        expect(decideCall(base(over))).toEqual({ ring: false, reason });
    });

    it('skips already_read when the candidate is below lastReadId', () => {
        const readState = { lastReadId: 10, revealedIds: [] as number[] };
        const isUnread = (id: number) => id > readState.lastReadId && !readState.revealedIds.includes(id);
        expect(decideCall(base({ isUnread }))).toEqual({ ring: false, reason: 'already_read', messageId: 10 });
    });

    it('skips already_read when the candidate was revealed individually', () => {
        const readState = { lastReadId: 0, revealedIds: [10] };
        const isUnread = (id: number) => id > readState.lastReadId && !readState.revealedIds.includes(id);
        expect(decideCall(base({ isUnread }))).toEqual({ ring: false, reason: 'already_read', messageId: 10 });
    });

    it('only the newest voice matters: an older unread voice does not ring', () => {
        const messages = [msg(1, '2026-11-01T00:00:00Z'), msg(2, '2026-11-02T00:00:00Z')];
        const isUnread = (id: number) => id === 1;
        expect(decideCall(base({ messages, isUnread }))).toEqual({ ring: false, reason: 'already_read', messageId: 2 });
    });

    it.each([
        ['no_photo', { photoUrl: undefined }],
        ['dismissed_this_visit', { dismissedIds: new Set([10]) }],
        ['call_active', { callActive: true }],
    ] as const)('skips with %s', (reason, over) => {
        expect(decideCall(base(over))).toEqual({ ring: false, reason, messageId: 10 });
    });

    it('checks conditions in spec order (no_photo wins over dismissed)', () => {
        expect(decideCall(base({ photoUrl: undefined, dismissedIds: new Set([10]), callActive: true }))).toEqual({
            ring: false, reason: 'no_photo', messageId: 10,
        });
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `frontend/`): `npx vitest run src/features/messages/mediaUrl.test.ts src/features/incomingCall/callDecision.test.ts`
Expected: FAIL. The modules are not found.

- [ ] **Step 3: Implement**

`frontend/src/features/messages/mediaUrl.ts`:

```ts
export const MEDIA_API_BASE = '/api/content/media';

/**
 * URL for an archived media file. `mediaFile` is relative to the service dir
 * (e.g. "messages/62 石森 璃花/.../voice/346492.m4a"); each path segment is
 * encoded so spaces and CJK survive, slashes are kept.
 */
export function buildMediaUrl(service: string, mediaFile: string, apiBase: string = MEDIA_API_BASE): string {
    return `${apiBase}/${encodeURIComponent(service)}/${mediaFile.split('/').map(encodeURIComponent).join('/')}`;
}
```

In `MessageBubble.tsx`, replace the existing `mediaUrl` computation (keep the two explanatory comments above it) with:

```ts
    const mediaUrl = message.media_file && service
        ? buildMediaUrl(service, message.media_file, api_base)
        : null;
```

Then add `import { buildMediaUrl } from '../mediaUrl';` to its imports.

`frontend/src/features/incomingCall/callDecision.ts`:

```ts
import type { Message } from '../../types';

/** Why a call did not ring. Logged verbatim as the `reason` breadcrumb field. */
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

function timeOf(m: Message): number {
    const t = Date.parse(m.timestamp);
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** The newest voice message by timestamp; ties go to the larger id. */
export function pickCandidate(messages: Message[]): Message | undefined {
    let best: Message | undefined;
    for (const m of messages) {
        if (m.type !== 'voice') continue;
        if (!best) {
            best = m;
            continue;
        }
        const a = timeOf(m);
        const b = timeOf(best);
        if (a > b || (a === b && m.id > best.id)) best = m;
    }
    return best;
}

/** Decide whether to ring. Conditions are checked in spec order; the first failure is the reason. */
export function decideCall(input: CallDecisionInput): CallDecision {
    if (!input.enabled) return { ring: false, reason: 'disabled' };
    if (input.isGroupChat) return { ring: false, reason: 'group_chat' };
    const candidate = pickCandidate(input.messages);
    if (!candidate) return { ring: false, reason: 'no_voice' };
    const messageId = candidate.id;
    if (!input.isUnread(messageId)) return { ring: false, reason: 'already_read', messageId };
    if (!input.photoUrl) return { ring: false, reason: 'no_photo', messageId };
    if (input.dismissedIds.has(messageId)) return { ring: false, reason: 'dismissed_this_visit', messageId };
    if (input.callActive) return { ring: false, reason: 'call_active', messageId };
    return { ring: true, message: candidate };
}
```

- [ ] **Step 4: Run the tests, including the existing bubble tests**

Run (in `frontend/`): `npx vitest run src/features/messages/mediaUrl.test.ts src/features/incomingCall/callDecision.test.ts src/features/messages/components/MessageBubble.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/messages/mediaUrl.ts frontend/src/features/messages/mediaUrl.test.ts frontend/src/features/messages/components/MessageBubble.tsx frontend/src/features/incomingCall/callDecision.ts frontend/src/features/incomingCall/callDecision.test.ts
uv run git commit -F <msg>   # feat(call): add incoming call decision rules
```

---

### Task 4: Audio preload and the `useIncomingCall` state machine

**Files:**
- Create: `frontend/src/features/incomingCall/preloadAudio.ts`, `frontend/src/features/incomingCall/preloadAudio.test.ts`
- Create: `frontend/src/features/incomingCall/useIncomingCall.ts`, `frontend/src/features/incomingCall/useIncomingCall.test.ts`

**Interfaces:**
- Consumes:
  - `decideCall` and `CallDecision` (Task 3);
  - `buildMediaUrl` (Task 3);
  - `clientLog` and `ClientLogFields` (Task 1);
  - `memberImageUrl(member, kind)` from `features/messages/profileImages.ts`.
- Produces:
  - `preloadAudio(url: string, timeoutMs?: number): Promise<void>`;
  - `PRELOAD_TIMEOUT_MS = 10_000`, `RING_TIMEOUT_MS = 30_000`, `ENDED_HOLD_MS = 800`;
  - `type CallPhase = 'idle' | 'ringing' | 'connected' | 'ended'`;
  - `interface CallLogContext { service: string; groupId: number; memberId: number }` (the same shape `parseReadStatePath` returns);
  - `interface UseIncomingCallArgs` and `interface IncomingCall`, exactly as in the code below;
  - `useIncomingCall(args: UseIncomingCallArgs, preload?: (url: string) => Promise<void>): IncomingCall`.

- [ ] **Step 1: Write the failing preload test** — `preloadAudio.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { preloadAudio } from './preloadAudio';

class FakeAudio extends EventTarget {
    static last: FakeAudio | null = null;
    preload = '';
    private _src = '';
    constructor() { super(); FakeAudio.last = this; }
    get src() { return this._src; }
    set src(v: string) { this._src = v; }
    removeAttribute() { this._src = ''; }
    load() {}
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('preloadAudio', () => {
    it('resolves on canplay and sets src', async () => {
        vi.stubGlobal('Audio', FakeAudio);
        const p = preloadAudio('/a.m4a');
        expect(FakeAudio.last?.src).toBe('/a.m4a');
        FakeAudio.last!.dispatchEvent(new Event('canplay'));
        await expect(p).resolves.toBeUndefined();
    });

    it('rejects on error', async () => {
        vi.stubGlobal('Audio', FakeAudio);
        const p = preloadAudio('/missing.m4a');
        FakeAudio.last!.dispatchEvent(new Event('error'));
        await expect(p).rejects.toThrow('media_unavailable');
    });

    it('rejects after the timeout when nothing happens', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('Audio', FakeAudio);
        const p = preloadAudio('/slow.m4a', 1000);
        const assertion = expect(p).rejects.toThrow('media_unavailable');
        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
    });
});
```

- [ ] **Step 2: Implement** `preloadAudio.ts`

```ts
export const PRELOAD_TIMEOUT_MS = 10_000;

/**
 * Load an audio file far enough to play. Resolves on `canplay`; rejects on
 * `error` or when nothing happens within `timeoutMs`. pysaka writes
 * `media_file` when the download is queued, so a URL may 404 until the file
 * is on disk; ringing only after this succeeds avoids a call with no voice.
 */
export function preloadAudio(url: string, timeoutMs: number = PRELOAD_TIMEOUT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
        const audio = new Audio();
        let settled = false;
        const settle = (ok: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (ok) {
                resolve();
            } else {
                audio.removeAttribute('src');
                audio.load();
                reject(new Error('media_unavailable'));
            }
        };
        const timer = setTimeout(() => settle(false), timeoutMs);
        audio.addEventListener('canplay', () => settle(true), { once: true });
        audio.addEventListener('error', () => settle(false), { once: true });
        audio.preload = 'auto';
        audio.src = url;
    });
}
```

Run (in `frontend/`): `npx vitest run src/features/incomingCall/preloadAudio.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing hook test** — `useIncomingCall.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MemberInfo, Message } from '../../types';
import { clientLog } from '../../utils/clientLog';
import {
    useIncomingCall, ENDED_HOLD_MS, RING_TIMEOUT_MS, type UseIncomingCallArgs,
} from './useIncomingCall';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
const log = vi.mocked(clientLog);

const voice = (id: number, ts: string): Message => ({
    id, timestamp: ts, type: 'voice', is_favorite: false, content: null,
    media_file: `messages/34 金村 美玖/58 金村 美玖/voice/${id}.m4a`,
});
const member: MemberInfo = { id: 58, name: '金村 美玖', phone_image_local: '/img/phone.jpg' };
const DIR = '日向坂46/messages/34 金村 美玖/58 金村 美玖';

function makeArgs(over: Partial<UseIncomingCallArgs> = {}): UseIncomingCallArgs {
    return {
        service: 'hinatazaka46',
        chatDir: DIR,
        isGroupChat: false,
        messages: [voice(10, '2026-11-01T10:00:00Z')],
        member,
        name: '金村 美玖',
        enabled: true,
        isUnread: () => true,
        freshFetch: { seq: 1, dir: DIR },
        revealMessage: vi.fn(),
        scrollToMessage: vi.fn(),
        logContext: { service: 'hinatazaka46', groupId: 34, memberId: 58 },
        ...over,
    };
}

const events = () => log.mock.calls.map(c => c[0]);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => { vi.useFakeTimers(); log.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

async function ringing(over: Partial<UseIncomingCallArgs> = {}, preload = vi.fn(() => Promise.resolve())) {
    const hook = renderHook(({ a }) => useIncomingCall(a, preload), { initialProps: { a: makeArgs(over) } });
    await flush();
    return { ...hook, preload };
}

describe('useIncomingCall', () => {
    it('rings after a fresh fetch and preloads the audio URL', async () => {
        const { result, preload } = await ringing();
        expect(preload).toHaveBeenCalledWith(expect.stringContaining('/api/content/media/hinatazaka46/messages/'));
        expect(result.current.phase).toBe('ringing');
        expect(result.current.message?.id).toBe(10);
        expect(result.current.photoUrl).toBe('/img/phone.jpg');
        expect(log).toHaveBeenCalledWith('call_ring', { service: 'hinatazaka46', group_id: 34, member_id: 58, message_id: 10 });
    });

    it('does not ring without a fresh fetch for this chat (cached render)', async () => {
        const { result } = await ringing({ freshFetch: null });
        expect(result.current.phase).toBe('idle');
        const other = await ringing({ freshFetch: { seq: 1, dir: 'other/dir' } });
        expect(other.result.current.phase).toBe('idle');
    });

    it('does not ring while settings are not loaded', async () => {
        const { result } = await ringing({ enabled: undefined });
        expect(result.current.phase).toBe('idle');
        expect(log).toHaveBeenCalledWith('call_skip', expect.objectContaining({ reason: 'disabled' }));
    });

    it('logs media_unavailable once per visit when preload fails, and does not ring', async () => {
        const failing = vi.fn(() => Promise.reject(new Error('media_unavailable')));
        const { result, rerender } = await ringing({}, failing);
        expect(result.current.phase).toBe('idle');
        rerender({ a: makeArgs({ freshFetch: { seq: 2, dir: DIR } }) });
        await flush();
        const errors = log.mock.calls.filter(c => c[0] === 'call_error');
        expect(errors).toHaveLength(1);
        expect(errors[0][1]).toMatchObject({ message_id: 10, error_type: 'media_unavailable', phase: 'idle' });
    });

    it('decline keeps the voice unread and suppresses re-ring for this visit only', async () => {
        const { result, rerender } = await ringing();
        act(() => result.current.decline());
        expect(result.current.phase).toBe('idle');
        expect(events()).toContain('call_decline');
        rerender({ a: makeArgs({ freshFetch: { seq: 2, dir: DIR } }) });
        await flush();
        expect(result.current.phase).toBe('idle');
        expect(log).toHaveBeenCalledWith('call_skip', expect.objectContaining({ reason: 'dismissed_this_visit' }));
        // leave and come back → new visit → rings again
        rerender({ a: makeArgs({ chatDir: 'other', freshFetch: { seq: 3, dir: 'other' }, isGroupChat: true }) });
        await flush();
        rerender({ a: makeArgs({ freshFetch: { seq: 4, dir: DIR } }) });
        await flush();
        expect(result.current.phase).toBe('ringing');
    });

    it('a newer voice during the visit rings even after a decline', async () => {
        const { result, rerender } = await ringing();
        act(() => result.current.decline());
        rerender({ a: makeArgs({ messages: [voice(10, '2026-11-01T10:00:00Z'), voice(11, '2026-11-01T11:00:00Z')], freshFetch: { seq: 2, dir: DIR } }) });
        await flush();
        expect(result.current.phase).toBe('ringing');
        expect(result.current.message?.id).toBe(11);
    });

    it('times out after 30 s like a decline', async () => {
        const { result } = await ringing();
        act(() => { vi.advanceTimersByTime(RING_TIMEOUT_MS); });
        expect(result.current.phase).toBe('idle');
        expect(log).toHaveBeenCalledWith('call_timeout', { message_id: 10 });
    });

    it('answer reveals, plays to the end, holds the ended screen, then scrolls', async () => {
        const revealMessage = vi.fn();
        const scrollToMessage = vi.fn();
        const { result } = await ringing({ revealMessage, scrollToMessage });
        act(() => result.current.answer());
        expect(revealMessage).toHaveBeenCalledWith(10);
        expect(result.current.phase).toBe('connected');
        expect(result.current.talkStartedAt).not.toBeNull();
        expect(log).toHaveBeenCalledWith('call_answer', expect.objectContaining({ message_id: 10 }));
        act(() => result.current.onPlaybackEnded());
        expect(result.current.phase).toBe('ended');
        expect(log).toHaveBeenCalledWith('call_end', expect.objectContaining({ message_id: 10, reason: 'played' }));
        expect(scrollToMessage).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(ENDED_HOLD_MS); });
        expect(result.current.phase).toBe('idle');
        expect(scrollToMessage).toHaveBeenCalledWith(10);
    });

    it('hang up ends the call with reason hung_up', async () => {
        const { result } = await ringing();
        act(() => result.current.answer());
        act(() => result.current.hangUp());
        expect(result.current.phase).toBe('ended');
        expect(log).toHaveBeenCalledWith('call_end', expect.objectContaining({ reason: 'hung_up' }));
    });

    it('playback error logs call_error and goes to ended', async () => {
        const { result } = await ringing();
        act(() => result.current.answer());
        act(() => result.current.onPlaybackError());
        expect(result.current.phase).toBe('ended');
        expect(log).toHaveBeenCalledWith('call_error', expect.objectContaining({ error_type: 'playback_failed', phase: 'connected' }));
    });

    it.each(['ringing', 'connected'] as const)('switching chat while %s cancels without scrolling', async (phase) => {
        const scrollToMessage = vi.fn();
        const { result, rerender } = await ringing({ scrollToMessage });
        if (phase === 'connected') act(() => result.current.answer());
        rerender({ a: makeArgs({ chatDir: 'other', freshFetch: null, scrollToMessage }) });
        await flush();
        expect(result.current.phase).toBe('idle');
        expect(log).toHaveBeenCalledWith('call_cancel', { message_id: 10, phase });
        act(() => { vi.advanceTimersByTime(ENDED_HOLD_MS + RING_TIMEOUT_MS); });
        expect(scrollToMessage).not.toHaveBeenCalled();
    });

    it('does not ring if the voice was read while the preload was in flight', async () => {
        let release!: () => void;
        const slow = vi.fn(() => new Promise<void>(r => { release = r; }));
        let unread = true;
        const { result } = renderHook(({ a }) => useIncomingCall(a, slow), {
            initialProps: { a: makeArgs({ isUnread: () => unread }) },
        });
        unread = false;
        await act(async () => { release(); await Promise.resolve(); });
        expect(result.current.phase).toBe('idle');
    });

    it('logs the same skip only once per chat', async () => {
        const { rerender } = await ringing({ isUnread: () => false });
        rerender({ a: makeArgs({ isUnread: () => false, freshFetch: { seq: 2, dir: DIR } }) });
        await flush();
        expect(log.mock.calls.filter(c => c[0] === 'call_skip')).toHaveLength(1);
    });

    it('never logs names, text or URLs', async () => {
        const { result } = await ringing();
        act(() => result.current.answer());
        act(() => result.current.onPlaybackEnded());
        for (const [, fields] of log.mock.calls) {
            for (const v of Object.values(fields ?? {})) {
                if (typeof v === 'string') expect(v).toMatch(/^[a-z0-9_]{1,40}$/);
            }
        }
    });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run (in `frontend/`): `npx vitest run src/features/incomingCall/useIncomingCall.test.ts`
Expected: FAIL. The module is not found.

- [ ] **Step 5: Implement** `useIncomingCall.ts`

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MemberInfo, Message } from '../../types';
import { memberImageUrl } from '../messages/profileImages';
import { buildMediaUrl } from '../messages/mediaUrl';
import { clientLog, type ClientLogFields } from '../../utils/clientLog';
import { decideCall, type CallDecision } from './callDecision';
import { preloadAudio } from './preloadAudio';

export type CallPhase = 'idle' | 'ringing' | 'connected' | 'ended';

export const RING_TIMEOUT_MS = 30_000;
export const ENDED_HOLD_MS = 800;

/** Same shape as MessagesFeature's parseReadStatePath result. */
export interface CallLogContext {
    service: string;
    groupId: number;
    memberId: number;
}

export interface UseIncomingCallArgs {
    /** Service used to build media URLs (MessagesFeature's messagesService). */
    service: string | null;
    /** Selected chat dir; a change starts a new visit. */
    chatDir: string | undefined;
    isGroupChat: boolean;
    messages: Message[];
    member: MemberInfo | undefined;
    /** Display name for the call screen. */
    name: string;
    /** The incoming_call_enabled setting; undefined while settings load (treated as off). */
    enabled: boolean | undefined;
    isUnread: (id: number) => boolean;
    /** Bumped by MessagesFeature when a fresh fetch completes for `dir`. */
    freshFetch: { seq: number; dir: string } | null;
    revealMessage: (id: number) => void;
    scrollToMessage: (id: number) => void;
    logContext: CallLogContext | null;
}

export interface IncomingCall {
    phase: CallPhase;
    message: Message | null;
    name: string;
    photoUrl: string;
    audioUrl: string;
    /** Date.now() when the call was answered; null unless connected/ended. */
    talkStartedAt: number | null;
    answer: () => void;
    decline: () => void;
    hangUp: () => void;
    onPlaybackEnded: () => void;
    onPlaybackError: () => void;
}

interface ActiveCall {
    message: Message;
    name: string;
    photoUrl: string;
    audioUrl: string;
}

/**
 * Incoming-call state machine for the selected chat (spec §2.4).
 * Every decision, skip and failure is logged through clientLog.
 */
export function useIncomingCall(
    args: UseIncomingCallArgs,
    preload: (url: string) => Promise<void> = preloadAudio,
): IncomingCall {
    const [phase, setPhase] = useState<CallPhase>('idle');
    const [call, setCall] = useState<ActiveCall | null>(null);
    const [talkStartedAt, setTalkStartedAt] = useState<number | null>(null);

    // Latest props for timers/promises that outlive the render they started in.
    const argsRef = useRef(args);
    argsRef.current = args;
    const preloadRef = useRef(preload);
    preloadRef.current = preload;

    const phaseRef = useRef<CallPhase>('idle');
    const callRef = useRef<ActiveCall | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ringStartedAtRef = useRef(0);
    const talkStartedAtRef = useRef(0);
    // Bumped by every evaluation and visit change; a preload may only ring if
    // its evaluation is still the latest.
    const evalIdRef = useRef(0);
    const dismissedRef = useRef(new Set<number>());
    const mediaErrorLoggedRef = useRef(new Set<number>());
    const lastSkipRef = useRef(new Map<string, string>());

    const ctxFields = useCallback((): ClientLogFields => {
        const c = argsRef.current.logContext;
        return c ? { service: c.service, group_id: c.groupId, member_id: c.memberId } : {};
    }, []);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const enter = useCallback((next: CallPhase) => {
        phaseRef.current = next;
        setPhase(next);
    }, []);

    const toIdle = useCallback(() => {
        clearTimer();
        callRef.current = null;
        setCall(null);
        setTalkStartedAt(null);
        enter('idle');
    }, [clearTimer, enter]);

    const toEnded = useCallback(() => {
        clearTimer();
        enter('ended');
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            const id = callRef.current?.message.id;
            toIdle();
            if (id !== undefined) argsRef.current.scrollToMessage(id);
        }, ENDED_HOLD_MS);
    }, [clearTimer, enter, toIdle]);

    const startRinging = useCallback((active: ActiveCall) => {
        clearTimer();
        callRef.current = active;
        setCall(active);
        ringStartedAtRef.current = Date.now();
        enter('ringing');
        clientLog('call_ring', { ...ctxFields(), message_id: active.message.id });
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            dismissedRef.current.add(active.message.id);
            clientLog('call_timeout', { message_id: active.message.id });
            toIdle();
        }, RING_TIMEOUT_MS);
    }, [clearTimer, ctxFields, enter, toIdle]);

    const logSkip = useCallback((chatDir: string, d: Extract<CallDecision, { ring: false }>) => {
        const key = `${d.messageId ?? ''}:${d.reason}`;
        if (lastSkipRef.current.get(chatDir) === key) return;
        lastSkipRef.current.set(chatDir, key);
        clientLog('call_skip', {
            ...ctxFields(),
            ...(d.messageId !== undefined ? { message_id: d.messageId } : {}),
            reason: d.reason,
        });
    }, [ctxFields]);

    // A new visit starts whenever the selected chat changes; leaving cancels any call.
    useEffect(() => {
        evalIdRef.current += 1;
        dismissedRef.current = new Set();
        mediaErrorLoggedRef.current = new Set();
        return () => {
            evalIdRef.current += 1;
            const active = callRef.current;
            if (phaseRef.current !== 'idle' && active) {
                clientLog('call_cancel', { message_id: active.message.id, phase: phaseRef.current });
            }
            toIdle();
        };
    }, [args.chatDir, toIdle]);

    // Evaluate after each fresh fetch of the selected chat (never on the cached render).
    const freshSeq = args.freshFetch?.seq;
    useEffect(() => {
        const a = argsRef.current;
        if (freshSeq === undefined || !a.chatDir || a.freshFetch?.dir !== a.chatDir) return;
        const chatDir = a.chatDir;
        const evalId = ++evalIdRef.current;
        const photoUrl = memberImageUrl(a.member, 'phone_image') || memberImageUrl(a.member, 'thumbnail');
        const decision = decideCall({
            enabled: a.enabled === true,
            isGroupChat: a.isGroupChat,
            messages: a.messages,
            isUnread: a.isUnread,
            photoUrl,
            dismissedIds: dismissedRef.current,
            callActive: phaseRef.current !== 'idle',
        });
        if (!decision.ring) {
            logSkip(chatDir, decision);
            return;
        }
        const message = decision.message;
        const fail = () => {
            if (evalId !== evalIdRef.current || mediaErrorLoggedRef.current.has(message.id)) return;
            mediaErrorLoggedRef.current.add(message.id);
            clientLog('call_error', {
                ...ctxFields(), message_id: message.id, error_type: 'media_unavailable', phase: 'idle',
            });
        };
        const audioUrl = a.service && message.media_file ? buildMediaUrl(a.service, message.media_file) : '';
        if (!audioUrl) {
            fail();
            return;
        }
        preloadRef.current(audioUrl).then(
            () => {
                const latest = argsRef.current;
                if (evalId !== evalIdRef.current || phaseRef.current !== 'idle') return;
                if (latest.chatDir !== chatDir || !latest.isUnread(message.id)) return;
                startRinging({ message, name: a.name, photoUrl: photoUrl as string, audioUrl });
            },
            fail,
        );
    }, [freshSeq, ctxFields, logSkip, startRinging]);

    const answer = useCallback(() => {
        const active = callRef.current;
        if (phaseRef.current !== 'ringing' || !active) return;
        clearTimer();
        argsRef.current.revealMessage(active.message.id);
        const now = Date.now();
        clientLog('call_answer', { message_id: active.message.id, ring_ms: now - ringStartedAtRef.current });
        talkStartedAtRef.current = now;
        setTalkStartedAt(now);
        enter('connected');
    }, [clearTimer, enter]);

    const decline = useCallback(() => {
        const active = callRef.current;
        if (phaseRef.current !== 'ringing' || !active) return;
        dismissedRef.current.add(active.message.id);
        clientLog('call_decline', { message_id: active.message.id, ring_ms: Date.now() - ringStartedAtRef.current });
        toIdle();
    }, [toIdle]);

    const finish = useCallback((reason: 'played' | 'hung_up') => {
        const active = callRef.current;
        if (phaseRef.current !== 'connected' || !active) return;
        clientLog('call_end', { message_id: active.message.id, reason, talk_ms: Date.now() - talkStartedAtRef.current });
        toEnded();
    }, [toEnded]);

    const hangUp = useCallback(() => finish('hung_up'), [finish]);
    const onPlaybackEnded = useCallback(() => finish('played'), [finish]);

    const onPlaybackError = useCallback(() => {
        const active = callRef.current;
        if (phaseRef.current !== 'connected' || !active) return;
        clientLog('call_error', {
            ...ctxFields(), message_id: active.message.id, error_type: 'playback_failed', phase: 'connected',
        });
        toEnded();
    }, [ctxFields, toEnded]);

    return {
        phase,
        message: call?.message ?? null,
        name: call?.name ?? '',
        photoUrl: call?.photoUrl ?? '',
        audioUrl: call?.audioUrl ?? '',
        talkStartedAt,
        answer,
        decline,
        hangUp,
        onPlaybackEnded,
        onPlaybackError,
    };
}
```

- [ ] **Step 6: Run the tests**

Run (in `frontend/`): `npx vitest run src/features/incomingCall/`
Expected: all pass.

If a test that awaits the preload sees `idle`, the promise chain needs one more microtask tick. Increase the `flush()` awaits; do not change the hook.

- [ ] **Step 7: Lint and typecheck**

Run (in `frontend/`): `npx tsc --noEmit && npx eslint src/features/incomingCall --ext ts,tsx`
Expected: no errors and no new warnings.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/incomingCall/preloadAudio.ts frontend/src/features/incomingCall/preloadAudio.test.ts frontend/src/features/incomingCall/useIncomingCall.ts frontend/src/features/incomingCall/useIncomingCall.test.ts
uv run git commit -F <msg>   # feat(call): add incoming call state machine
```

---

### Task 5: `CallScreen` and `CallOverlay`

**Files:**
- Create: `frontend/src/features/incomingCall/CallScreen.tsx`, `CallScreen.test.tsx`, `CallOverlay.tsx`, `CallOverlay.test.tsx`
- Modify: `frontend/src/core/media/VoicePlayer.tsx` line 14: `const VOLUME_STORAGE_KEY` → `export const VOLUME_STORAGE_KEY`

**Interfaces:**
- Consumes:
  - `IncomingCall` and `CallPhase` (Task 4);
  - i18n keys `call.*` (Task 2);
  - `useAmplifiedVolume(storageKey)` from `core/media/useAmplifiedVolume.ts`, which returns `{ connectElement }` among other things;
  - `VOLUME_STORAGE_KEY` from `core/media/VoicePlayer.tsx`.
- Produces:
  - `CallScreen` with props `{ phase: Exclude<CallPhase,'idle'>; name: string; photoUrl: string; talkSeconds: number; onAnswer; onDecline; onHangUp }`;
  - `formatTalkTime(seconds: number): string` (`m:ss`);
  - `CallOverlay` with props `{ call: IncomingCall }`.

- [ ] **Step 1: Write the failing tests**

`CallScreen.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CallScreen, formatTalkTime } from './CallScreen';

const props = {
    name: '金村 美玖', photoUrl: '/img/phone.jpg', talkSeconds: 0,
    onAnswer: vi.fn(), onDecline: vi.fn(), onHangUp: vi.fn(),
};

describe('CallScreen', () => {
    it('ringing shows the name, the incoming text and answer/decline', () => {
        render(<CallScreen {...props} phase="ringing" />);
        expect(screen.getByText('金村 美玖')).toBeInTheDocument();
        expect(screen.getByText('Incoming call…')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
        fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
        expect(props.onAnswer).toHaveBeenCalledTimes(1);
        expect(props.onDecline).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Hang up' })).toBeNull();
    });

    it('connected shows the timer and only a hang-up button', () => {
        render(<CallScreen {...props} phase="connected" talkSeconds={75} />);
        expect(screen.getByText('1:15')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Hang up' }));
        expect(props.onHangUp).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    });

    it('ended shows the ended text and no buttons', () => {
        render(<CallScreen {...props} phase="ended" />);
        expect(screen.getByText('Call ended')).toBeInTheDocument();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('formats talk time as m:ss', () => {
        expect(formatTalkTime(0)).toBe('0:00');
        expect(formatTalkTime(9)).toBe('0:09');
        expect(formatTalkTime(600)).toBe('10:00');
    });
});
```

`CallOverlay.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { IncomingCall } from './useIncomingCall';
import { CallOverlay } from './CallOverlay';

const call = (over: Partial<IncomingCall> = {}): IncomingCall => ({
    phase: 'ringing',
    message: { id: 10, timestamp: '2026-11-01T10:00:00Z', type: 'voice', is_favorite: false, content: null },
    name: '金村 美玖', photoUrl: '/img/phone.jpg', audioUrl: '/api/content/media/x/a.m4a', talkStartedAt: null,
    answer: vi.fn(), decline: vi.fn(), hangUp: vi.fn(), onPlaybackEnded: vi.fn(), onPlaybackError: vi.fn(),
    ...over,
});

describe('CallOverlay', () => {
    it('renders nothing when idle', () => {
        const { container } = render(<CallOverlay call={call({ phase: 'idle', message: null })} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('Enter answers and Escape declines while ringing', () => {
        const c = call();
        render(<CallOverlay call={c} />);
        fireEvent.keyDown(window, { key: 'Enter' });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(c.answer).toHaveBeenCalledTimes(1);
        expect(c.decline).toHaveBeenCalledTimes(1);
    });

    it('Escape hangs up while connected; Enter does nothing', () => {
        const c = call({ phase: 'connected', talkStartedAt: Date.now() });
        render(<CallOverlay call={c} />);
        fireEvent.keyDown(window, { key: 'Enter' });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(c.answer).not.toHaveBeenCalled();
        expect(c.hangUp).toHaveBeenCalledTimes(1);
    });

    it('plays when connected and reports ended / error from the audio element', () => {
        const c = call({ phase: 'connected', talkStartedAt: Date.now() });
        render(<CallOverlay call={c} />);
        const audio = screen.getByTestId('call-audio') as HTMLAudioElement;
        expect(audio.getAttribute('src')).toBe('/api/content/media/x/a.m4a');
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
        fireEvent(audio, new Event('ended'));
        fireEvent(audio, new Event('error'));
        expect(c.onPlaybackEnded).toHaveBeenCalledTimes(1);
        expect(c.onPlaybackError).toHaveBeenCalledTimes(1);
    });

    it('reports a playback error when play() rejects', async () => {
        const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValueOnce(new Error('NotAllowedError'));
        const c = call({ phase: 'connected', talkStartedAt: Date.now() });
        render(<CallOverlay call={c} />);
        await vi.waitFor(() => expect(c.onPlaybackError).toHaveBeenCalledTimes(1));
        play.mockRestore();
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (in `frontend/`): `npx vitest run src/features/incomingCall/CallScreen.test.tsx src/features/incomingCall/CallOverlay.test.tsx`
Expected: FAIL. The modules are not found.

- [ ] **Step 3: Implement** `CallScreen.tsx`

```tsx
import React from 'react';
import { motion } from 'framer-motion';
import { Phone, PhoneOff } from 'lucide-react';
import { useTranslation } from '../../i18n';
import type { CallPhase } from './useIncomingCall';

export function formatTalkTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface CallScreenProps {
    phase: Exclude<CallPhase, 'idle'>;
    name: string;
    photoUrl: string;
    talkSeconds: number;
    onAnswer: () => void;
    onDecline: () => void;
    onHangUp: () => void;
}

/** The upright "phone". Presentational only; reused by the bottom-right popup (sub-project C). */
export const CallScreen: React.FC<CallScreenProps> = ({
    phase, name, photoUrl, talkSeconds, onAnswer, onDecline, onHangUp,
}) => {
    const { t } = useTranslation();
    return (
        <div className="relative w-[280px] h-[560px] rounded-[44px] bg-black p-2.5 shadow-2xl">
            <div className="relative w-full h-full rounded-[36px] overflow-hidden bg-gray-900">
                {phase === 'ringing' && (
                    <div className="flex flex-col h-full">
                        <div className="relative flex-1 overflow-hidden">
                            <motion.img
                                src={photoUrl}
                                alt=""
                                className="absolute inset-0 w-full h-full object-cover"
                                animate={{ scale: [1, 1.04, 1] }}
                                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                            />
                            <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/70 to-transparent text-white">
                                <p className="text-xl font-semibold">{name}</p>
                                <p className="text-sm opacity-90">{t('call.incoming')}</p>
                            </div>
                        </div>
                        <div className="flex items-center justify-around bg-white py-6">
                            <motion.button
                                type="button"
                                aria-label={t('call.decline')}
                                onClick={onDecline}
                                className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg"
                                animate={{ rotate: [0, -6, 6, 0] }}
                                transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 0.6 }}
                            >
                                <PhoneOff className="w-7 h-7" />
                            </motion.button>
                            <motion.button
                                type="button"
                                aria-label={t('call.answer')}
                                onClick={onAnswer}
                                className="w-16 h-16 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-lg"
                                animate={{ rotate: [0, 6, -6, 0] }}
                                transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 0.6 }}
                            >
                                <Phone className="w-7 h-7" />
                            </motion.button>
                        </div>
                    </div>
                )}

                {phase === 'connected' && (
                    <>
                        <img src={photoUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        <div className="absolute inset-x-0 top-0 pt-10 pb-8 text-center text-white bg-gradient-to-b from-black/60 to-transparent">
                            <p className="text-xl font-semibold">{name}</p>
                            <p className="text-sm tabular-nums opacity-90">{formatTalkTime(talkSeconds)}</p>
                        </div>
                        <div className="absolute inset-x-0 bottom-10 flex justify-center">
                            <button
                                type="button"
                                aria-label={t('call.hangUp')}
                                onClick={onHangUp}
                                className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg"
                            >
                                <PhoneOff className="w-7 h-7" />
                            </button>
                        </div>
                    </>
                )}

                {phase === 'ended' && (
                    <>
                        <img src={photoUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40 grayscale" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <p className="text-lg font-semibold text-white">{t('call.ended')}</p>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
```

- [ ] **Step 4: Implement** `CallOverlay.tsx`, and export the volume key

In `core/media/VoicePlayer.tsx` line 14, change `const VOLUME_STORAGE_KEY = 'sakadesk_voice_amp';` to `export const VOLUME_STORAGE_KEY = 'sakadesk_voice_amp';`.

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { useAmplifiedVolume } from '../../core/media/useAmplifiedVolume';
import { VOLUME_STORAGE_KEY as VOICE_VOLUME_KEY } from '../../core/media/VoicePlayer';
import { CallScreen } from './CallScreen';
import type { IncomingCall } from './useIncomingCall';

/** Covers the chat area while a call is active; owns the audio element and Esc/Enter keys. */
export const CallOverlay: React.FC<{ call: IncomingCall }> = ({ call }) => {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    // Same persisted volume as the voice player, so call volume matches.
    const { connectElement } = useAmplifiedVolume(VOICE_VOLUME_KEY);
    const [now, setNow] = useState(() => Date.now());
    const { phase, answer, decline, hangUp, onPlaybackError } = call;

    // Play from the start on connect; stop otherwise.
    useEffect(() => {
        const el = audioRef.current;
        if (!el) return;
        if (phase === 'connected') {
            el.currentTime = 0;
            el.play().catch(() => onPlaybackError());
        } else {
            el.pause();
        }
    }, [phase, onPlaybackError]);

    // Tick the talk timer while connected.
    useEffect(() => {
        if (phase !== 'connected') return;
        setNow(Date.now());
        const id = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(id);
    }, [phase]);

    // Capture-phase keys so the chat's own key handlers don't also react.
    useEffect(() => {
        if (phase === 'idle') return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (phase === 'ringing') decline();
                else if (phase === 'connected') hangUp();
                else return;
            } else if (e.key === 'Enter' && phase === 'ringing') {
                answer();
            } else {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [phase, answer, decline, hangUp]);

    if (phase === 'idle' || !call.message) return null;

    const talkSeconds = call.talkStartedAt ? (now - call.talkStartedAt) / 1000 : 0;

    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden" data-testid="call-overlay">
            <div
                aria-hidden
                className="absolute inset-0 scale-110 bg-cover bg-center blur-2xl"
                style={{ backgroundImage: `url("${call.photoUrl}")` }}
            />
            <div aria-hidden className="absolute inset-0 bg-black/40" />
            <div className="relative">
                <CallScreen
                    phase={phase}
                    name={call.name}
                    photoUrl={call.photoUrl}
                    talkSeconds={talkSeconds}
                    onAnswer={answer}
                    onDecline={decline}
                    onHangUp={hangUp}
                />
            </div>
            <audio
                data-testid="call-audio"
                ref={el => {
                    audioRef.current = el;
                    connectElement(el);
                }}
                src={call.audioUrl}
                preload="auto"
                onEnded={call.onPlaybackEnded}
                onError={call.onPlaybackError}
                className="hidden"
            />
        </div>
    );
};
```

- [ ] **Step 5: Run the tests, including the existing voice player tests**

Run (in `frontend/`): `npx vitest run src/features/incomingCall/ src/core/media/`
Expected: all pass.

- [ ] **Step 6: Typecheck**

Run (in `frontend/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/incomingCall/CallScreen.tsx frontend/src/features/incomingCall/CallScreen.test.tsx frontend/src/features/incomingCall/CallOverlay.tsx frontend/src/features/incomingCall/CallOverlay.test.tsx frontend/src/core/media/VoicePlayer.tsx
uv run git commit -F <msg>   # feat(call): add call screen and chat overlay
```

---

### Task 6: Wire into `MessagesFeature`, harness test, CHANGELOG

**Files:**
- Modify: `frontend/src/features/messages/MessagesFeature.tsx`. The anchors:
  - the imports at the top;
  - the state block near the `readState` declaration (about line 164);
  - `fetchMessages`, both success branches, right after `setCacheEntry(...)`;
  - near `scrollToFirstUnread` (about line 572);
  - the timeline container JSX (about line 756);
  - the two nav-button conditions (about lines 813 and 826).
- Create: `frontend/src/features/incomingCall/incomingCall.integration.test.tsx`
- Modify: `CHANGELOG.md`, `[Unreleased]` → `### Added`

**Interfaces:**
- Consumes:
  - `useIncomingCall`, `UseIncomingCallArgs` and `IncomingCall` (Task 4);
  - `CallOverlay` (Task 5);
  - `AppSettings.incoming_call_enabled` (Task 2).

- [ ] **Step 1: Write the failing harness test** — `incomingCall.integration.test.tsx`

This component wires the hook and the overlay exactly as `MessagesFeature` does in Step 3.

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { MemberInfo, Message } from '../../types';
import { useIncomingCall } from './useIncomingCall';
import { CallOverlay } from './CallOverlay';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

const DIR = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const member: MemberInfo = { id: 58, name: '金村 美玖', thumbnail_local: '/img/thumb.jpg' };
const voice: Message = {
    id: 10, timestamp: '2026-11-01T10:00:00Z', type: 'voice', is_favorite: false, content: null,
    media_file: 'messages/34 金村 美玖/58 金村 美玖/voice/10.m4a',
};

function Harness({ isGroupChat = false, enabled = true }: { isGroupChat?: boolean; enabled?: boolean }) {
    const call = useIncomingCall(
        {
            service: 'hinatazaka46', chatDir: DIR, isGroupChat, messages: [voice],
            member: isGroupChat ? undefined : member, name: '金村 美玖',
            enabled, isUnread: () => true, freshFetch: { seq: 1, dir: DIR },
            revealMessage: () => {}, scrollToMessage: () => {},
            logContext: { service: 'hinatazaka46', groupId: 34, memberId: 58 },
        },
        () => Promise.resolve(),
    );
    return <div className="relative"><CallOverlay call={call} /></div>;
}

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('incoming call wiring', () => {
    it('a 1:1 chat with an unheard voice shows the call (falls back to the chat icon)', async () => {
        render(<Harness />);
        await settle();
        expect(screen.getByTestId('call-overlay')).toBeInTheDocument();
        expect(screen.getByText('Incoming call…')).toBeInTheDocument();
    });

    it('a group chat never shows the call', async () => {
        render(<Harness isGroupChat />);
        await settle();
        expect(screen.queryByTestId('call-overlay')).toBeNull();
    });

    it('the setting off never shows the call', async () => {
        render(<Harness enabled={false} />);
        await settle();
        expect(screen.queryByTestId('call-overlay')).toBeNull();
    });
});
```

- [ ] **Step 2: Run it**

Run (in `frontend/`): `npx vitest run src/features/incomingCall/incomingCall.integration.test.tsx`
Expected: PASS. Tasks 4–5 already exist, so this locks in the wiring contract before `MessagesFeature` changes.

- [ ] **Step 3: Wire up `MessagesFeature.tsx`**

Imports:

```ts
import { useIncomingCall } from '../incomingCall/useIncomingCall';
import { CallOverlay } from '../incomingCall/CallOverlay';
```

State, next to the `readState` declaration:

```ts
    // Bumped after each successful fetch; the incoming-call hook evaluates on it
    // (never on the cached render, which may be stale).
    const [freshFetch, setFreshFetch] = useState<{ seq: number; dir: string } | null>(null);
```

In `fetchMessages`, in **both** success branches, immediately after the `setCacheEntry(path, …);` line:

```ts
                setFreshFetch(prev => ({ seq: (prev?.seq ?? 0) + 1, dir: path }));
```

After `scrollToFirstUnread`:

```ts
    const scrollToMessage = useCallback((id: number) => {
        const index = messages.findIndex(m => m.id === id);
        if (index !== -1) {
            virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' });
        }
    }, [messages]);

    const callMember = isGroupChat ? undefined : Object.values(membersMap)[0];
    const incomingCall = useIncomingCall({
        service: messagesService,
        chatDir: selectedGroupDir,
        isGroupChat,
        messages,
        member: callMember,
        name: formatName(callMember?.name || selectedName || ''),
        // undefined until settings load → no ring; a loaded value without the field defaults on
        enabled: appSettings ? (appSettings.incoming_call_enabled ?? true) : undefined,
        isUnread,
        freshFetch,
        revealMessage,
        scrollToMessage,
        logContext: selectedGroupDir ? parseReadStatePath(selectedGroupDir) : null,
    });
    const callActive = incomingCall.phase !== 'idle';
```

`isUnread` and `revealMessage` must be declared above this block. If either is declared later in the file, place this block after the later of the two.

In the timeline container (`<div className="flex-1 overflow-hidden relative isolate" …>`), add this as its last child, after the `MessageList` conditional:

```tsx
                    <CallOverlay call={incomingCall} />
```

In the two nav-button conditions, add `&& !callActive`:

```tsx
                {selectedGroupDir && hasUnreadAbove && !callActive && (
```
```tsx
                {selectedGroupDir && hasUnreadBelow && !callActive && (
```

- [ ] **Step 4: Run the frontend suite and checks**

Run (in `frontend/`): `npx tsc --noEmit && npx vitest run && npm run lint`
Expected:
- tsc clean;
- all tests pass;
- lint stays within `--max-warnings 20` with no new warnings from the touched files.

- [ ] **Step 5: CHANGELOG**

Under `## [Unreleased]` → `### Added`, append:

```markdown
- **Incoming calls for new voice messages.** Opening a member's chat whose
  newest voice message you haven't heard rings like a phone call; answer to
  play it, or decline and it rings again the next time you open the chat.
  You can turn this off in Settings.
```

- [ ] **Step 6: Run the backend suite**

Run: `uv run pytest -q`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/messages/MessagesFeature.tsx frontend/src/features/incomingCall/incomingCall.integration.test.tsx CHANGELOG.md
uv run git commit -F <msg>   # feat(call): ring for unheard voice when opening a chat
```

---

### Task 7: Windows manual verification (controller, not a subagent)

Use the copy at `C:\D\saka-verify`. Never the live archive, and never log in on WSL.

- [ ] Build the Windows dev exe from this branch. Launch it with `SAKADESK_DATA_DIR=C:\D\saka-verify\appdata` and CDP port 9222, after closing the live app.
- [ ] **Rings:** open a 1:1 chat whose newest voice is unheard → it rings with the call-screen photo.
- [ ] **Decline:** decline → run a sync → no re-ring. Switch to another chat and back → it rings.
- [ ] **Answer:** answer → the voice plays and the timer counts → call ended for about 0.8 s → the chat is centred on that voice, which now shows as heard.
- [ ] **Timeout:** wait 30 s without answering → the overlay closes and the voice stays unheard.
- [ ] **Switch mid-call:** while ringing, click another chat → the overlay closes immediately.
- [ ] **No ring:** a multi-member room never rings. With Settings → Incoming calls off, nothing rings.
- [ ] **Logs:** `C:\D\saka-verify\appdata\logs\debug.log` has `call_ring` / `call_decline` / `call_skip` / `call_answer` / `call_end` / `call_cancel` with `source=client`, ids only, and no names, text or URLs.
- [ ] Restore the live app afterwards.
