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

    const getJitteredRefreshInterval = () => {
        const baseMs = 50 * 60 * 1000;
        const jitterMs = Math.random() * 5 * 60 * 1000;
        return baseMs + jitterMs;
    };

    const scheduleTokenRefresh = useCallback(() => {
        if (tokenRefreshTimeoutRef.current) {
            clearTimeout(tokenRefreshTimeoutRef.current);
        }

        const intervalMs = getJitteredRefreshInterval();
        console.log(`[Auth] Scheduling token refresh in ${Math.round(intervalMs / 60000)} minutes`);

        tokenRefreshTimeoutRef.current = setTimeout(async () => {
            try {
                console.log('[Auth] Proactive token refresh triggered');
                const services = authStatus
                    ? Object.entries(authStatus)
                        .filter(([_, s]) => s.authenticated === true)
                        .map(([name]) => name)
                    : [];

                let allValid = true;
                for (const service of services) {
                    const res = await fetch(`/api/auth/refresh-if-needed?service=${encodeURIComponent(service)}`, { method: 'POST' });
                    const data = await res.json();
                    console.log(`[Auth] Refresh result for ${service}: ${data.status}, remaining: ${Math.round(data.remaining_seconds / 60)} min`);

                    if (data.status === 'refresh_failed' || data.status === 'no_token') {
                        allValid = false;
                    }
                }

                if (allValid || services.length === 0) {
                    scheduleTokenRefresh();
                } else {
                    console.warn('[Auth] Token refresh failed for at least one service');
                    setIsAuthenticated(false);
                    setAuthError("Session expired. Please login again.");
                }
            } catch (e) {
                console.error('[Auth] Token refresh error:', e);
                scheduleTokenRefresh();
            }
        }, intervalMs);
    }, [authStatus]);

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
