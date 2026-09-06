/**
 * Schema guarantees, asserted against a real PostgreSQL.
 *
 * These are not unit tests: every claim here is a claim about what the
 * DATABASE will refuse, and the only way to prove it is to ask the database.
 * Run with `npm run test:integration` after `npm run db:up && npm run db:migrate`.
 *
 * The whole file runs inside one transaction that is rolled back at the end,
 * so it leaves nothing behind — including in the append-only tables, which
 * cannot be cleaned up any other way.
 */

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for integration tests. Run `npm run db:up` and set it, ' +
      'or copy .env.example to .env.',
  );
}

let client: pg.Client;

/** A user and a draft application to hang the other assertions on. */
let userId: string;
let applicationId: string;

beforeAll(async () => {
  client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');

  const user = await client.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, 'not-a-real-hash', 'CUSTOMER') RETURNING id`,
    [`itest-${Date.now()}@example.com`],
  );
  userId = user.rows[0]!.id;

  const application = await client.query<{ id: string }>(
    `INSERT INTO applications (user_id) VALUES ($1) RETURNING id`,
    [userId],
  );
  applicationId = application.rows[0]!.id;

  // Seed one row into each append-only table. UPDATE and DELETE against an
  // EMPTY table match no rows, so a row-level trigger never fires and the
  // statement succeeds — which would make the append-only assertions below
  // pass for entirely the wrong reason.
  await client.query(
    `INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id)
     VALUES ('system', NULL, 'schema.test.seed', 'application', $1)`,
    [applicationId],
  );
  await client.query(
    `INSERT INTO consents (user_id, version) VALUES ($1, 'seed-v1')`,
    [userId],
  );

  // case_events needs a case, and the case needs its own application so that
  // the one-case-per-application test below still has a free one to use.
  const seedApplication = await client.query<{ id: string }>(
    `INSERT INTO applications (user_id) VALUES ($1) RETURNING id`,
    [userId],
  );
  const seedCase = await client.query<{ id: string }>(
    `INSERT INTO review_cases (application_id, reason_summary)
     VALUES ($1, 'seed case') RETURNING id`,
    [seedApplication.rows[0]!.id],
  );
  await client.query(
    `INSERT INTO case_events (case_id, type, actor_id, message)
     VALUES ($1, 'note', $2, 'seed event')`,
    [seedCase.rows[0]!.id, userId],
  );
});

afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    await client.end();
  }
});

/**
 * Runs a statement expected to fail, then rewinds to the savepoint so the
 * aborted transaction does not poison the tests that follow.
 */
async function expectRejected(sql: string, match: RegExp): Promise<void> {
  await client.query('SAVEPOINT sp');
  try {
    await expect(client.query(sql)).rejects.toThrow(match);
  } finally {
    // Unwind even when the assertion itself fails, otherwise one bad
    // expectation aborts the transaction and every later test reports the
    // useless "current transaction is aborted" instead of its own result.
    await client.query('ROLLBACK TO SAVEPOINT sp');
  }
}

describe.each([
  { table: 'audit_log', truncate: /append-only.*TRUNCATE/i },
  { table: 'case_events', truncate: /append-only.*TRUNCATE/i },
  // consents is referenced by applications.consent_id, and PostgreSQL raises
  // the foreign-key objection BEFORE any BEFORE TRUNCATE trigger gets to run.
  // The table is still protected, just by two mechanisms instead of one, so
  // either refusal is a pass.
  {
    table: 'consents',
    truncate: /append-only.*TRUNCATE|cannot truncate a table referenced/i,
  },
])('$table is append-only', ({ table, truncate }) => {
  it('rejects UPDATE', async () => {
    await expectRejected(`UPDATE ${table} SET id = id`, /append-only.*UPDATE/i);
  });

  it('rejects DELETE', async () => {
    await expectRejected(`DELETE FROM ${table}`, /append-only.*DELETE/i);
  });

  // A row-level trigger never sees TRUNCATE. Without the separate statement
  // trigger this is the one command that would quietly erase the audit trail.
  it('rejects TRUNCATE', async () => {
    await expectRejected(`TRUNCATE ${table}`, truncate);
  });
});

describe('audit_log', () => {
  it('accepts an INSERT and keeps the row', async () => {
    await client.query(
      `INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id)
       VALUES ('customer', $1, 'application.created', 'application', $2)`,
      [userId, applicationId],
    );

    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log
       WHERE entity_id = $1 AND action = 'application.created'`,
      [applicationId],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it('rejects an actor_type outside the documented set', async () => {
    await expectRejected(
      `INSERT INTO audit_log (actor_type, action, entity_type)
       VALUES ('robot', 'x', 'y')`,
      /actor_type/i,
    );
  });
});

