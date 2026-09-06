import { describe, expect, it } from 'vitest';
import { AppError } from '../src/http/errors.js';
import type { AuthRepo, UserRecord } from '../src/modules/auth/auth.repo.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createPasswordHasher } from '../src/modules/auth/password.js';
import { createSessionToken, hashSessionToken } from '../src/modules/auth/tokens.js';
import { fakeHasher, queryable, testConfig } from './helpers.js';

// --------------------------------------------------------------------- fakes

interface AuditRow {
  action: string;
  actorType: string;
}

function recordingDb() {
  const audits: AuditRow[] = [];
  const db = queryable((text, params) => {
    if (text.includes('INSERT INTO audit_log')) {
      const values = (params ?? []) as unknown[];
      audits.push({ actorType: String(values[0]), action: String(values[2]) });
    }
    return Promise.resolve({ rows: [] });
  });
  return { db, audits };
}

const ACTIVE_USER: UserRecord = {
  id: 'user-1',
  email: 'priya@example.com',
  password_hash: 'fake$correct horse battery staple',
  role: 'CUSTOMER',
  status: 'active',
};

function fakeRepo(overrides: Partial<AuthRepo> = {}): AuthRepo {
  return {
    findUserByEmail: () => Promise.resolve(undefined),
    insertUser: ({ email, role }) =>
      Promise.resolve({ ...ACTIVE_USER, email, role, password_hash: 'stored' }),
    createSession: () => Promise.resolve({ id: 'session-1' }),
    findLiveSession: () => Promise.resolve(undefined),
    revokeSession: () => Promise.resolve(),
    ...overrides,
  };
}

/**
 * Resolves to the AppError a call rejected with. Fails loudly if the call
 * SUCCEEDED — otherwise a test asserting "these two failures look alike" would
 * pass happily on two successes.
 */
async function failureOf(attempt: Promise<unknown>): Promise<AppError> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected this call to fail, but it succeeded');
}

function serviceWith(repo: AuthRepo, hasher = fakeHasher()) {
  const { db, audits } = recordingDb();
  return {
    service: createAuthService({ db, config: testConfig, hasher, repo }),
    audits,
    hasher,
  };
}

// ------------------------------------------------------------------ hashing

describe('password hashing', () => {
  it('round-trips a password and rejects the wrong one', async () => {
    const hasher = await createPasswordHasher(testConfig);
    const digest = await hasher.hash('correct horse battery staple');

    expect(digest.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(digest, 'correct horse battery staple')).toBe(true);
    expect(await hasher.verify(digest, 'wrong')).toBe(false);
  });

  it('produces a different digest each time, so equal passwords are not equal rows', async () => {
    const hasher = await createPasswordHasher(testConfig);
    const a = await hasher.hash('same password');
    const b = await hasher.hash('same password');

    expect(a).not.toBe(b);
    expect(await hasher.verify(b, 'same password')).toBe(true);
  });

  // A corrupt row must behave like a wrong password, not like a crash: the
  // library throws on a malformed digest and that would otherwise be a 500.
  it('treats a malformed digest as a failed verification rather than throwing', async () => {
    const hasher = await createPasswordHasher(testConfig);
    await expect(hasher.verify('not-a-digest', 'anything')).resolves.toBe(false);
  });
});

// ------------------------------------------------------------------- tokens

describe('session tokens', () => {
  it('issues 256 bits of entropy and stores only the hash', () => {
    const { token, tokenHash } = createSessionToken();

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(token);
  });

  it('hashes deterministically, so a cookie can be looked up by index', () => {
    const { token, tokenHash } = createSessionToken();
    expect(hashSessionToken(token)).toBe(tokenHash);
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createSessionToken().token));
    expect(tokens.size).toBe(200);
  });
});

// ------------------------------------------------------------------ register

