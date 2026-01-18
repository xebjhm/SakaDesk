import { useState, useEffect, useRef, useCallback } from 'react';
import type { MultiGroupAuthStatus } from '../../types';
import { useAppStore } from '../../store/appStore';

export interface ServiceAuthState {
    connected: boolean;
    tokenExpiresAt: number | null;
    error: string | null;
    wasEverConnected: boolean;
}

export type ServiceAuthRecord = Record<string, ServiceAuthState>;

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

export function useAuth(): UseAuthReturn {
    const { activeService, setActiveService } = useAppStore();

    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
    const [authCheckComplete, setAuthCheckComplete] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [authStatus, setAuthStatus] = useState<MultiGroupAuthStatus | null>(null);
    const [serviceAuth, setServiceAuth] = useState<ServiceAuthRecord>({});

    const refreshTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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
    }, [scheduleRefreshForService]);

    useEffect(() => {
        checkAuth();
    }, []);

    useEffect(() => {
        if (isAuthenticated) {
            scheduleTokenRefresh();
        }

        return () => {
            if (tokenRefreshTimeoutRef.current) {
                clearTimeout(tokenRefreshTimeoutRef.current);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated]);

    const connectedServices = authStatus
        ? Object.entries(authStatus)
            .filter(([_, s]) => s.authenticated === true)
            .map(([name]) => name)
        : [];

    const isServiceConnected = useCallback(
        (serviceId: string) => connectedServices.includes(serviceId),
        [connectedServices]
    );

    return {
        isAuthenticated,
        authCheckComplete,
        authStatus,
        authError,
        setAuthError,
        checkAuth,
        connectedServices,
        isServiceConnected,
    };
}
