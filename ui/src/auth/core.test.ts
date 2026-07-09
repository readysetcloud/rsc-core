import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAuth } from './config';
import {
  AUTH_KEY,
  claims,
  errorMessage,
  getFreshIdToken,
  isSignedIn,
  readSession,
  signIn,
  signOut
} from './core';

const CONFIG = { region: 'us-east-1', clientId: 'test-client' };

/** Base64url-encode a JWT payload the way Cognito does. */
const fakeJwt = (payload: object): string =>
  `header.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.sig`;

const seedSession = (overrides: Partial<{ idToken: string; refreshToken: string; expiresAt: number }> = {}) => {
  localStorage.setItem(
    AUTH_KEY,
    JSON.stringify({
      idToken: fakeJwt({ email: 'allen@readysetcloud.io', given_name: 'Allen' }),
      refreshToken: 'refresh-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      ...overrides
    })
  );
};

beforeEach(() => {
  localStorage.clear();
  configureAuth(CONFIG);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('errorMessage', () => {
  it('maps known Cognito error types to friendly copy', () => {
    expect(errorMessage({ __type: 'NotAuthorizedException' })).toBe('Incorrect email or password.');
    expect(
      errorMessage({ __type: 'com.amazon#CodeMismatchException' })
    ).toBe("That code isn't right — check it and try again.");
  });

  it('falls back to the raw message, then generic copy', () => {
    expect(errorMessage({ __type: 'SomethingNew', message: 'Custom detail' })).toBe('Custom detail');
    expect(errorMessage({})).toBe('Something went wrong — please try again.');
  });
});

describe('session document', () => {
  it('reads a valid rsc:auth document', () => {
    seedSession();
    expect(isSignedIn()).toBe(true);
    expect(readSession()?.refreshToken).toBe('refresh-token');
  });

  it('rejects malformed documents', () => {
    localStorage.setItem(AUTH_KEY, 'not json');
    expect(readSession()).toBeNull();
    localStorage.setItem(AUTH_KEY, JSON.stringify({ idToken: 42 }));
    expect(readSession()).toBeNull();
  });

  it('parses id token claims defensively', () => {
    seedSession();
    expect(claims().email).toBe('allen@readysetcloud.io');
    localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({ idToken: 'garbage', expiresAt: Math.floor(Date.now() / 1000) + 3600 })
    );
    expect(claims()).toEqual({});
  });
});

describe('signIn', () => {
  it('saves the session on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          AuthenticationResult: { IdToken: fakeJwt({ email: 'a@b.co' }), RefreshToken: 'rt', ExpiresIn: 3600 }
        })
      })
    );
    const result = await signIn('a@b.co', 'Password1');
    expect(result.kind).toBe('success');
    expect(isSignedIn()).toBe(true);
  });

  it('surfaces the new-password challenge without saving a session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 'challenge-session' })
      })
    );
    const result = await signIn('a@b.co', 'Password1');
    expect(result).toEqual({ kind: 'newPasswordRequired', session: 'challenge-session' });
    expect(isSignedIn()).toBe(false);
  });

  it('throws friendly errors from Cognito error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ __type: 'NotAuthorizedException' })
      })
    );
    await expect(signIn('a@b.co', 'wrong')).rejects.toThrow('Incorrect email or password.');
  });
});

describe('getFreshIdToken', () => {
  it('returns the current token when not near expiry', async () => {
    seedSession();
    const fetchSpy = vi.stubGlobal('fetch', vi.fn());
    const token = await getFreshIdToken();
    expect(token).toBe(readSession()?.idToken);
    expect(fetchSpy).toBeDefined();
  });

  it('refreshes an expired token', async () => {
    seedSession({ expiresAt: Math.floor(Date.now() / 1000) - 10 });
    const newToken = fakeJwt({ email: 'a@b.co', fresh: true });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ AuthenticationResult: { IdToken: newToken, ExpiresIn: 3600 } })
      })
    );
    expect(await getFreshIdToken()).toBe(newToken);
    // refresh token carried over from the previous session document
    expect(readSession()?.refreshToken).toBe('refresh-token');
  });

  it('clears the session on a definite auth failure', async () => {
    seedSession({ expiresAt: Math.floor(Date.now() / 1000) - 10 });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ __type: 'NotAuthorizedException' })
      })
    );
    expect(await getFreshIdToken()).toBeNull();
    expect(isSignedIn()).toBe(false);
  });

  it('keeps tokens on network failure (offline must not sign out)', async () => {
    seedSession({ expiresAt: Math.floor(Date.now() / 1000) - 10 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    expect(await getFreshIdToken()).toBeNull();
    expect(isSignedIn()).toBe(true);
  });
});

describe('signOut', () => {
  it('clears the session and revokes the refresh token', async () => {
    seedSession();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await signOut();
    expect(isSignedIn()).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cognito-idp.us-east-1.amazonaws.com/',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-amz-target': 'AWSCognitoIdentityProviderService.RevokeToken'
        })
      })
    );
  });
});

describe('unconfigured auth', () => {
  it('fails with a clear message when configureAuth was never called', async () => {
    configureAuth(null);
    await expect(signIn('a@b.co', 'pw')).rejects.toThrow(/configureAuth/);
  });
});
