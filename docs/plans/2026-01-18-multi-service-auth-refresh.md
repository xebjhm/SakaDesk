# Multi-Service Auth Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor useAuth hook to manage per-service auth state and refresh timers independently, so one service's token expiry doesn't affect others.

**Architecture:** Replace global auth state with per-service `ServiceAuthState` record. Each service gets its own refresh timer scheduled based on actual token expiry. Failure handling is isolated per-service with toast notifications for disconnected services.

**Tech Stack:** React hooks, TypeScript, existing toast system (if available) or console logging

---

## Task 1: Add ServiceAuthState Types

**Files:**
- Modify: `frontend/src/shell/hooks/useAuth.ts:1-14`

**Step 1: Add new type definitions**

Add these types at the top of the file, before `UseAuthReturn`:

```typescript
export interface ServiceAuthState {
    connected: boolean;
    tokenExpiresAt: number | null;
    error: string | null;
    wasEverConnected: boolean;
}

export type ServiceAuthRecord = Record<string, ServiceAuthState>;
```

**Step 2: Extend UseAuthReturn interface**

Update the interface to add new methods:

```typescript
export interface UseAuthReturn {
    isAuthenticated: boolean | null;
    authCheckComplete: boolean;
    authStatus: MultiGroupAuthStatus | null;
    authError: string | null;
    setAuthError: (error: string | null) => void;
    checkAuth: () => Promise<void>;
    connectedServices: string[];
    isServiceConnected: (serviceId: string) => boolean;
    // New additions
    isServiceDisconnected: (serviceId: string) => boolean;
    getServiceError: (serviceId: string) => string | null;
    clearServiceError: (serviceId: string) => void;
    disconnectedServices: string[];
}
```

**Step 3: Verify types compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add frontend/src/shell/hooks/useAuth.ts
git commit -m "feat(auth): add ServiceAuthState types for per-service auth"
```

---

## Task 2: Add Per-Service State and Timers

**Files:**
- Modify: `frontend/src/shell/hooks/useAuth.ts:16-25`

**Step 1: Add serviceAuth state**

After the existing state declarations (line 22), add:

```typescript
const [serviceAuth, setServiceAuth] = useState<ServiceAuthRecord>({});
```

**Step 2: Replace single timer ref with per-service timers**

Replace line 24:
```typescript
const tokenRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

With:
```typescript
const refreshTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
```

**Step 3: Verify no runtime errors**

Run: `cd frontend && npm run dev`
Expected: App loads without errors (functionality unchanged yet)

**Step 4: Commit**

```bash
git add frontend/src/shell/hooks/useAuth.ts
git commit -m "feat(auth): add serviceAuth state and per-service timer refs"
```

---

## Task 3: Update checkAuth to Populate Per-Service State

**Files:**
- Modify: `frontend/src/shell/hooks/useAuth.ts:26-52`

**Step 1: Update checkAuth function**

Replace the entire `checkAuth` function with:

```typescript
const checkAuth = useCallback(async () => {
    try {
        const res = await fetch('/api/auth/status');
        const data: { services: Record<string, { authenticated: boolean; token_expired?: boolean; expires_at?: number }> } = await res.json();

        const newServiceAuth: ServiceAuthRecord = {};
        const authenticatedServices: string[] = [];

        for (const [serviceId, status] of Object.entries(data.services)) {
            const wasEverConnected = status.authenticated || status.token_expired === true;
            const connected = status.authenticated === true;

            newServiceAuth[serviceId] = {
                connected,
                tokenExpiresAt: status.expires_at ? status.expires_at * 1000 : null, // Convert to ms
                error: status.token_expired ? 'Session expired' : null,
                wasEverConnected,
            };

            if (connected) {
                authenticatedServices.push(serviceId);
            }
        }

        setServiceAuth(newServiceAuth);
        setAuthStatus(data.services);

        const anyAuthenticated = authenticatedServices.length > 0;
        setIsAuthenticated(anyAuthenticated);

        if (anyAuthenticated && !activeService) {
            setActiveService(authenticatedServices[0]);
        }

        // Clear global auth error - errors are now per-service
        setAuthError(null);
    } catch {
        setIsAuthenticated(false);
    } finally {
        setAuthCheckComplete(true);
    }
}, [activeService, setActiveService]);
```

**Step 2: Verify checkAuth works**

Run: `cd frontend && npm run dev`
Expected: App loads, auth check completes, services appear in ServiceRail

**Step 3: Commit**

```bash
git add frontend/src/shell/hooks/useAuth.ts
git commit -m "feat(auth): update checkAuth to populate per-service state"
```

