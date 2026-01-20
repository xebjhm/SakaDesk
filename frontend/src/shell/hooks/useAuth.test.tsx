import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { AuthProvider, useAuth } from '../context/AuthContext'
import type { ReactNode } from 'react'

// Mock appStore - needs to be before other imports that use it
vi.mock('../../store/appStore', () => ({
    useAppStore: () => ({
        activeService: null,
        setActiveService: vi.fn(),
    }),
}))

// Wrapper component for tests
function Wrapper({ children }: { children: ReactNode }) {
    return <AuthProvider>{children}</AuthProvider>
}

describe('useAuth', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // Reset fetch mock before each test
        vi.stubGlobal('fetch', vi.fn())
    })

    it('should throw if used outside AuthProvider', () => {
        // Suppress console.error for this test
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        expect(() => {
            renderHook(() => useAuth())
        }).toThrow('useAuth must be used within an AuthProvider')

        consoleSpy.mockRestore()
    })

    it('should complete auth check and detect connected services', async () => {
        const expiresAt = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                services: {
                    hinatazaka46: { authenticated: true, expires_at: expiresAt },
                    sakurazaka46: { authenticated: false },
                },
            }),
        }))

        const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })

        await waitFor(() => {
            expect(result.current.authCheckComplete).toBe(true)
        })

        expect(result.current.isAuthenticated).toBe(true)
        expect(result.current.connectedServices).toEqual(['hinatazaka46'])
        expect(result.current.isServiceConnected('hinatazaka46')).toBe(true)
        expect(result.current.isServiceConnected('sakurazaka46')).toBe(false)
        expect(result.current.getServiceExpiresAt('hinatazaka46')).toBe(expiresAt * 1000)
    })

    it('should set isAuthenticated false when no services connected', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                services: {
                    hinatazaka46: { authenticated: false },
                },
            }),
        }))

        const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })

        await waitFor(() => {
            expect(result.current.authCheckComplete).toBe(true)
        })

        expect(result.current.isAuthenticated).toBe(false)
        expect(result.current.connectedServices).toEqual([])
    })

    it('should detect expired token services', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                services: {
                    hinatazaka46: { authenticated: false, token_expired: true },
                },
            }),
        }))

        const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })

        await waitFor(() => {
            expect(result.current.authCheckComplete).toBe(true)
        })

        expect(result.current.isServiceDisconnected('hinatazaka46')).toBe(true)
        expect(result.current.getServiceError('hinatazaka46')).toBe('Session expired')
        expect(result.current.disconnectedServices).toContain('hinatazaka46')
    })

    it('should allow setting and clearing auth errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ services: {} }),
        }))

        const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })

        await waitFor(() => {
            expect(result.current.authCheckComplete).toBe(true)
        })

        act(() => {
            result.current.setAuthError('Test error')
        })
        expect(result.current.authError).toBe('Test error')

        act(() => {
            result.current.setAuthError(null)
        })
        expect(result.current.authError).toBeNull()
    })

    it('should allow marking a service as disconnected', async () => {
        const expiresAt = Math.floor(Date.now() / 1000) + 3600
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                services: {
                    hinatazaka46: { authenticated: true, expires_at: expiresAt },
                },
            }),
        }))

        const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })

        await waitFor(() => {
            expect(result.current.isServiceConnected('hinatazaka46')).toBe(true)
        })

        act(() => {
            result.current.markServiceDisconnected('hinatazaka46', 'Session expired')
        })

        expect(result.current.isServiceConnected('hinatazaka46')).toBe(false)
        expect(result.current.isServiceDisconnected('hinatazaka46')).toBe(true)
        expect(result.current.getServiceError('hinatazaka46')).toBe('Session expired')
    })

    it('should allow clearing service errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                services: {
                    hinatazaka46: { authenticated: false, token_expired: true },
                },
            }),
        }))

        const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })

        await waitFor(() => {
            expect(result.current.authCheckComplete).toBe(true)
        })

        expect(result.current.getServiceError('hinatazaka46')).toBe('Session expired')

        act(() => {
            result.current.clearServiceError('hinatazaka46')
        })

        expect(result.current.getServiceError('hinatazaka46')).toBeNull()
    })

    it('should return null/false for unknown service queries', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ services: {} }),
        }))

        const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })

        await waitFor(() => {
            expect(result.current.authCheckComplete).toBe(true)
        })

        expect(result.current.isServiceConnected('unknown')).toBe(false)
        expect(result.current.isServiceDisconnected('unknown')).toBe(false)
        expect(result.current.getServiceError('unknown')).toBeNull()
        expect(result.current.getServiceExpiresAt('unknown')).toBeNull()
    })

    it('should handle network errors during auth check', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

        const { result } = renderHook(() => useAuth(), { wrapper: Wrapper })

        await waitFor(() => {
            expect(result.current.authCheckComplete).toBe(true)
        })

        expect(result.current.isAuthenticated).toBe(false)
        consoleSpy.mockRestore()
    })
})