describe('users', () => {
  it('treats addresses differing only in case as the same person', async () => {
    const email = `Case-${Date.now()}@Example.com`;
    await client.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, 'h', 'CUSTOMER')`,
      [email],
    );

    await client.query('SAVEPOINT sp');
    await expect(
      client.query(
        `INSERT INTO users (email, password_hash, role) VALUES ($1, 'h', 'CUSTOMER')`,
        [email.toLowerCase()],
      ),
    ).rejects.toThrow(/users_email_lower_key/);
    await client.query('ROLLBACK TO SAVEPOINT sp');
  });

  it('rejects a role outside the documented set', async () => {
    await expectRejected(
      `INSERT INTO users (email, password_hash, role)
       VALUES ('nope@example.com', 'h', 'SUPERUSER')`,
      /role/i,
    );
  });
});

describe('applications', () => {
  it('allows a draft with no consent', async () => {
    const { rows } = await client.query<{ status: string; consent_id: string | null }>(
      `INSERT INTO applications (user_id) VALUES ($1) RETURNING status, consent_id`,
      [userId],
    );
    expect(rows[0]!.status).toBe('draft');
    expect(rows[0]!.consent_id).toBeNull();
  });

  // docs/endpoint-contract.md gates submit on consent. This proves no code
  // path — not even a raw INSERT — can get around it.
  it('refuses to be submitted without a consent record', async () => {
    await client.query('SAVEPOINT sp');
    await expect(
      client.query(
        `INSERT INTO applications (user_id, status, submitted_at)
         VALUES ($1, 'submitted', now())`,
        [userId],
      ),
    ).rejects.toThrow(/applications_submitted_needs_consent/);
    await client.query('ROLLBACK TO SAVEPOINT sp');
  });

  it('accepts a submission that does carry consent', async () => {
    const consent = await client.query<{ id: string }>(
      `INSERT INTO consents (user_id, version) VALUES ($1, 'v1') RETURNING id`,
      [userId],
    );

    const { rows } = await client.query<{ status: string }>(
      `INSERT INTO applications (user_id, status, consent_id, submitted_at)
       VALUES ($1, 'submitted', $2, now()) RETURNING status`,
      [userId, consent.rows[0]!.id],
    );
    expect(rows[0]!.status).toBe('submitted');
  });

  // Note on why this is not "assert updated_at increased": PostgreSQL's now()
  // is the TRANSACTION timestamp, and this whole file runs in one transaction,
  // so it never advances here. In production each request is its own
  // transaction and it does. What can be proved either way is that the trigger
  // fires and overrides whatever the caller supplied.
  it('overrides a caller-supplied updated_at on UPDATE', async () => {
    const stale = '2000-01-01T00:00:00Z';

    await client.query(
      `UPDATE applications SET personal_data = '{"name":"Priya Nair"}'::jsonb,
                               updated_at = $2
       WHERE id = $1`,
      [applicationId, stale],
    );

    const { rows } = await client.query<{ updated_at: Date }>(
      `SELECT updated_at FROM applications WHERE id = $1`,
      [applicationId],
    );

    expect(rows[0]!.updated_at.getTime()).not.toBe(new Date(stale).getTime());
    expect(rows[0]!.updated_at.getFullYear()).toBeGreaterThan(2000);
  });
});

describe('verification_checks', () => {
  it('records every result state the rules engine can emit', async () => {
    const runId = '22222222-2222-2222-2222-222222222222';
    for (const [checkType, result] of [
      ['pan', 'pass'],
      ['name_match', 'review'],
      ['dob_match', 'fail'],
      ['address_match', 'not_available'],
    ] as const) {
      await client.query(
        `INSERT INTO verification_checks (application_id, run_id, check_type, result, reason)
         VALUES ($1, $2, $3, $4, 'because the test said so')`,
        [applicationId, runId, checkType, result],
      );
    }

    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM verification_checks WHERE run_id = $1`,
      [runId],
    );
    expect(Number(rows[0]!.n)).toBe(4);
  });

  // Idempotent runs: replaying a run_id must not double-write its checks.
  it('refuses a second row for the same run and check', async () => {
    const runId = '33333333-3333-3333-3333-333333333333';
    await client.query(
      `INSERT INTO verification_checks (application_id, run_id, check_type, result, reason)
       VALUES ($1, $2, 'pan', 'pass', 'first')`,
      [applicationId, runId],
    );

    await client.query('SAVEPOINT sp');
    await expect(
      client.query(
        `INSERT INTO verification_checks (application_id, run_id, check_type, result, reason)
         VALUES ($1, $2, 'pan', 'fail', 'replayed')`,
        [applicationId, runId],
      ),
    ).rejects.toThrow(/verification_checks_run_check_key/);
    await client.query('ROLLBACK TO SAVEPOINT sp');
  });

  it('rejects a result outside PASS/REVIEW/FAIL/NOT_AVAILABLE', async () => {
    await expectRejected(
      `INSERT INTO verification_checks (application_id, run_id, check_type, result, reason)
       VALUES ('${applicationId}', gen_random_uuid(), 'pan', 'maybe', 'nonsense')`,
      /result/i,
    );
  });

  // Invariant 5: every check carries a human-readable reason.
  it('refuses a check with no reason', async () => {
    await expectRejected(
      `INSERT INTO verification_checks (application_id, run_id, check_type, result)
       VALUES ('${applicationId}', gen_random_uuid(), 'pan', 'pass')`,
      /reason/i,
    );
  });
});