---

## Task 4: Implement Per-Service Refresh Scheduling

**Files:**
- Modify: `frontend/src/shell/hooks/useAuth.ts:54-100`

**Step 1: Add refreshServiceToken function**

After `checkAuth`, add this new function:

```typescript
const refreshServiceToken = useCallback(async (serviceId: string) => {
    try {
        console.log(`[Auth] Refreshing token for ${serviceId}`);
        const res = await fetch(
            `/api/auth/refresh-if-needed?service=${encodeURIComponent(serviceId)}`,
            { method: 'POST' }
        );
        const data = await res.json();
        console.log(`[Auth] Refresh result for ${serviceId}: ${data.status}, remaining: ${Math.round(data.remaining_seconds / 60)} min`);

        if (data.status === 'refresh_failed' || data.status === 'no_token') {
            // Mark this service as disconnected
            setServiceAuth(prev => ({
                ...prev,
                [serviceId]: {
                    ...prev[serviceId],
                    connected: false,
                    error: 'Session expired. Please re-login.',
                },
            }));
            console.warn(`[Auth] Token refresh failed for ${serviceId}`);
            // Note: Other services remain unaffected
        } else {
            // Update expiry time and reschedule
            const newExpiresAt = Date.now() + (data.remaining_seconds * 1000);
            setServiceAuth(prev => ({
                ...prev,
                [serviceId]: {
                    ...prev[serviceId],
                    tokenExpiresAt: newExpiresAt,
                    error: null,
                },
            }));
            scheduleRefreshForService(serviceId, newExpiresAt);
        }
    } catch (e) {
        console.error(`[Auth] Token refresh error for ${serviceId}:`, e);
        // On network error, retry later
        const retryAt = Date.now() + (5 * 60 * 1000); // Retry in 5 min
        scheduleRefreshForService(serviceId, retryAt);
    }
}, []);
```

**Step 2: Add scheduleRefreshForService function**

Add this before `refreshServiceToken`:

```typescript
const scheduleRefreshForService = useCallback((serviceId: string, expiresAt: number) => {
    // Clear existing timer for this service
    if (refreshTimersRef.current[serviceId]) {
        clearTimeout(refreshTimersRef.current[serviceId]);
        delete refreshTimersRef.current[serviceId];
    }

    // Schedule refresh 10 minutes before expiry
    const refreshAt = expiresAt - (10 * 60 * 1000);
    const delayMs = Math.max(refreshAt - Date.now(), 60_000); // At least 1 min

    console.log(`[Auth] Scheduling refresh for ${serviceId} in ${Math.round(delayMs / 60000)} min`);

    refreshTimersRef.current[serviceId] = setTimeout(() => {
        refreshServiceToken(serviceId);
    }, delayMs);
}, []);
```

**Step 3: Remove old scheduleTokenRefresh function**

Delete the entire `scheduleTokenRefresh` function (lines 60-100 approximately) and `getJitteredRefreshInterval`.

**Step 4: Verify refresh scheduling works**

Run: `cd frontend && npm run dev`
Check console for "[Auth] Scheduling refresh for X in Y min" messages

**Step 5: Commit**

```bash
git add frontend/src/shell/hooks/useAuth.ts
git commit -m "feat(auth): implement per-service refresh scheduling"
```

---

## Task 5: Update useEffect for Timer Management

**Files:**
- Modify: `frontend/src/shell/hooks/useAuth.ts:102-117`

**Step 1: Replace the timer useEffect**

Replace the existing useEffect that handles `isAuthenticated` (lines 106-117) with:

```typescript
// Schedule refresh timers when serviceAuth changes
useEffect(() => {
    // Schedule refresh for each connected service with known expiry
    for (const [serviceId, state] of Object.entries(serviceAuth)) {
        if (state.connected && state.tokenExpiresAt) {
            // Only schedule if not already scheduled
            if (!refreshTimersRef.current[serviceId]) {
                scheduleRefreshForService(serviceId, state.tokenExpiresAt);
            }
        } else {
            // Clear timer for disconnected services
            if (refreshTimersRef.current[serviceId]) {
                clearTimeout(refreshTimersRef.current[serviceId]);
                delete refreshTimersRef.current[serviceId];
            }
        }
    }
}, [serviceAuth, scheduleRefreshForService]);

// Cleanup all timers on unmount
useEffect(() => {
    return () => {
        for (const timerId of Object.values(refreshTimersRef.current)) {
            clearTimeout(timerId);
        }
        refreshTimersRef.current = {};
    };
}, []);
```

