# Multi-Service Auth Refresh Design

## Overview

Refactor the auto-refresh auth feature to support multiple services independently. Each service should manage its own token refresh schedule and failure handling without affecting other services.

## Problem Statement

The current implementation has a single global auth state in `useAuth` hook:
- One `isAuthenticated` boolean for all services
- One `authError` string shared across services
- One `tokenRefreshTimeoutRef` timer for all services
- When any service's token refresh fails, ALL services are marked as unauthenticated

This breaks multi-service usage where users may have different services at different auth states.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Failure behavior | Silent degradation + toast notification |
| Refresh timing | Per-service independent timers based on actual token expiry |
| State tracking | Distinguish "never connected" vs "disconnected" (was connected, token expired) |

## Service State Model

```
State               │ Meaning                              │ Indicator
────────────────────┼──────────────────────────────────────┼─────────────────────
Not Selected        │ User hasn't added service            │ Not in ServiceRail
Selected, Never     │ User added but never logged in       │ Normal icon
  Connected         │                                      │
Connected           │ User logged in, token valid          │ Normal icon
Disconnected        │ Was connected, token expired/failed  │ Warning badge + toast
```

## Per-Service Auth State

```typescript
interface ServiceAuthState {
  connected: boolean;           // Has valid token
  tokenExpiresAt: number | null; // Unix timestamp (ms) for scheduling refresh
  error: string | null;         // Service-specific error message
  wasEverConnected: boolean;    // Track if user ever logged in (for disconnect detection)
}

// Hook state shape
interface AuthState {
  serviceAuth: Record<string, ServiceAuthState>;  // Keyed by service ID
  authCheckComplete: boolean;
}
```

## Per-Service Token Refresh Scheduling

```typescript
// Per-service refresh timers
const refreshTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

// Schedule refresh for a single service based on its token expiry
const scheduleRefreshForService = useCallback((serviceId: string, expiresAt: number) => {
  // Clear existing timer for this service
  if (refreshTimersRef.current[serviceId]) {
    clearTimeout(refreshTimersRef.current[serviceId]);
  }

  // Schedule refresh 10 minutes before expiry
  const refreshAt = expiresAt - (10 * 60 * 1000);
  const delayMs = Math.max(refreshAt - Date.now(), 60_000); // At least 1 min

  refreshTimersRef.current[serviceId] = setTimeout(async () => {
    await refreshServiceToken(serviceId);
  }, delayMs);
}, []);
```

Refresh logic per service:
1. Call `POST /api/auth/refresh-if-needed?service={serviceId}`
2. If success: update `serviceAuth[serviceId].tokenExpiresAt`, reschedule timer
3. If failure: set `serviceAuth[serviceId].connected = false`, set error, show toast
4. Other services are **unaffected**

## User Notification for Disconnected Services

When a service token expires or refresh fails:

1. **Toast Notification** - Dismissible toast with service name:
   - "日向坂46 session expired. Re-login to access Messages."
   - Auto-dismiss after 10 seconds
   - Click to open LoginModal for that service

2. **ServiceRail Visual Indicator** - Warning badge on disconnected service icon:
   - Orange/yellow dot on service icon
   - Tooltip: "Session expired - click to re-login"
   - Only shown for **disconnected** services (not never-connected)

3. **Feature Access** (already implemented):
   - FeatureRail checks `isServiceConnected(service)` before paid features
   - Opens LoginModal with appropriate message

## Hook Interface Changes

```typescript
interface UseAuthReturn {
  // Existing (backwards compatible)
  isAuthenticated: boolean | null;           // Derived: any service connected
  authCheckComplete: boolean;
  authStatus: MultiGroupAuthStatus | null;
  checkAuth: () => Promise<void>;
  connectedServices: string[];
  isServiceConnected: (serviceId: string) => boolean;

  // New
  isServiceDisconnected: (serviceId: string) => boolean;  // Was connected, now expired
  getServiceError: (serviceId: string) => string | null;
  clearServiceError: (serviceId: string) => void;
  disconnectedServices: string[];  // Services that were connected but token expired
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/shell/hooks/useAuth.ts` | Replace global state with per-service state, per-service timers, track `wasEverConnected` |
| `frontend/src/core/layout/ServiceRail.tsx` | Add warning badge for disconnected services |
| `frontend/src/shell/components/LoginModal.tsx` | Different message for disconnected vs never-connected |

**Backend:** No changes needed - already fully service-aware.

## Implementation Steps

1. **useAuth refactor:**
   - Add `serviceAuth: Record<string, ServiceAuthState>` state
   - Add `refreshTimersRef: Record<string, timeout>`
   - `checkAuth()` populates per-service state from `/api/auth/status`
   - `scheduleRefreshForService(serviceId)` manages individual timers
   - On refresh failure: update only that service's state, show toast
   - Expose: `isServiceConnected()`, `isServiceDisconnected()`, `getServiceError()`

2. **ServiceRail warning badge:**
   - Check `isServiceDisconnected(serviceId)`
   - Show orange dot indicator only for disconnected services
   - Tooltip explains "Session expired"

3. **LoginModal messaging:**
   - If `isServiceDisconnected`: "Your session expired. Re-login to continue."
   - If never connected: "Login to access Messages." (current behavior)

## Persistence

`wasEverConnected` detection:
- Derive from backend: if `/api/auth/status` returns `token_expired: true` for a service, it was ever connected
- No additional localStorage needed

## Verification Plan

1. **Independent refresh:**
   - Connect to 2 services
   - Let one token expire (or simulate via backend)
   - Verify other service continues working
   - Verify toast only shows for expired service

2. **Disconnected vs Never-Connected:**
   - Add a service but don't login → no warning badge
   - Login, then let token expire → warning badge appears
   - Re-login → warning badge disappears

3. **Timer independence:**
   - Connect services at different times
   - Verify each refreshes on its own schedule
   - Verify no pile-up of simultaneous refreshes