describe('review_cases', () => {
  it('refuses to be resolved without a resolution timestamp', async () => {
    await expectRejected(
      `INSERT INTO review_cases (application_id, status, reason_summary)
       VALUES ('${applicationId}', 'resolved', 'no timestamp')`,
      /review_cases_resolved_has_timestamp/,
    );
  });

  it('allows at most one case per application', async () => {
    await client.query(
      `INSERT INTO review_cases (application_id, reason_summary)
       VALUES ($1, 'name match needs a human')`,
      [applicationId],
    );

    await client.query('SAVEPOINT sp');
    await expect(
      client.query(
        `INSERT INTO review_cases (application_id, reason_summary)
         VALUES ($1, 'a second case')`,
        [applicationId],
      ),
    ).rejects.toThrow(/review_cases_application_id_key/);
    await client.query('ROLLBACK TO SAVEPOINT sp');
  });
});

describe('documents', () => {
  // Invariant 2: bytes belong in object storage, never in a column.
  it('has no column capable of holding file bytes', async () => {
    const { rows } = await client.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'documents' AND data_type IN ('bytea', 'blob')`,
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects a non-positive file size', async () => {
    await expectRejected(
      `INSERT INTO documents (application_id, type, storage_key, mime, size_bytes)
       VALUES ('${applicationId}', 'pan', 'k/1', 'image/png', 0)`,
      /size_bytes/i,
    );
  });
});
