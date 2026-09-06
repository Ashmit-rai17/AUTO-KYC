/**
 * Auth over real HTTP against a real PostgreSQL.
 *
 * Unlike schema.integration.test.ts this cannot run inside one rolled-back
 * transaction: supertest drives the app through the pool, so each request gets
 * its own connection. Users created here are deleted afterwards (sessions
 * cascade). The audit rows they generate are NOT deleted, because audit_log is
 * append-only by design — that is the point of it.
 *
 * Run with `npm run test:integration`.
 */

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { createDb, type Db } from '../src/db/pool.js';
import { CSRF_HEADER } from '../src/http/csrf.js';
import { createPasswordHasher } from '../src/modules/auth/password.js';
import { hashSessionToken } from '../src/modules/auth/tokens.js';
import { testConfig } from './helpers.js';

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Run `npm run db:up && npm run db:migrate` first.');
}

const config: Config = { ...testConfig, DATABASE_URL };
const PASSWORD = 'a sufficiently long password';

let db: Db;
let app: ReturnType<typeof createApp>;

/** Unique per run so repeated runs never collide on the email index. */
const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let created = 0;
function freshEmail(): string {
  created += 1;
  return `itest-${run}-${created}@example.com`;
}

beforeAll(async () => {
  db = createDb(config);
  app = createApp({ config, db, hasher: await createPasswordHasher(config) });
});

afterAll(async () => {
  if (db) {
    await db.query(`DELETE FROM users WHERE email LIKE $1`, [`itest-${run}-%`]);
    await db.close();
  }
});

interface SignedIn {
  /** Both cookies, ready for a Cookie header. */
  cookies: string;
  /** The CSRF value to echo back in the header. */
  csrf: string;
  /** The raw session token, for checking how it is stored. */
  sessionToken: string;
  email: string;
}

function cookiePairs(response: request.Response): string[] {
  const raw = (response.headers['set-cookie'] ?? []) as unknown as string[];
  return raw.map((entry) => entry.split(';')[0]!);
}

async function signIn(email = freshEmail()): Promise<SignedIn> {
  await request(app).post('/api/auth/register').send({ email, password: PASSWORD }).expect(202);
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);

  const pairs = cookiePairs(login);
  const find = (name: string) => pairs.find((p) => p.startsWith(`${name}=`))!.split('=')[1]!;

  return {
    cookies: pairs.join('; '),
    csrf: find('kyc_csrf'),
    sessionToken: find('kyc_session'),
    email,
  };
}

// ------------------------------------------------------------------ register

describe('POST /api/auth/register', () => {
  it('accepts a new address without echoing the password back', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: freshEmail(), password: PASSWORD });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'accepted' });
    expect(JSON.stringify(response.body)).not.toContain(PASSWORD);
  });

  /**
   * The enumeration fix (ADR-006). A stranger must not be able to learn
   * whether a given person banks here, so the two responses have to be
   * byte-for-byte identical — not merely similarly worded.
   */
  it('answers a taken address exactly as it answers a free one', async () => {
    const taken = freshEmail();
    await request(app).post('/api/auth/register').send({ email: taken, password: PASSWORD }).expect(202);

    const second = await request(app)
      .post('/api/auth/register')
      .send({ email: taken, password: PASSWORD });
    const fresh = await request(app)
      .post('/api/auth/register')
      .send({ email: freshEmail(), password: PASSWORD });

    expect(second.status).toBe(fresh.status);
    expect(second.body).toEqual(fresh.body);
  });

  it('does not overwrite the existing account when its address is re-registered', async () => {
    const email = freshEmail();
    await request(app).post('/api/auth/register').send({ email, password: PASSWORD }).expect(202);
    const before = await db.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE email = $1`,
      [email],
    );

    await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a completely different password' })
      .expect(202);

    const after = await db.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE email = $1`,
      [email],
    );
    // Otherwise "register again" would be an unauthenticated password reset.
    expect(after.rows[0]?.password_hash).toBe(before.rows[0]?.password_hash);

    // And the original password must still work.
    await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  });

  // Privilege escalation: a caller must not be able to make themselves staff
  // by adding a field to the body.
  it('ignores a role supplied in the request body', async () => {
    const email = freshEmail();
    await request(app)
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, role: 'ADMIN' })
      .expect(202);

    const { rows } = await db.query<{ role: string }>(
      `SELECT role FROM users WHERE email = $1`,
      [email],
    );
    expect(rows[0]?.role).toBe('CUSTOMER');
  });

  it('rejects a short password, and says why', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: freshEmail(), password: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toContain('password');
  });

  it('rejects a malformed address', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: PASSWORD });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// --------------------------------------------------------------------- login

