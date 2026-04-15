// frontend/src/shell/context/AuthContext.tsx
import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import type { MultiGroupAuthStatus } from '../../types';
import { useAppStore } from '../../store/appStore';

// Debug logging for auth flows - enable via localStorage for troubleshooting
const AUTH_DEBUG = typeof localStorage !== 'undefined' && localStorage.getItem('DEBUG_AUTH') === 'true';
const log = AUTH_DEBUG
    ? (msg: string, ...args: unknown[]) => console.log(`[Auth] ${msg}`, ...args)
    : () => {};
const warn = AUTH_DEBUG
    ? (msg: string, ...args: unknown[]) => console.warn(`[Auth] ${msg}`, ...args)
    : () => {};

/**
 * Authentication state for a single service.
 */
export interface ServiceAuthState {
    /** Whether the service is currently connected with a valid token */
    connected: boolean;
    /** Unix timestamp (ms) when the token expires, or null if unknown */
    tokenExpiresAt: number | null;
    /** Error message if authentication failed, or null */
    error: string | null;
    /** Whether the user was ever authenticated (helps detect expired sessions) */
    wasEverConnected: boolean;
}

/** Map of service IDs to their authentication states. */
export type ServiceAuthRecord = Record<string, ServiceAuthState>;

/**
 * Auth context value providing authentication state and actions.
 * Use the `useAuth` hook to access this in components.
 */
