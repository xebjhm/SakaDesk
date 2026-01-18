// frontend/src/shell/context/AuthContext.tsx
import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import type { MultiGroupAuthStatus } from '../../types';
import { useAppStore } from '../../store/appStore';

export interface ServiceAuthState {
    connected: boolean;
    tokenExpiresAt: number | null;
    error: string | null;
    wasEverConnected: boolean;
}

export type ServiceAuthRecord = Record<string, ServiceAuthState>;

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
        console.log('[Auth] Checking auth status for all services...');
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
                    tokenExpiresAt: status.expires_at ? status.expires_at * 1000 : null,
                    error: status.token_expired ? 'Session expired' : null,
                    wasEverConnected,
                };

                if (connected) {
                    authenticatedServices.push(serviceId);
                    console.log(`[Auth] ${serviceId}: connected, expires at ${status.expires_at ? new Date(status.expires_at * 1000).toLocaleTimeString() : 'unknown'}`);
                } else if (status.token_expired) {
                    console.log(`[Auth] ${serviceId}: disconnected (token expired)`);
                } else {
                    console.log(`[Auth] ${serviceId}: not connected`);
                }
            }

            setServiceAuth(newServiceAuth);
            setAuthStatus(data.services);

            const anyAuthenticated = authenticatedServices.length > 0;
            setIsAuthenticated(anyAuthenticated);

            if (anyAuthenticated && !activeService) {
                setActiveService(authenticatedServices[0]);
            }

            setAuthError(null);
            console.log(`[Auth] Auth check complete: ${authenticatedServices.length} service(s) connected`);
        } catch (e) {
            console.error('[Auth] Auth check failed:', e);
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

        const refreshAt = expiresAt - (10 * 60 * 1000);  // 10 min before expiry
        const jitterMs = Math.floor(Math.random() * 2 * 60 * 1000);  // 0-2 min random jitter
        const delayMs = Math.max(refreshAt - Date.now() - jitterMs, 60_000);  // minimum 1 min

        console.log(`[Auth] ${serviceId}: scheduling refresh in ${Math.round(delayMs / 60000)} min (jitter: -${Math.round(jitterMs / 1000)}s)`);

        refreshTimersRef.current[serviceId] = setTimeout(() => {
            refreshServiceToken(serviceId);
        }, delayMs);
    }, []);

    const refreshServiceToken = useCallback(async (serviceId: string) => {
        try {
            console.log(`[Auth] ${serviceId}: refreshing token...`);
            const res = await fetch(
                `/api/auth/refresh-if-needed?service=${encodeURIComponent(serviceId)}`,
                { method: 'POST' }
            );
            const data = await res.json();
            console.log(`[Auth] ${serviceId}: refresh result: ${data.status}, remaining: ${Math.round(data.remaining_seconds / 60)} min`);

            if (data.status === 'refresh_failed' || data.status === 'no_token') {
                setServiceAuth(prev => ({
                    ...prev,
                    [serviceId]: {
                        ...prev[serviceId],
                        connected: false,
                        error: 'Session expired. Please re-login.',
                    },
                }));
                console.warn(`[Auth] ${serviceId}: token refresh failed`);
            } else if (data.status === 'refreshed') {
                // Token was actually refreshed - update expiry and reschedule
                // Reset retry count on success
                refreshRetryCountRef.current[serviceId] = 0;
                const newExpiresAt = Date.now() + (data.remaining_seconds * 1000);
                console.log(`[Auth] ${serviceId}: token refreshed, new expiry in ${Math.round(data.remaining_seconds / 60)} min`);
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
                // status === 'valid' - token still valid, just reschedule based on current remaining time
                // Only reschedule if remaining time is significant (> 10 min threshold)
                const newExpiresAt = Date.now() + (data.remaining_seconds * 1000);
                if (data.remaining_seconds > 600) {
                    console.log(`[Auth] ${serviceId}: token still valid, rescheduling refresh`);
                    scheduleRefreshForService(serviceId, newExpiresAt);
                } else {
                    // Token is within threshold but wasn't refreshed - retry in 1 min
                    console.log(`[Auth] ${serviceId}: token within threshold but not refreshed, retrying in 1 min`);
                    const retryAt = Date.now() + (60 * 1000);
                    scheduleRefreshForService(serviceId, retryAt + (10 * 60 * 1000)); // Add 10 min to get proper scheduling
                }
            }
            // Reset retry count on any successful response
            refreshRetryCountRef.current[serviceId] = 0;
        } catch (e) {
            // Network error - retry up to 3 times at 1 min intervals
            const retryCount = (refreshRetryCountRef.current[serviceId] || 0) + 1;
            refreshRetryCountRef.current[serviceId] = retryCount;

            if (retryCount >= 3) {
                console.error(`[Auth] ${serviceId}: network error after ${retryCount} retries, marking disconnected:`, e);
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
                console.warn(`[Auth] ${serviceId}: network error (retry ${retryCount}/3), retrying in 1 min:`, e);
                const retryAt = Date.now() + (60 * 1000);
                scheduleRefreshForService(serviceId, retryAt + (10 * 60 * 1000)); // Add 10 min to get proper scheduling
            }
        }
    }, [scheduleRefreshForService]);

    // New: allow external code (like useSync) to mark a service as disconnected
    const markServiceDisconnected = useCallback((serviceId: string, error?: string) => {
        console.log(`[Auth] ${serviceId}: marked as disconnected${error ? ` (${error})` : ''}`);
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

    const connectedServices = Object.entries(serviceAuth)
        .filter(([_, state]) => state.connected === true)
        .map(([serviceId]) => serviceId);

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
