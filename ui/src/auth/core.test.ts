import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAuth } from './config';
import {
  AUTH_KEY,
  bootstrapSharedSession,
  claims,
  errorMessage,
  getFreshIdToken,
  isSignedIn,
  readSession,
  signIn,
  signOut
} from './core';

const CONFIG = { region: 'us-east-1', clientId: 'test-client' };
const SHARED_CONFIG = {
  ...CONFIG,
  sharedCookieDomain: 'localhost',
  sharedCookieName: 'rsc_auth_test',
  sharedCookieMaxAgeSeconds: 3600
};

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
  document.cookie = 'rsc_auth_test=; Domain=localhost; Path=/; Max-Age=0; SameSite=Lax';
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

  it('writes a shared cookie when configured', async () => {
    configureAuth(SHARED_CONFIG);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          AuthenticationResult: { IdToken: fakeJwt({ email: 'a@b.co' }), RefreshToken: 'rt', ExpiresIn: 3600 }
        })
      })
    );
    await signIn('a@b.co', 'Password1');
    expect(document.cookie).toContain('rsc_auth_test=');
  });

  it('defaults the shared cookie on readysetcloud.io hosts', async () => {
    vi.stubGlobal('location', { hostname: 'booked.readysetcloud.io' });
    const cookieWrites: string[] = [];
    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    vi.spyOn(document, 'cookie', 'set').mockImplementation((value) => {
      cookieWrites.push(value);
      cookieDescriptor?.set?.call(document, value);
    });
    configureAuth(CONFIG);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          AuthenticationResult: { IdToken: fakeJwt({ email: 'a@b.co' }), RefreshToken: 'rt', ExpiresIn: 3600 }
        })
      })
    );
    await signIn('a@b.co', 'Password1');
    expect(cookieWrites.some((value) => value.includes('rsc_auth=') && value.includes('Domain=.readysetcloud.io'))).toBe(
      true
    );
  });

  it('does not default the shared cookie on unrelated hosts', async () => {
    vi.stubGlobal('location', { hostname: 'oliviasgarden.org' });
    configureAuth(CONFIG);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          AuthenticationResult: { IdToken: fakeJwt({ email: 'a@b.co' }), RefreshToken: 'rt', ExpiresIn: 3600 }
        })
      })
    );
    await signIn('a@b.co', 'Password1');
    expect(document.cookie).not.toContain('rsc_auth=');
  });

  it('hydrates localStorage from the shared cookie', async () => {
    configureAuth(SHARED_CONFIG);
    const sharedSession = {
      idToken: fakeJwt({ email: 'shared@readysetcloud.io' }),
      refreshToken: 'shared-refresh',
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    };
    document.cookie = `rsc_auth_test=${btoa(JSON.stringify(sharedSession))}; Domain=localhost; Path=/; SameSite=Lax`;
    localStorage.clear();
    expect(await bootstrapSharedSession()).toEqual(sharedSession);
    expect(readSession()?.refreshToken).toBe('shared-refresh');
  });

  it('clears a stale local session when the shared cookie is signed out', () => {
    configureAuth(SHARED_CONFIG);
    seedSession();
    document.cookie = 'rsc_auth_test=signed_out; Domain=localhost; Path=/; SameSite=Lax';
    expect(readSession()).toBeNull();
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
  });

  it('drops the signed-out sentinel when the session cookie is too big to store', async () => {
    // A cookie over the browser's ~4KB budget is dropped without an error, and
    // a big enough id token gets there. Leaving `signed_out` behind would make
    // readSession() delete the session that just signed in.
    configureAuth(SHARED_CONFIG);
    await signOut();
    expect(document.cookie).toContain('rsc_auth_test=signed_out');

    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
    vi.spyOn(document, 'cookie', 'set').mockImplementation(function (this: Document, value: string) {
      // jsdom has no size limit of its own, so stand in for the browser's.
      if (value.length > 4096) return;
      cookieDescriptor.set?.call(this, value);
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          AuthenticationResult: {
            IdToken: fakeJwt({ email: 'a@b.co', bloat: 'x'.repeat(4096) }),
            RefreshToken: 'rt',
            ExpiresIn: 3600
          }
        })
      })
    );

    await expect(signIn('a@b.co', 'Password1')).resolves.toEqual({ kind: 'success' });
    expect(document.cookie).not.toContain('signed_out');
    // The bridge is gone for this origin, but the session itself survives.
    expect(isSignedIn()).toBe(true);
    expect(readSession()?.refreshToken).toBe('rt');
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

  it('fails loudly when the browser refuses to keep the session', async () => {
    // Safari private mode / blocked site data: the write is a silent no-op, so
    // reporting success would leave the caller re-rendering an untouched form.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          AuthenticationResult: { IdToken: fakeJwt({ email: 'a@b.co' }), RefreshToken: 'rt', ExpiresIn: 3600 }
        })
      })
    );

    await expect(signIn('a@b.co', 'Password1')).rejects.toMatchObject({
      code: 'SessionNotPersisted'
    });
    expect(isSignedIn()).toBe(false);
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