describe('POST /api/auth/login', () => {
  it('sets a hardened session cookie', async () => {
    const email = freshEmail();
    await request(app).post('/api/auth/register').send({ email, password: PASSWORD }).expect(202);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email, password: PASSWORD });

    expect(response.status).toBe(200);
    const raw = (response.headers['set-cookie'] as unknown as string[]).join('\n');
    const sessionCookie = raw.split('\n').find((c) => c.startsWith('kyc_session='))!;

    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Path=/');
    // NODE_ENV is 'test' here; Secure is added only in production.
    expect(sessionCookie).not.toContain('Secure');
  });

  it('issues a CSRF cookie that script CAN read, unlike the session', async () => {
    const email = freshEmail();
    await request(app).post('/api/auth/register').send({ email, password: PASSWORD }).expect(202);
    const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });

    const raw = (login.headers['set-cookie'] as unknown as string[]).join('\n');
    const csrfCookie = raw.split('\n').find((c) => c.startsWith('kyc_csrf='))!;

    // The front end has to read this one to echo it back, so it must NOT be
    // httpOnly. It is not a credential on its own.
    expect(csrfCookie).not.toContain('HttpOnly');
    expect(csrfCookie).toContain('SameSite=Lax');
  });

  // httpOnly is pointless if the same value is also handed to script.
  it('stores the session token only as a hash', async () => {
    const { sessionToken } = await signIn();

    const plaintext = await db.query(`SELECT 1 FROM sessions WHERE token_hash = $1`, [
      sessionToken,
    ]);
    expect(plaintext.rows).toHaveLength(0);

    const hashed = await db.query(`SELECT 1 FROM sessions WHERE token_hash = $1`, [
      hashSessionToken(sessionToken),
    ]);
    expect(hashed.rows).toHaveLength(1);
  });

  it('matches the address case-insensitively', async () => {
    const email = freshEmail();
    await request(app).post('/api/auth/register').send({ email, password: PASSWORD }).expect(202);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: email.toUpperCase(), password: PASSWORD });

    expect(response.status).toBe(200);
  });

  it('answers identically for a wrong password and an unknown address', async () => {
    const email = freshEmail();
    await request(app).post('/api/auth/register').send({ email, password: PASSWORD }).expect(202);

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'definitely not the password' });
    const unknownUser = await request(app)
      .post('/api/auth/login')
      .send({ email: freshEmail(), password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
  });
});

// ----------------------------------------------------------------------- me

describe('GET /api/auth/me', () => {
  it('refuses an anonymous request', async () => {
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a forged cookie', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'kyc_session=obviously-not-a-real-token');

    expect(response.status).toBe(401);
  });

  it('returns the signed-in user', async () => {
    const { cookies, email } = await signIn();
    const response = await request(app).get('/api/auth/me').set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ email, role: 'CUSTOMER' });
  });
});

// --------------------------------------------------------------------- CSRF

describe('CSRF protection', () => {
  it('rejects a state-changing request that carries a session but no token', async () => {
    const { cookies } = await signIn();

    const response = await request(app).post('/api/auth/logout').set('Cookie', cookies);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_FAILED');
  });

  it('rejects a token that does not match the cookie', async () => {
    const { cookies } = await signIn();

    const response = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookies)
      .set(CSRF_HEADER, 'a-token-the-attacker-guessed');

    expect(response.status).toBe(403);
  });

  it('leaves the session usable after a rejected attempt', async () => {
    const { cookies } = await signIn();
    await request(app).post('/api/auth/logout').set('Cookie', cookies).expect(403);

    // A failed CSRF check must not log the victim out — that would make it a
    // denial-of-service instead of a defence.
    await request(app).get('/api/auth/me').set('Cookie', cookies).expect(200);
  });

  it('allows safe methods without a token', async () => {
    const { cookies } = await signIn();
    await request(app).get('/api/auth/me').set('Cookie', cookies).expect(200);
  });

  it('does not demand a token from an anonymous request', async () => {
    // Login and register carry no session, so there is nothing to abuse and
    // nothing to prove.
    await request(app)
      .post('/api/auth/register')
      .send({ email: freshEmail(), password: PASSWORD })
      .expect(202);
  });
});

// ------------------------------------------------------------------- logout

