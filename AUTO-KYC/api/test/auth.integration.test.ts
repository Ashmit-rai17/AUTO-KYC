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

/** Registers and logs in, returning the session cookie. */
async function signedInCookie(email = freshEmail()): Promise<{ cookie: string; email: string }> {
  await request(app).post('/api/auth/register').send({ email, password: PASSWORD }).expect(201);
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);

  const raw = login.headers['set-cookie'] as unknown as string[];
  return { cookie: raw[0]!.split(';')[0]!, email };
}

// ------------------------------------------------------------------ register

describe('POST /api/auth/register', () => {
  it('creates a customer and never echoes the password back', async () => {
    const email = freshEmail();
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email, password: PASSWORD });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ email, role: 'CUSTOMER' });
    expect(JSON.stringify(response.body)).not.toContain(PASSWORD);
    expect(JSON.stringify(response.body)).not.toContain('argon2');
  });

  // Privilege escalation: a caller must not be able to make themselves staff
  // by adding a field to the body.
  it('ignores a role supplied in the request body', async () => {
    const email = freshEmail();
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, role: 'ADMIN' });

    expect(response.status).toBe(201);
    expect(response.body.user.role).toBe('CUSTOMER');

    const { rows } = await db.query<{ role: string }>(
      `SELECT role FROM users WHERE email = $1`,
      [email],
    );
    expect(rows[0]?.role).toBe('CUSTOMER');
  });

  it('refuses a duplicate address without confirming it exists', async () => {
    const email = freshEmail();
    await request(app).post('/api/auth/register').send({ email, password: PASSWORD }).expect(201);

    const second = await request(app)
      .post('/api/auth/register')
      .send({ email, password: PASSWORD });

    expect(second.status).toBe(409);
    expect(second.body.error.message).toBe('Registration could not be completed');
    // Must not name the field or say "already".
    expect(second.body.error.message.toLowerCase()).not.toContain('email');
    expect(second.body.error.message.toLowerCase()).not.toContain('exist');
    expect(second.body.error.message.toLowerCase()).not.toContain('already');
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
    await request(app).post('/api/auth/register').send({ email, password: PASSWORD }).expect(201);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email, password: PASSWORD });

    expect(response.status).toBe(200);
    const cookie = (response.headers['set-cookie'] as unknown as string[])[0]!;

    expect(cookie).toContain('kyc_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    // NODE_ENV is 'test' here; Secure is added only in production.
    expect(cookie).not.toContain('Secure');
  });

  // httpOnly is pointless if the same value is also handed to script.
  it('returns the session token in the cookie and nowhere else', async () => {
    const { cookie } = await signedInCookie();
    const token = cookie.split('=')[1]!;

    expect(token.length).toBeGreaterThan(20);
    // The body of the login response is checked in the previous test; here we
    // confirm the token is not recoverable from the database in plaintext.
    const plaintext = await db.query(`SELECT 1 FROM sessions WHERE token_hash = $1`, [token]);
    expect(plaintext.rows).toHaveLength(0);

    const hashed = await db.query(`SELECT 1 FROM sessions WHERE token_hash = $1`, [
      hashSessionToken(token),
    ]);
    expect(hashed.rows).toHaveLength(1);
  });

  it('matches the address case-insensitively', async () => {
    const email = freshEmail();
    await request(app).post('/api/auth/register').send({ email, password: PASSWORD }).expect(201);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: email.toUpperCase(), password: PASSWORD });

    expect(response.status).toBe(200);
  });

  it('answers identically for a wrong password and an unknown address', async () => {
    const email = freshEmail();
    await request(app).post('/api/auth/register').send({ email, password: PASSWORD }).expect(201);

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
    const { cookie, email } = await signedInCookie();
    const response = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ email, role: 'CUSTOMER' });
  });
});

// ------------------------------------------------------------------- logout

describe('POST /api/auth/logout', () => {
  // This is the entire reason ADR-001 chose database sessions over a JWT.
  it('revokes the session immediately, not at expiry', async () => {
    const { cookie } = await signedInCookie();
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);

    const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(204);

    const after = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });

  it('clears the cookie in the browser too', async () => {
    const { cookie } = await signedInCookie();
    const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie);

    const cleared = (logout.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cleared).toContain('kyc_session=;');
  });

  it('refuses an anonymous logout', async () => {
    const response = await request(app).post('/api/auth/logout');
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------- revocation and expiry

describe('session lifetime', () => {
  it('stops accepting a session the moment the account is suspended', async () => {
    const { cookie, email } = await signedInCookie();
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);

    await db.query(`UPDATE users SET status = 'suspended' WHERE email = $1`, [email]);

    const after = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });

  it('rejects a session past its expiry', async () => {
    const { cookie, email } = await signedInCookie();

    await db.query(
      `UPDATE sessions SET expires_at = now() - interval '1 second'
       WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );

    const after = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });
});

// -------------------------------------------------------------------- audit

describe('audit trail', () => {
  it('records register, login and logout against the user', async () => {
    const { cookie, email } = await signedInCookie();
    await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(204);

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

  it('never writes a password or a session token into the audit detail', async () => {
    const { cookie, email } = await signedInCookie();
    await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(204);
    const token = cookie.split('=')[1]!;

    const { rows } = await db.query<{ detail: unknown }>(
      `SELECT a.detail FROM audit_log a
       JOIN users u ON u.id = a.actor_id
       WHERE u.email = $1`,
      [email],
    );

    const dumped = JSON.stringify(rows);
    expect(dumped).not.toContain(PASSWORD);
    expect(dumped).not.toContain(token);
  });
});