**Step 2: Verify timer cleanup works**

Run: `cd frontend && npm run dev`
Navigate between pages, check no console errors about clearing timers

**Step 3: Commit**

```bash
git add frontend/src/shell/hooks/useAuth.ts
git commit -m "feat(auth): update useEffect for per-service timer management"
```

---

## Task 6: Add New Hook Return Values

**Files:**
- Modify: `frontend/src/shell/hooks/useAuth.ts:119-140`

**Step 1: Add derived values and helper functions**

Before the `return` statement, add:

```typescript
const isServiceDisconnected = useCallback(
    (serviceId: string) => {
        const state = serviceAuth[serviceId];
        return state?.wasEverConnected === true && state?.connected === false;
    },
    [serviceAuth]
);

const getServiceError = useCallback(
    (serviceId: string) => serviceAuth[serviceId]?.error ?? null,
    [serviceAuth]
);

const clearServiceError = useCallback(
    (serviceId: string) => {
        setServiceAuth(prev => ({
            ...prev,
            [serviceId]: {
                ...prev[serviceId],
                error: null,
            },
        }));
    },
    []
);

const disconnectedServices = Object.entries(serviceAuth)
    .filter(([_, state]) => state.wasEverConnected && !state.connected)
    .map(([serviceId]) => serviceId);
```

**Step 2: Update return statement**

Update the return object to include new values:

```typescript
return {
    isAuthenticated,
    authCheckComplete,
    authStatus,
    authError,
    setAuthError,
    checkAuth,
    connectedServices,
    isServiceConnected,
    // New additions
    isServiceDisconnected,
    getServiceError,
    clearServiceError,
    disconnectedServices,
};
```

**Step 3: Verify hook compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add frontend/src/shell/hooks/useAuth.ts
git commit -m "feat(auth): add isServiceDisconnected and error helpers to hook"
```

---

## Task 7: Add Warning Badge to ServiceRail

**Files:**
- Modify: `frontend/src/core/layout/ServiceRail.tsx:1-10`
- Modify: `frontend/src/core/layout/ServiceRail.tsx:54-85`

**Step 1: Import useAuth hook**

Add to imports (after line 8):

```typescript
import { useAuth } from '../../shell/hooks/useAuth';
```

**Step 2: Get disconnected state in component**

Inside the component, after `const [contextMenu, setContextMenu] = ...` (line 33), add:

```typescript
const { isServiceDisconnected } = useAuth();
```

**Step 3: Add warning badge to service button**

Inside the service button (around line 76-82), after the service icon div, add the warning badge:

```typescript
{/* Service Icon */}
<div className={cn(
    "w-12 h-12 rounded-[24px] flex items-center justify-center text-white font-bold text-sm transition-all duration-200",
    colorClass,
    isActive ? "rounded-[16px]" : "group-hover:rounded-[16px]"
)}>
    {getServiceShortCode(service)}
</div>