describe('POST /api/auth/logout', () => {
  // This is the entire reason ADR-001 chose database sessions over a JWT.
  it('revokes the session immediately, not at expiry', async () => {
    const { cookies, csrf } = await signIn();
    await request(app).get('/api/auth/me').set('Cookie', cookies).expect(200);

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookies)
      .set(CSRF_HEADER, csrf);
    expect(logout.status).toBe(204);

    const after = await request(app).get('/api/auth/me').set('Cookie', cookies);
    expect(after.status).toBe(401);
  });

  it('clears both cookies in the browser too', async () => {
    const { cookies, csrf } = await signIn();
    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookies)
      .set(CSRF_HEADER, csrf);

    const cleared = (logout.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(cleared).toContain('kyc_session=;');
    expect(cleared).toContain('kyc_csrf=;');
  });

  it('refuses an anonymous logout', async () => {
    const response = await request(app).post('/api/auth/logout');
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------- revocation and expiry

describe('session lifetime', () => {
  it('stops accepting a session the moment the account is suspended', async () => {
    const { cookies, email } = await signIn();
    await request(app).get('/api/auth/me').set('Cookie', cookies).expect(200);

    await db.query(`UPDATE users SET status = 'suspended' WHERE email = $1`, [email]);

    const after = await request(app).get('/api/auth/me').set('Cookie', cookies);
    expect(after.status).toBe(401);
  });

  it('rejects a session past its expiry', async () => {
    const { cookies, email } = await signIn();

    await db.query(
      `UPDATE sessions SET expires_at = now() - interval '1 second'
       WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );

    const after = await request(app).get('/api/auth/me').set('Cookie', cookies);
    expect(after.status).toBe(401);
  });
});

// ------------------------------------------------------------- rate limiting

describe('rate limiting', () => {
  /** A separate app so the limiter is on, with its own fresh in-memory store. */
  async function throttledApp(max: number) {
    return createApp({
      config: { ...config, RATE_LIMIT_ENABLED: true, AUTH_RATE_LIMIT_MAX: max },
      db,
      hasher: await createPasswordHasher(config),
    });
  }

  it('cuts off repeated failed logins from one address', async () => {
    const limited = await throttledApp(3);
    const email = freshEmail();

    const codes: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(limited)
        .post('/api/auth/login')
        .send({ email, password: 'wrong password guess' });
      codes.push(response.status);
    }

    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes.slice(3)).toEqual([429, 429]);
  });

  it('uses the documented error envelope when it refuses', async () => {
    const limited = await throttledApp(1);
    await request(limited).post('/api/auth/login').send({ email: freshEmail(), password: 'nope' });

    const blocked = await request(limited)
      .post('/api/auth/login')
      .send({ email: freshEmail(), password: 'nope' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  // The limit exists to stop guessing, not to lock out a shared office where
  // several people legitimately sign in.
  it('does not spend the budget on successful logins', async () => {
    const limited = await throttledApp(2);
    const email = freshEmail();
    await request(limited).post('/api/auth/register').send({ email, password: PASSWORD }).expect(202);

    for (let i = 0; i < 4; i += 1) {
      await request(limited).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    }
  });

  // Throttling makes the residual registration signal impractical to mine.
  it('throttles bulk probing of the registration route', async () => {
    const limited = await throttledApp(2);

    await request(limited).post('/api/auth/register').send({ email: freshEmail(), password: PASSWORD });
    await request(limited).post('/api/auth/register').send({ email: freshEmail(), password: PASSWORD });
    const third = await request(limited)
      .post('/api/auth/register')
      .send({ email: freshEmail(), password: PASSWORD });

    expect(third.status).toBe(429);
  });
});

// -------------------------------------------------------------------- audit

describe('audit trail', () => {
  it('records register, login and logout against the user', async () => {
    const { cookies, csrf, email } = await signIn();
    await request(app).post('/api/auth/logout').set('Cookie', cookies).set(CSRF_HEADER, csrf).expect(204);

    const { rows } = await db.query<{ action: string }>(
      `SELECT a.action FROM audit_log a
       JOIN users u ON u.id = a.actor_id
       WHERE u.email = $1
       ORDER BY a.created_at`,
      [email],
    );
    const actions = rows.map((r) => r.action);

    expect(actions).toContain('auth.register.succeeded');
    expect(actions).toContain('auth.login.succeeded');
    expect(actions).toContain('auth.logout');
  });

  it('records a duplicate registration even though the caller is not told', async () => {
    const email = freshEmail();
    await request(app).post('/api/auth/register').send({ email, password: PASSWORD }).expect(202);

    const before = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log WHERE action = 'auth.register.duplicate'`,
    );
    await request(app).post('/api/auth/register').send({ email, password: PASSWORD }).expect(202);
    const after = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log WHERE action = 'auth.register.duplicate'`,
    );

    expect(Number(after.rows[0]!.n)).toBe(Number(before.rows[0]!.n) + 1);
  });

  it('never writes a password or a session token into the audit detail', async () => {
    const { cookies, csrf, email, sessionToken } = await signIn();
    await request(app).post('/api/auth/logout').set('Cookie', cookies).set(CSRF_HEADER, csrf).expect(204);

    const { rows } = await db.query<{ detail: unknown }>(
      `SELECT a.detail FROM audit_log a
       JOIN users u ON u.id = a.actor_id
       WHERE u.email = $1`,
      [email],
    );

    const dumped = JSON.stringify(rows);
    expect(dumped).not.toContain(PASSWORD);
    expect(dumped).not.toContain(sessionToken);
  });
});
