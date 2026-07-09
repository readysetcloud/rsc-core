/*
 * The shared RSC auth core — promoted from concurrency-bootcamp's
 * platform/src/lib/auth.ts, which itself is the TypeScript port of the
 * original js/account.js implementation.
 *
 * The session contract every RSC surface shares is the `rsc:auth`
 * localStorage document ({idToken, refreshToken, expiresAt}) plus plain
 * Cognito user pool API calls. No SDK, no Hosted UI — cognito-idp over TLS.
 *
 * NOTE: localStorage is per-origin, so this contract shares a session
 * between surfaces on the SAME subdomain (e.g. a platform SPA and its
 * course pages). True SSO across *.readysetcloud.io subdomains needs a
 * parent-domain cookie and is a deliberate future change to this file.
 */

import { getConfig, type AuthConfig } from './config';

export const AUTH_KEY = 'rsc:auth';

export interface Session {
  idToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch seconds
}

export interface IdClaims {
  email?: string;
  given_name?: string;
  family_name?: string;
  sub?: string;
  [claim: string]: unknown;
}

export type SignInResult =
  | { kind: 'success' }
  | { kind: 'newPasswordRequired'; session: string };

/* ---------- friendly error translation ---------- */

const ERROR_COPY: Record<string, string> = {
  NotAuthorizedException: 'Incorrect email or password.',
  UserNotFoundException: 'Incorrect email or password.',
  UsernameExistsException: 'An account with this email already exists.',
  InvalidPasswordException: "That password doesn't meet the requirements below.",
  CodeMismatchException: "That code isn't right — check it and try again.",
  ExpiredCodeException: 'That code has expired — request a new one.',
  LimitExceededException: 'Too many attempts — wait a few minutes and try again.',
  TooManyRequestsException: 'Too many attempts — wait a moment and try again.',
  UserNotConfirmedException: "This account hasn't verified its email yet."
};

const errorCode = (body: { __type?: unknown }): string =>
  (String(body.__type ?? '').split('#').pop() ?? '').replace(/:.*$/, '');

/** Exported for tests: raw Cognito error body -> copy a human should read. */
export function errorMessage(body: { __type?: unknown; message?: unknown }): string {
  return (
    ERROR_COPY[errorCode(body)] ||
    (typeof body.message === 'string' ? body.message : '') ||
    'Something went wrong — please try again.'
  );
}

export class AuthError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export const isAuthError = (e: unknown): e is AuthError => e instanceof AuthError;

/* ---------- the session document ---------- */

const nowSec = () => Math.floor(Date.now() / 1000);

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as Partial<Session> | null;
    if (!doc || typeof doc.idToken !== 'string' || typeof doc.expiresAt !== 'number') return null;
    return doc as Session;
  } catch {
    return null;
  }
}

export const isSignedIn = (): boolean => !!readSession();

/** Parse the id token payload (base64url JWT) — defensive read. */
export function claims(): IdClaims {
  const session = readSession();
  if (!session) return {};
  try {
    const payload = session.idToken.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)) as IdClaims;
  } catch {
    return {};
  }
}

/* ---------- change notification (React re-renders + cross-tab) ---------- */

const listeners = new Set<() => void>();

export function onAuthChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* one bad listener never blocks the rest */
    }
  }
}

if (typeof window !== 'undefined') {
  // a sign-in/out in another tab updates this one
  window.addEventListener('storage', (e) => {
    if (e.key === AUTH_KEY || e.key === null) notify();
  });
}

interface CognitoAuthResult {
  IdToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
}

function saveAuthResult(result: CognitoAuthResult | undefined): void {
  if (!result?.IdToken) return;
  const prev = readSession();
  const session: Session = {
    idToken: result.IdToken,
    refreshToken: result.RefreshToken || prev?.refreshToken,
    expiresAt: nowSec() + (result.ExpiresIn || 3600)
  };
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable — stay signed out rather than crash */
  }
  notify();
}

