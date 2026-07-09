/*
 * React bindings for the shared auth core.
 *
 * Router-agnostic on purpose: RequireAuth renders a `fallback` node when
 * signed out — pass your router's redirect (e.g. <Navigate to="/login" />).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import {
  claims,
  getFreshIdToken,
  isSignedIn,
  onAuthChange,
  signOut as coreSignOut,
  type IdClaims
} from './core';

export interface AuthState {
  /** True when an rsc:auth session document exists. */
  signedIn: boolean;
  /** Decoded id-token claims ({} when signed out). */
  user: IdClaims;
  /** Valid id token for API calls, auto-refreshing near expiry. */
  getToken: () => Promise<string | null>;
  /** Clear the session and best-effort revoke the refresh token. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean>(() => isSignedIn());
  const [user, setUser] = useState<IdClaims>(() => claims());

  useEffect(() => {
    // core notifies on sign-in/out in this tab and (via storage events) others
    return onAuthChange(() => {
      setSignedIn(isSignedIn());
      setUser(claims());
    });
  }, []);

  const getToken = useCallback(() => getFreshIdToken(), []);
  const signOut = useCallback(() => coreSignOut(), []);

  const value = useMemo<AuthState>(
    () => ({ signedIn, user, getToken, signOut }),
    [signedIn, user, getToken, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export interface RequireAuthProps {
  children: ReactNode;
  /** Rendered when signed out — typically your router's redirect. */
  fallback: ReactNode;
}

export function RequireAuth({ children, fallback }: RequireAuthProps) {
  const { signedIn } = useAuth();
  return <>{signedIn ? children : fallback}</>;
}