describe('register', () => {
  it('creates a CUSTOMER and audits it', async () => {
    const { service, audits } = serviceWith(fakeRepo());

    const user = await service.register({
      email: 'New.Person@Example.com',
      password: 'a sufficiently long password',
    });

    expect(user.role).toBe('CUSTOMER');
    // Stored lowercased, to match the unique index on lower(email).
    expect(user.email).toBe('new.person@example.com');
    expect(audits).toContainEqual({ actorType: 'customer', action: 'auth.register.succeeded' });
  });

  it('never returns the password hash to the caller', async () => {
    const { service } = serviceWith(fakeRepo());
    const user = await service.register({ email: 'a@example.com', password: 'long enough password' });

    expect(Object.keys(user).sort()).toEqual(['email', 'id', 'role']);
  });

  // A duplicate address must not be confirmed as such, or the endpoint becomes
  // an account-enumeration oracle (invariant 9).
  it('reports a duplicate address without admitting it is a duplicate', async () => {
    const duplicate = Object.assign(new Error('duplicate key'), { code: '23505' });
    const { service, audits } = serviceWith(
      fakeRepo({ insertUser: () => Promise.reject(duplicate) }),
    );

    await expect(
      service.register({ email: 'taken@example.com', password: 'long enough password' }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'REGISTRATION_FAILED',
      message: 'Registration could not be completed',
    });

    // The system still records it, so the signal is available to us and not
    // to the caller.
    expect(audits).toContainEqual({ actorType: 'system', action: 'auth.register.rejected' });
  });

  it('lets any other database error surface rather than masking it', async () => {
    const { service } = serviceWith(
      fakeRepo({ insertUser: () => Promise.reject(new Error('disk on fire')) }),
    );

    await expect(
      service.register({ email: 'a@example.com', password: 'long enough password' }),
    ).rejects.toThrow('disk on fire');
  });
});

// --------------------------------------------------------------------- login

describe('login', () => {
  it('issues a session for correct credentials', async () => {
    const { service, audits } = serviceWith(
      fakeRepo({ findUserByEmail: () => Promise.resolve(ACTIVE_USER) }),
    );

    const { user, token } = await service.login({
      email: 'priya@example.com',
      password: 'correct horse battery staple',
    });

    expect(user.id).toBe('user-1');
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(audits).toContainEqual({ actorType: 'customer', action: 'auth.login.succeeded' });
  });

  it('gives the same answer for a wrong password as for an unknown address', async () => {
    const unknown = serviceWith(fakeRepo());
    const wrongPassword = serviceWith(
      fakeRepo({ findUserByEmail: () => Promise.resolve(ACTIVE_USER) }),
    );

    const a = await failureOf(
      unknown.service.login({ email: 'nobody@example.com', password: 'whatever' }),
    );
    const b = await failureOf(
      wrongPassword.service.login({ email: 'priya@example.com', password: 'not the password' }),
    );

    expect({ status: a.status, code: a.code, message: a.message }).toEqual({
      status: b.status,
      code: b.code,
      message: b.message,
    });
  });

  // The shared message is worthless if the response time gives it away: an
  // unknown address would return in microseconds while a known one spends
  // tens of milliseconds hashing.
  it('spends hashing work even when no user matched', async () => {
    const { service, hasher } = serviceWith(fakeRepo());

    await service.login({ email: 'nobody@example.com', password: 'whatever' }).catch(() => {});

    expect(hasher.spendEqualWorkCalls).toBe(1);
  });

  it('refuses a suspended account without saying it is suspended', async () => {
    const suspended = { ...ACTIVE_USER, status: 'suspended' as const };
    const { service, audits } = serviceWith(
      fakeRepo({ findUserByEmail: () => Promise.resolve(suspended) }),
    );

    await expect(
      service.login({ email: 'priya@example.com', password: 'correct horse battery staple' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    expect(audits).toContainEqual({ actorType: 'customer', action: 'auth.login.failed' });
  });

  it('matches the address case-insensitively', async () => {
    let asked = '';
    const { service } = serviceWith(
      fakeRepo({
        findUserByEmail: (email) => {
          asked = email;
          return Promise.resolve(ACTIVE_USER);
        },
      }),
    );

    await service.login({
      email: '  PRIYA@Example.COM  ',
      password: 'correct horse battery staple',
    });

    expect(asked).toBe('priya@example.com');
  });
});

// -------------------------------------------------------------------- logout

describe('logout', () => {
  it('revokes the session and audits it', async () => {
    let revoked = '';
    const { service, audits } = serviceWith(
      fakeRepo({
        revokeSession: (id) => {
          revoked = id;
          return Promise.resolve();
        },
      }),
    );

    await service.logout({
      userId: 'user-1',
      email: 'priya@example.com',
      role: 'CUSTOMER',
      sessionId: 'session-1',
    });

    expect(revoked).toBe('session-1');
    expect(audits).toContainEqual({ actorType: 'customer', action: 'auth.logout' });
  });
});