{/* Disconnected Warning Badge */}
{isServiceDisconnected(service) && (
    <div
        className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-orange-500 rounded-full border-2 border-[#1e1f22]"
        title="Session expired - click to re-login"
    />
)}
```

**Step 4: Verify badge appears for disconnected services**

Run: `cd frontend && npm run dev`
(To test: would need to simulate token expiry or manually set wasEverConnected)

**Step 5: Commit**

```bash
git add frontend/src/core/layout/ServiceRail.tsx
git commit -m "feat(ui): add warning badge to ServiceRail for disconnected services"
```

---

## Task 8: Update LoginModal Messaging

**Files:**
- Modify: `frontend/src/shell/components/LoginModal.tsx:9-14`
- Modify: `frontend/src/shell/components/LoginModal.tsx:82-89`

**Step 1: Add isDisconnected prop**

Update the interface:

```typescript
interface LoginModalProps {
    serviceId: string;
    featureId: FeatureId;
    onClose: () => void;
    onSuccess: () => void;
    isDisconnected?: boolean;  // New: true if session expired (vs never connected)
}
```

**Step 2: Destructure new prop**

Update the component signature:

```typescript
export const LoginModal: React.FC<LoginModalProps> = ({
    serviceId,
    featureId,
    onClose,
    onSuccess,
    isDisconnected = false,
}) => {
```

**Step 3: Update message based on disconnected state**

Replace the content message (lines 82-89) with:

```typescript
<p className="text-gray-600">
    {isDisconnected ? (
        <>
            Your session for{' '}
            <span className="font-medium text-gray-900">
                {service?.displayName ?? serviceId}
            </span>{' '}
            has expired. Please re-login to continue using{' '}
            <span className="font-medium text-gray-900">
                {feature?.label ?? featureId}
            </span>.
        </>
    ) : (
        <>
            <span className="font-medium text-gray-900">
                {feature?.label ?? featureId}
            </span>{' '}
            is a premium feature that requires logging in with your{' '}
            {service?.name ?? serviceId} account.
        </>
    )}
</p>
```

**Step 4: Update header for disconnected state**

Update the header title (line 64-66):

```typescript
<h3 className="text-lg font-bold text-white">
    {isDisconnected ? 'Session Expired' : 'Login Required'}
</h3>
```

**Step 5: Commit**

```bash
git add frontend/src/shell/components/LoginModal.tsx
git commit -m "feat(ui): update LoginModal messaging for disconnected vs never-connected"
```

---

## Task 9: Pass isDisconnected to LoginModal from FeatureRail

**Files:**
- Modify: `frontend/src/core/layout/FeatureRail.tsx:15-16`
- Modify: `frontend/src/core/layout/FeatureRail.tsx:99-105`

**Step 1: Get isServiceDisconnected from useAuth**

Update the useAuth destructuring (line 15):

```typescript
const { isServiceConnected, checkAuth, isServiceDisconnected } = useAuth();
```

**Step 2: Pass isDisconnected to LoginModal**

Update the LoginModal usage (lines 99-105):

```typescript
{loginModal && (
    <LoginModal
        serviceId={service}
        featureId={loginModal.featureId}
        onClose={() => setLoginModal(null)}
        onSuccess={handleLoginSuccess}
        isDisconnected={isServiceDisconnected(service)}
    />
)}
```

**Step 3: Verify modal shows correct message**

Run: `cd frontend && npm run dev`
Test by clicking a paid feature when not connected

**Step 4: Commit**

```bash
git add frontend/src/core/layout/FeatureRail.tsx
git commit -m "feat(ui): pass isDisconnected state to LoginModal"
```

---

## Task 10: Update isAuthenticated Derivation

**Files:**
- Modify: `frontend/src/shell/hooks/useAuth.ts`

**Step 1: Derive isAuthenticated from serviceAuth**

Update the derivation logic to be more robust. Find where `connectedServices` is derived and update to also derive `isAuthenticated`:

```typescript
const connectedServices = Object.entries(serviceAuth)
    .filter(([_, state]) => state.connected === true)
    .map(([serviceId]) => serviceId);

// Update isAuthenticated based on serviceAuth (backwards compat)
useEffect(() => {
    const anyConnected = Object.values(serviceAuth).some(s => s.connected);
    setIsAuthenticated(anyConnected);
}, [serviceAuth]);
```

**Step 2: Verify backwards compatibility**

Run: `cd frontend && npm run dev`
Verify existing code that uses `isAuthenticated` still works

**Step 3: Commit**

```bash
git add frontend/src/shell/hooks/useAuth.ts
git commit -m "refactor(auth): derive isAuthenticated from serviceAuth for consistency"
```

---

## Task 11: Final Integration Test

**Files:** None (manual testing)

**Step 1: Test multi-service scenario**

1. Login to 2+ services
2. Verify each shows in ServiceRail without warning badge
3. Wait for refresh timer (or check console logs)
4. Verify refresh happens independently per service

**Step 2: Test token expiry simulation**

(Requires backend modification or waiting for actual expiry)

1. Let one service's token expire
2. Verify warning badge appears only on that service
3. Verify other service still works
4. Click paid feature on expired service → modal says "Session Expired"
5. Re-login → warning badge disappears

**Step 3: Final commit if any cleanup needed**

```bash
git status
# If any uncommitted changes:
git add -A
git commit -m "chore: cleanup after multi-service auth integration"
```

---

## Summary of Commits

1. `feat(auth): add ServiceAuthState types for per-service auth`
2. `feat(auth): add serviceAuth state and per-service timer refs`
3. `feat(auth): update checkAuth to populate per-service state`
4. `feat(auth): implement per-service refresh scheduling`
5. `feat(auth): update useEffect for per-service timer management`
6. `feat(auth): add isServiceDisconnected and error helpers to hook`
7. `feat(ui): add warning badge to ServiceRail for disconnected services`
8. `feat(ui): update LoginModal messaging for disconnected vs never-connected`
9. `feat(ui): pass isDisconnected state to LoginModal`
10. `refactor(auth): derive isAuthenticated from serviceAuth for consistency`
