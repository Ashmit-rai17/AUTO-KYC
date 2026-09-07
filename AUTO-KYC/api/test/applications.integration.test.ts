/**
 * Applications over real HTTP against a real PostgreSQL.
 *
 * The point of this slice is ownership — step 3 of the security checklist — so
 * most of what follows is about what one customer can learn or change about
 * another's application. That needs two real customers, not a mock.
 *
 * Run with `npm run test:integration`.
 */

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { createDb, type Db } from '../src/db/pool.js';
import { CSRF_HEADER } from '../src/http/csrf.js';
import { createPasswordHasher, type PasswordHasher } from '../src/modules/auth/password.js';
import { testConfig } from './helpers.js';

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Run `npm run db:up && npm run db:migrate` first.');
}

const config: Config = { ...testConfig, DATABASE_URL };
const PASSWORD = 'a sufficiently long password';

const COMPLETE_DETAILS = {
  fullName: 'Priya Nair',
  dateOfBirth: '1994-03-14',
  pan: 'ABCDE1234F',
  address: {
    line1: '42 MG Road',
    city: 'Kochi',
    state: 'Kerala',
    postalCode: '682020',
  },
};

let db: Db;
let hasher: PasswordHasher;
let app: ReturnType<typeof createApp>;

const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let created = 0;
function freshEmail(prefix = 'app'): string {
  created += 1;
  return `itest-${run}-${prefix}${created}@example.com`;
}

interface Actor {
  cookies: string;
  csrf: string;
  email: string;
}

beforeAll(async () => {
  db = createDb(config);
  hasher = await createPasswordHasher(config);
  app = createApp({ config, db, hasher });
});