export interface AuthContextValue {
    isAuthenticated: boolean | null;
    authCheckComplete: boolean;
    authStatus: MultiGroupAuthStatus | null;
    authError: string | null;
    setAuthError: (error: string | null) => void;
    checkAuth: () => Promise<void>;
    connectedServices: string[];
    isServiceConnected: (serviceId: string) => boolean;
    isServiceDisconnected: (serviceId: string) => boolean;
    getServiceError: (serviceId: string) => string | null;
    clearServiceError: (serviceId: string) => void;
    disconnectedServices: string[];
    // New: mark a service as disconnected (called by sync when SESSION_EXPIRED)
    markServiceDisconnected: (serviceId: string, error?: string) => void;
    // For diagnostics: get expiry time and scheduled refresh time
    getServiceExpiresAt: (serviceId: string) => number | null;
    getScheduledRefreshServices: () => string[];
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Provides authentication state management for all services.
 *
 * Handles:
 * - Initial auth check on mount
 * - Automatic token refresh scheduling
 * - Per-service connection tracking
 * - Session expiry detection
 */
export function AuthProvider({ children }: { children: ReactNode }) {
    const { activeService, setActiveService } = useAppStore();

    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
    const [authCheckComplete, setAuthCheckComplete] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [authStatus, setAuthStatus] = useState<MultiGroupAuthStatus | null>(null);
    const [serviceAuth, setServiceAuth] = useState<ServiceAuthRecord>({});

    const refreshTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const refreshRetryCountRef = useRef<Record<string, number>>({});
    const hasInitializedRef = useRef(false);

    const checkAuth = useCallback(async () => {
        log(' Checking auth status for all services...');
        try {
            const res = await fetch('/api/auth/status');
            const data: { services: Record<string, { authenticated: boolean; token_expired?: boolean; expires_at?: number }> } = await res.json();

            // Use functional update to access previous state and merge properly.
            // This prevents clearing frontend-only disconnect state for services
            // whose JWT is still valid but whose server-side session was invalidated
            // (detected by sync as SESSION_EXPIRED).
            setServiceAuth(prev => {
                const newServiceAuth: ServiceAuthRecord = {};

                for (const [serviceId, status] of Object.entries(data.services)) {
                    const wasEverConnected = status.authenticated || status.token_expired === true;
                    const connected = status.authenticated === true;
                    const newExpiresAt = status.expires_at ? status.expires_at * 1000 : null;

                    const prevState = prev[serviceId];
                    const wasDisconnected = prevState?.wasEverConnected === true && prevState?.connected === false;
                    const tokenChanged = prevState?.tokenExpiresAt !== newExpiresAt;

                    if (wasDisconnected && connected && !tokenChanged) {
                        // Backend says JWT is valid, but frontend knows the server-side
                        // session was invalidated (sync detected SESSION_EXPIRED).
                        // Preserve the disconnect state — only a new token (re-login)
                        // should clear it.
                        log(`${serviceId}: preserving disconnect state (JWT valid but session invalidated)`);
                        newServiceAuth[serviceId] = {
                            ...prevState,
                            tokenExpiresAt: newExpiresAt,
                        };
                    } else {
                        newServiceAuth[serviceId] = {
                            connected,
                            tokenExpiresAt: newExpiresAt,
                            error: status.token_expired ? 'Session expired' : null,
                            wasEverConnected: wasEverConnected || (prevState?.wasEverConnected ?? false),
                        };

                        if (connected) {
                            log(`${serviceId}: connected, expires at ${status.expires_at ? new Date(status.expires_at * 1000).toLocaleTimeString() : 'unknown'}`);
                        } else if (status.token_expired) {
                            log(`${serviceId}: disconnected (token expired)`);
                        } else {
                            log(`${serviceId}: not connected`);
                        }
                    }
                }

                return newServiceAuth;
            });

            setAuthStatus(data.services);

            // Compute authenticated services from backend response for activeService fallback.
            // isAuthenticated is handled by the serviceAuth-watching useEffect.
            const authenticatedServices = Object.entries(data.services)
                .filter(([_, s]) => s.authenticated === true)
                .map(([id]) => id);

            if (authenticatedServices.length > 0 && !activeService) {
                setActiveService(authenticatedServices[0]);
            }

            setAuthError(null);
            log(`Auth check complete: ${authenticatedServices.length} service(s) authenticated (backend)`);
        } catch (e) {
            console.error('[Auth] Auth check failed:', e);  // Keep error logging
            setIsAuthenticated(false);
        } finally {
            setAuthCheckComplete(true);
        }
    }, [activeService, setActiveService]);

    const scheduleRefreshForService = useCallback((serviceId: string, expiresAt: number) => {
        if (refreshTimersRef.current[serviceId]) {
            clearTimeout(refreshTimersRef.current[serviceId]);
            delete refreshTimersRef.current[serviceId];
        }

        const now = Date.now();
        const timeUntilExpiry = expiresAt - now;
        const refreshThreshold = 10 * 60 * 1000;  // 10 min before expiry
        const jitterMs = Math.floor(Math.random() * 2 * 60 * 1000);  // 0-2 min random jitter (spread out requests)

        // Calculate when to refresh: (expiry - threshold) + jitter
        // Jitter is ADDED to spread out refresh attempts across time window
        // e.g., 60 min token → refresh at 50-52 min mark (10 min before, plus 0-2 min jitter)
        const targetRefreshTime = expiresAt - refreshThreshold + jitterMs;
        const delayMs = Math.max(targetRefreshTime - now, 60_000);  // minimum 1 min

        log(`${serviceId}: scheduling refresh in ${Math.round(delayMs / 60000)} min (expiry in ${Math.round(timeUntilExpiry / 60000)} min, jitter: +${Math.round(jitterMs / 1000)}s)`);

        refreshTimersRef.current[serviceId] = setTimeout(() => {
            refreshServiceToken(serviceId);
        }, delayMs);
    }, []);

    const refreshServiceToken = useCallback(async (serviceId: string) => {
        try {
            log(`${serviceId}: refreshing token...`);
            const res = await fetch(
                `/api/auth/refresh-if-needed?service=${encodeURIComponent(serviceId)}`,
                { method: 'POST' }
            );
            const data = await res.json();
            log(`${serviceId}: refresh result: ${data.status}, remaining: ${Math.round(data.remaining_seconds / 60)} min`);

            if (data.status === 'refresh_failed' || data.status === 'no_token') {
                setServiceAuth(prev => ({
                    ...prev,
                    [serviceId]: {
                        ...prev[serviceId],
                        connected: false,
                        error: 'Session expired. Please re-login.',
                    },
                }));
                warn(`${serviceId}: token refresh failed`);
            } else if (data.status === 'refreshed') {
                // Token was actually refreshed - update expiry and reschedule
                // Reset retry count on success
                refreshRetryCountRef.current[serviceId] = 0;
                const newExpiresAt = Date.now() + (data.remaining_seconds * 1000);
                log(`${serviceId}: token refreshed, new expiry in ${Math.round(data.remaining_seconds / 60)} min`);
                setServiceAuth(prev => ({
                    ...prev,
                    [serviceId]: {
                        ...prev[serviceId],
                        tokenExpiresAt: newExpiresAt,
                        error: null,
                    },
                }));
                scheduleRefreshForService(serviceId, newExpiresAt);
            } else {
                // status === 'valid' - token still valid, backend didn't refresh it yet
                // This means we called too early. Reschedule based on actual remaining time.
                const newExpiresAt = Date.now() + (data.remaining_seconds * 1000);
                log(`${serviceId}: token still valid (${Math.round(data.remaining_seconds / 60)} min remaining), rescheduling`);
                scheduleRefreshForService(serviceId, newExpiresAt);
            }
            // Reset retry count on any successful response
            refreshRetryCountRef.current[serviceId] = 0;
        } catch (e) {
            // Network error - retry up to 3 times at 1 min intervals
            const retryCount = (refreshRetryCountRef.current[serviceId] || 0) + 1;
            refreshRetryCountRef.current[serviceId] = retryCount;

            if (retryCount >= 3) {
                console.error(`[Auth] ${serviceId}: network error after ${retryCount} retries, marking disconnected:`, e);  // Keep error logging
                refreshRetryCountRef.current[serviceId] = 0;
                setServiceAuth(prev => ({
                    ...prev,
                    [serviceId]: {
                        ...prev[serviceId],
                        connected: false,
                        error: 'Network error. Please check your connection.',
                    },
                }));
            } else {
                warn(`${serviceId}: network error (retry ${retryCount}/3), retrying in 1 min`);
                const retryAt = Date.now() + (60 * 1000);
                scheduleRefreshForService(serviceId, retryAt + (10 * 60 * 1000)); // Add 10 min to get proper scheduling
            }
        }
    }, [scheduleRefreshForService]);

    // New: allow external code (like useSync) to mark a service as disconnected
    const markServiceDisconnected = useCallback((serviceId: string, error?: string) => {
        log(`${serviceId}: marked as disconnected${error ? ` (${error})` : ''}`);
        setServiceAuth(prev => ({
            ...prev,
            [serviceId]: {
                ...prev[serviceId],
                connected: false,
                error: error || 'Session expired. Please re-login.',
                wasEverConnected: true,
            },
        }));
    }, []);

    useEffect(() => {
        // Prevent double execution in React StrictMode
        if (hasInitializedRef.current) return;
        hasInitializedRef.current = true;
        checkAuth();
    }, []);

    // Schedule refresh timers when serviceAuth changes
    useEffect(() => {
        for (const [serviceId, state] of Object.entries(serviceAuth)) {
            if (state.connected && state.tokenExpiresAt) {
                if (!refreshTimersRef.current[serviceId]) {
                    scheduleRefreshForService(serviceId, state.tokenExpiresAt);
                }
            } else {
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

    const connectedServices = useMemo(
        () => Object.entries(serviceAuth)
            .filter(([_, state]) => state.connected === true)
            .map(([serviceId]) => serviceId),
        [serviceAuth]
    );

    // Update isAuthenticated based on serviceAuth
    useEffect(() => {
        const anyConnected = Object.values(serviceAuth).some(s => s.connected);
        setIsAuthenticated(anyConnected);
    }, [serviceAuth]);

    const isServiceConnected = useCallback(
        (serviceId: string) => serviceAuth[serviceId]?.connected === true,
        [serviceAuth]
    );

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

    const getServiceExpiresAt = useCallback(
        (serviceId: string) => serviceAuth[serviceId]?.tokenExpiresAt ?? null,
        [serviceAuth]
    );

    const getScheduledRefreshServices = useCallback(
        () => Object.keys(refreshTimersRef.current),
        []
    );

    const disconnectedServices = Object.entries(serviceAuth)
        .filter(([_, state]) => state.wasEverConnected && !state.connected)
        .map(([serviceId]) => serviceId);

    const value: AuthContextValue = {
        isAuthenticated,
        authCheckComplete,
        authStatus,
        authError,
        setAuthError,
        checkAuth,
        connectedServices,
        isServiceConnected,
        isServiceDisconnected,
        getServiceError,
        clearServiceError,
        disconnectedServices,
        markServiceDisconnected,
        getServiceExpiresAt,
        getScheduledRefreshServices,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextValue {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
