/**
 * Authentication hook for accessing auth state and actions.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isAuthenticated, connectedServices, checkAuth } = useAuth();
 *
 *   if (!isAuthenticated) {
 *     return <LoginPrompt />;
 *   }
 *
 *   return <div>Connected to: {connectedServices.join(', ')}</div>;
 * }
 * ```
 *
 * @module useAuth
 */

// Re-export from AuthContext for backwards compatibility
export { useAuth } from '../context/AuthContext';
export type { ServiceAuthState, ServiceAuthRecord, AuthContextValue as UseAuthReturn } from '../context/AuthContext';