afterAll(async () => {
  if (db) {
    /**
     * These users are deliberately NOT deleted, and the reason is worth
     * knowing rather than working around.
     *
     * consents.user_id is ON DELETE RESTRICT and consents is append-only, so a
     * customer who has ever consented cannot be removed: the delete is refused
     * by the foreign key, and the consent row cannot be cleared out of the way
     * either. That is the design doing exactly what ADR-003 asked of it —
     * consent is evidence and must outlive convenience.
     *
     * The consequence is a real one for the bank conversation, not just for
     * tests: this schema cannot honour an erasure request for a customer who
     * consented. KYC records carry statutory retention anyway, so that is
     * defensible — but it should be a decision someone made, not a surprise.
     * Flagged in the milestone notes.
     *
     * Applications are removed since they cascade cleanly, and each run uses
     * unique addresses so nothing collides.
     */
    await db.query(
      `DELETE FROM applications
       WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`itest-${run}-%`],
    );
    await db.close();
  }
});

function cookiePairs(response: request.Response): string[] {
  const raw = (response.headers['set-cookie'] ?? []) as unknown as string[];
  return raw.map((entry) => entry.split(';')[0]!);
}

async function signIn(email: string): Promise<Actor> {
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const pairs = cookiePairs(login);
  return {
    cookies: pairs.join('; '),
    csrf: pairs.find((p) => p.startsWith('kyc_csrf='))!.split('=')[1]!,
    email,
  };
}

async function customer(): Promise<Actor> {
  const email = freshEmail('cust');
  await request(app).post('/api/auth/register').send({ email, password: PASSWORD }).expect(202);
  return signIn(email);
}

/** No admin route exists yet, so staff are seeded directly. */
async function employee(): Promise<Actor> {
  const email = freshEmail('staff');
  await db.query(`INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'EMPLOYEE')`, [
    email,
    await hasher.hash(PASSWORD),
  ]);
  return signIn(email);
}

function as(actor: Actor) {
  return {
    get: (path: string) => request(app).get(path).set('Cookie', actor.cookies),
    post: (path: string) =>
      request(app).post(path).set('Cookie', actor.cookies).set(CSRF_HEADER, actor.csrf),
    patch: (path: string) =>
      request(app).patch(path).set('Cookie', actor.cookies).set(CSRF_HEADER, actor.csrf),
  };
}

async function draftFor(actor: Actor): Promise<string> {
  const created = await as(actor).post('/api/applications').expect(201);
  return created.body.application.id as string;
}

/** A draft that is complete and consented, i.e. ready to submit. */
async function readyToSubmit(actor: Actor): Promise<string> {
  const id = await draftFor(actor);
  await as(actor).patch(`/api/applications/${id}`).send({ personalData: COMPLETE_DETAILS }).expect(200);
  await as(actor).post(`/api/applications/${id}/consent`).expect(201);
  return id;
}

// ------------------------------------------------------------------- create

describe('POST /api/applications', () => {
  it('creates an empty draft', async () => {
    const alice = await customer();
    const response = await as(alice).post('/api/applications');

    expect(response.status).toBe(201);
    expect(response.body.application).toMatchObject({
      status: 'draft',
      personalData: {},
      consentRecorded: false,
      submittedAt: null,
    });
  });

  it('never exposes the consent row id, only whether consent exists', async () => {
    const alice = await customer();
    const response = await as(alice).post('/api/applications').expect(201);

    expect(response.body.application).not.toHaveProperty('consentId');
    expect(response.body.application).not.toHaveProperty('consent_id');
    expect(response.body.application).not.toHaveProperty('userId');
  });

  it('refuses a second application while one is still in flight', async () => {
    const alice = await customer();
    await as(alice).post('/api/applications').expect(201);

    const second = await as(alice).post('/api/applications');
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('APPLICATION_IN_PROGRESS');
  });

  it('refuses an employee', async () => {
    const staff = await employee();
    const response = await as(staff).post('/api/applications');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses an anonymous caller', async () => {
    const response = await request(app).post('/api/applications');
    expect(response.status).toBe(401);
  });

  it('refuses a state change with no CSRF token', async () => {
    const alice = await customer();
    const response = await request(app).post('/api/applications').set('Cookie', alice.cookies);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_FAILED');
  });
});

// ------------------------------------------------------------ ownership

describe('ownership', () => {
  /**
   * The headline behaviour of this slice. Bob asking for Alice's application
   * must be indistinguishable from Bob asking for one that does not exist —
   * a 403 would confirm it is real and belongs to someone.
   */
  it('answers 404, not 403, for another customer\'s application', async () => {
    const alice = await customer();
    const bob = await customer();
    const aliceApp = await draftFor(alice);

    const seen = await as(bob).get(`/api/applications/${aliceApp}`);
    expect(seen.status).toBe(404);
    expect(seen.body.error.code).toBe('NOT_FOUND');
  });

  it('answers identically for a stranger\'s application and an absent one', async () => {
    const alice = await customer();
    const bob = await customer();
    const aliceApp = await draftFor(alice);

    const stranger = await as(bob).get(`/api/applications/${aliceApp}`);
    const absent = await as(bob).get('/api/applications/00000000-0000-4000-8000-000000000000');

    expect(stranger.status).toBe(absent.status);
    expect(stranger.body).toEqual(absent.body);
  });

  // A uuid column raises a syntax error on unparseable input, which without
  // this check would surface as a 500 and distinguish "not an id" from "not
  // yours".
  it('answers 404 for a malformed id rather than failing', async () => {
    const alice = await customer();
    const response = await as(alice).get('/api/applications/banana');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('will not let one customer edit another\'s application', async () => {
    const alice = await customer();
    const bob = await customer();
    const aliceApp = await draftFor(alice);

    const attempt = await as(bob)
      .patch(`/api/applications/${aliceApp}`)
      .send({ personalData: { fullName: 'Bob Was Here' } });
    expect(attempt.status).toBe(404);

    // And nothing changed.
    const stillAlices = await as(alice).get(`/api/applications/${aliceApp}`).expect(200);
    expect(stillAlices.body.application.personalData).toEqual({});
  });

  it('will not let one customer submit another\'s application', async () => {
    const alice = await customer();
    const bob = await customer();
    const aliceApp = await readyToSubmit(alice);

    const attempt = await as(bob).post(`/api/applications/${aliceApp}/submit`);
    expect(attempt.status).toBe(404);

    const stillDraft = await as(alice).get(`/api/applications/${aliceApp}`).expect(200);
    expect(stillDraft.body.application.status).toBe('draft');
  });

  it('lists only the caller\'s own applications', async () => {
    const alice = await customer();
    const bob = await customer();
    const aliceApp = await draftFor(alice);
    const bobApp = await draftFor(bob);

    const mine = await as(bob).get('/api/applications/me').expect(200);
    const ids = mine.body.applications.map((a: { id: string }) => a.id);

    expect(ids).toContain(bobApp);
    expect(ids).not.toContain(aliceApp);
  });
});

// -------------------------------------------------------------------- patch

describe('PATCH /api/applications/:id', () => {
  it('merges a partial update instead of replacing everything', async () => {
    const alice = await customer();
    const id = await draftFor(alice);

    await as(alice)
      .patch(`/api/applications/${id}`)
      .send({ personalData: { fullName: 'Priya Nair' } })
      .expect(200);
    const after = await as(alice)
      .patch(`/api/applications/${id}`)
      .send({ personalData: { pan: 'ABCDE1234F' } })
      .expect(200);

    // The name survived the second write. Without merge semantics a
    // save-as-you-go form would silently discard earlier answers.
    expect(after.body.application.personalData).toEqual({
      fullName: 'Priya Nair',
      pan: 'ABCDE1234F',
    });
  });

  it('ignores a status supplied in the body', async () => {
    const alice = await customer();
    const id = await draftFor(alice);

    const response = await as(alice)
      .patch(`/api/applications/${id}`)
      .send({ status: 'verified', personalData: { fullName: 'Priya Nair' } })
      .expect(200);

    expect(response.body.application.status).toBe('draft');

    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM applications WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.status).toBe('draft');
  });

  it('will not smuggle a status through personalData either', async () => {
    const alice = await customer();
    const id = await draftFor(alice);

    const response = await as(alice)
      .patch(`/api/applications/${id}`)
      .send({ personalData: { fullName: 'Priya Nair', status: 'verified' } })
      .expect(200);

    expect(response.body.application.personalData).toEqual({ fullName: 'Priya Nair' });
    expect(response.body.application.status).toBe('draft');
  });

  it('rejects a malformed field that is present', async () => {
    const alice = await customer();
    const id = await draftFor(alice);

    const response = await as(alice)
      .patch(`/api/applications/${id}`)
      .send({ personalData: { pan: 'not-a-pan' } });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('pan');
  });

  it('refuses to change an application once submitted', async () => {
    const alice = await customer();
    const id = await readyToSubmit(alice);
    await as(alice).post(`/api/applications/${id}/submit`).expect(200);

    const response = await as(alice)
      .patch(`/api/applications/${id}`)
      .send({ personalData: { fullName: 'Changed My Mind' } });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('NOT_EDITABLE');
  });
});

// ------------------------------------------------------------------ consent

describe('POST /api/applications/:id/consent', () => {
  it('records consent with its version and metadata', async () => {
    const alice = await customer();
    const id = await draftFor(alice);

    const response = await as(alice).post(`/api/applications/${id}/consent`);
    expect(response.status).toBe(201);
    expect(response.body.application.consentRecorded).toBe(true);

    const { rows } = await db.query<{
      version: string;
      ip_address: string | null;
      user_agent: string | null;
      accepted_at: Date;
    }>(
      `SELECT c.version, c.ip_address::text, c.user_agent, c.accepted_at
       FROM consents c
       JOIN applications a ON a.consent_id = c.id
       WHERE a.id = $1`,
      [id],
    );

    // The PRD requires consent be explicit and recorded with timestamp and
    // metadata. An unversioned consent is not evidence of what was agreed.
    expect(rows[0]?.version).toBe('test-consent-v1');
    expect(rows[0]?.ip_address).toBeTruthy();
    expect(rows[0]?.accepted_at).toBeInstanceOf(Date);
  });

  it('keeps the earlier record when consent is given again', async () => {
    const alice = await customer();
    const id = await draftFor(alice);

    await as(alice).post(`/api/applications/${id}/consent`).expect(201);
    const first = await db.query<{ id: string }>(
      `SELECT consent_id AS id FROM applications WHERE id = $1`,
      [id],
    );

    await as(alice).post(`/api/applications/${id}/consent`).expect(201);
    const second = await db.query<{ id: string }>(
      `SELECT consent_id AS id FROM applications WHERE id = $1`,
      [id],
    );

    expect(second.rows[0]?.id).not.toBe(first.rows[0]?.id);

    // consents is append-only, so the superseded record must still exist.
    const both = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM consents WHERE id IN ($1, $2)`,
      [first.rows[0]!.id, second.rows[0]!.id],
    );
    expect(Number(both.rows[0]!.n)).toBe(2);
  });

  it('refuses consent on an application that is no longer a draft', async () => {
    const alice = await customer();
    const id = await readyToSubmit(alice);
    await as(alice).post(`/api/applications/${id}/submit`).expect(200);

    const response = await as(alice).post(`/api/applications/${id}/consent`);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('NOT_EDITABLE');
  });
});