function clearSession(): void {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

/* ---------- Cognito user pool API ---------- */

interface InitiateAuthResponse {
  AuthenticationResult?: CognitoAuthResult;
  ChallengeName?: string;
  Session?: string;
}

async function requireConfig(): Promise<AuthConfig> {
  const config = await getConfig();
  if (!config) {
    throw new AuthError(
      'Auth is not configured — call configureAuth() before using auth functions.',
      'ConfigMissing'
    );
  }
  return config;
}

async function idp<T>(region: string, action: string, payload: unknown): Promise<T> {
  const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': `AWSCognitoIdentityProviderService.${action}`
    },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(errorMessage(body), errorCode(body));
  return body as T;
}

/* ---------- operations ---------- */

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const config = await requireConfig();
  try {
    const out = await idp<InitiateAuthResponse>(config.region, 'InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: config.clientId,
      AuthParameters: { USERNAME: email, PASSWORD: password }
    });
    if (out.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      return { kind: 'newPasswordRequired', session: out.Session ?? '' };
    }
    saveAuthResult(out.AuthenticationResult);
    return { kind: 'success' };
  } catch (e) {
    if (isAuthError(e) && e.code === 'UserNotConfirmedException') {
      // best-effort: a fresh code is already on its way when the UI lands
      // on the confirm screen
      await resendConfirmationCode(email).catch(() => {});
    }
    throw e;
  }
}

export async function signUp(
  firstName: string,
  lastName: string,
  email: string,
  password: string
): Promise<void> {
  const config = await requireConfig();
  await idp(config.region, 'SignUp', {
    ClientId: config.clientId,
    Username: email,
    Password: password,
    UserAttributes: [
      // the shared pool REQUIRES given_name/family_name
      { Name: 'email', Value: email },
      { Name: 'given_name', Value: firstName.trim() },
      { Name: 'family_name', Value: lastName.trim() }
    ]
  });
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  const config = await requireConfig();
  await idp(config.region, 'ConfirmSignUp', {
    ClientId: config.clientId,
    Username: email,
    ConfirmationCode: code
  });
}

export async function resendConfirmationCode(email: string): Promise<void> {
  const config = await requireConfig();
  await idp(config.region, 'ResendConfirmationCode', {
    ClientId: config.clientId,
    Username: email
  });
}

export async function forgotPassword(email: string): Promise<void> {
  const config = await requireConfig();
  await idp(config.region, 'ForgotPassword', {
    ClientId: config.clientId,
    Username: email
  });
}

export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  const config = await requireConfig();
  await idp(config.region, 'ConfirmForgotPassword', {
    ClientId: config.clientId,
    Username: email,
    ConfirmationCode: code,
    Password: newPassword
  });
}

export async function respondNewPassword(
  email: string,
  newPassword: string,
  session: string
): Promise<void> {
  const config = await requireConfig();
  const out = await idp<InitiateAuthResponse>(config.region, 'RespondToAuthChallenge', {
    ClientId: config.clientId,
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    Session: session,
    ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword }
  });
  saveAuthResult(out.AuthenticationResult);
}

/** Valid id token, refreshing behind the scenes when it's near expiry.
    Definite auth failures clear the session; network errors keep the tokens
    (offline shouldn't sign anyone out) and return null. */
export async function getFreshIdToken(): Promise<string | null> {
  const session = readSession();
  if (!session) return null;
  if (session.expiresAt - 60 > nowSec()) return session.idToken;
  if (!session.refreshToken) {
    clearSession();
    return null;
  }
  const config = await getConfig();
  if (!config) return null;
  try {
    const out = await idp<InitiateAuthResponse>(config.region, 'InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: config.clientId,
      AuthParameters: { REFRESH_TOKEN: session.refreshToken }
    });
    saveAuthResult(out.AuthenticationResult);
    return readSession()?.idToken ?? null;
  } catch (e) {
    // a Cognito error body means the session is revoked/expired for real;
    // anything else (offline, 5xx without a body) keeps the tokens
    if (isAuthError(e) && e.code) clearSession();
    return null;
  }
}

/** Drop rsc:auth (and nothing else), then best-effort revoke the refresh token. */
export async function signOut(): Promise<void> {
  const session = readSession();
  clearSession();
  if (!session?.refreshToken) return;
  try {
    const config = await getConfig();
    if (!config) return;
    await idp(config.region, 'RevokeToken', {
      ClientId: config.clientId,
      Token: session.refreshToken
    });
  } catch {
    /* best effort */
  }
}