// ------------------------------------------------------------------- submit

describe('POST /api/applications/:id/submit', () => {
  it('refuses an incomplete application and names what is missing', async () => {
    const alice = await customer();
    const id = await draftFor(alice);
    await as(alice)
      .patch(`/api/applications/${id}`)
      .send({ personalData: { fullName: 'Priya Nair' } })
      .expect(200);
    await as(alice).post(`/api/applications/${id}/consent`).expect(201);

    const response = await as(alice).post(`/api/applications/${id}/submit`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INCOMPLETE');
    expect(response.body.error.message).toContain('dateOfBirth');
    expect(response.body.error.message).toContain('pan');
  });

  it('refuses a complete application with no consent', async () => {
    const alice = await customer();
    const id = await draftFor(alice);
    await as(alice)
      .patch(`/api/applications/${id}`)
      .send({ personalData: COMPLETE_DETAILS })
      .expect(200);

    const response = await as(alice).post(`/api/applications/${id}/submit`);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('submits a complete, consented application', async () => {
    const alice = await customer();
    const id = await readyToSubmit(alice);

    const response = await as(alice).post(`/api/applications/${id}/submit`);
    expect(response.status).toBe(200);
    expect(response.body.application.status).toBe('submitted');
    expect(response.body.application.submittedAt).toBeTruthy();
  });

  it('refuses a second submission', async () => {
    const alice = await customer();
    const id = await readyToSubmit(alice);
    await as(alice).post(`/api/applications/${id}/submit`).expect(200);

    const again = await as(alice).post(`/api/applications/${id}/submit`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NOT_EDITABLE');
  });

  it('frees the customer to apply again once an application is rejected', async () => {
    const alice = await customer();
    const id = await readyToSubmit(alice);
    await as(alice).post(`/api/applications/${id}/submit`).expect(200);

    // Blocked while in flight...
    await as(alice).post('/api/applications').expect(409);

    // ...and allowed once it reaches a terminal state.
    await db.query(`UPDATE applications SET status = 'rejected' WHERE id = $1`, [id]);
    await as(alice).post('/api/applications').expect(201);
  });
});

// -------------------------------------------------------------------- audit

describe('audit trail', () => {
  it('records every state change against the customer', async () => {
    const alice = await customer();
    const id = await readyToSubmit(alice);
    await as(alice).post(`/api/applications/${id}/submit`).expect(200);

    const { rows } = await db.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY created_at`,
      [id],
    );
    const actions = rows.map((r) => r.action);

    expect(actions).toContain('application.created');
    expect(actions).toContain('application.updated');
    expect(actions).toContain('application.consent.recorded');
    expect(actions).toContain('application.submitted');
  });

  /**
   * Audit rows can never be edited or deleted, so anything written into them
   * is written forever. An edit log that copied the customer's name, date of
   * birth and PAN on every keystroke would be a second, permanent, unredactable
   * copy of their identity — so only the field NAMES are kept.
   */
  it('records which fields changed but never their values', async () => {
    const alice = await customer();
    const id = await draftFor(alice);
    await as(alice)
      .patch(`/api/applications/${id}`)
      .send({ personalData: COMPLETE_DETAILS })
      .expect(200);

    const { rows } = await db.query<{ detail: { fields?: string[] } }>(
      `SELECT detail FROM audit_log
       WHERE entity_id = $1 AND action = 'application.updated'`,
      [id],
    );

    expect(rows[0]?.detail.fields).toEqual(['address', 'dateOfBirth', 'fullName', 'pan']);

    const dumped = JSON.stringify(rows);
    expect(dumped).not.toContain('Priya Nair');
    expect(dumped).not.toContain('ABCDE1234F');
    expect(dumped).not.toContain('1994-03-14');
  });
});
