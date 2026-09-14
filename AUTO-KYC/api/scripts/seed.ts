import '../src/env.js';
import { loadConfig } from '../src/config.js';
import { createDb, type Db } from '../src/db/pool.js';
import { writeAudit } from '../src/modules/audit/audit.js';
import { createPasswordHasher } from '../src/modules/auth/password.js';
import type { Role } from '../src/modules/auth/roles.js';

/**
 * Development accounts, so the staff side can be opened at all.
 *
 * Registration only ever creates a CUSTOMER — letting a caller choose its own
 * role would be the privilege-escalation hole auth.service.ts guards against —
 * and POST /api/admin/employees is M5. Without this there is no route to an
 * EMPLOYEE or ADMIN account, so a clone of this repository can sign in to the
 * customer app and simply cannot reach the review queue. That is a bad first
 * five minutes for a colleague and a worse one in front of a bank.
 *
 * These are FIXED, PUBLISHED credentials. That is the point for local work and
 * unacceptable anywhere else, which is why this refuses to run against
 * NODE_ENV=production below. The refusal is the feature; do not add a flag to
 * bypass it.
 */
const PASSWORD = process.env['SEED_PASSWORD'] ?? 'kycflow-demo-2026';

const ACCOUNTS: Array<{ email: string; role: Role; purpose: string }> = [
  { email: 'admin@kycflow.test', role: 'ADMIN', purpose: 'configuration, staff management (M5)' },
  { email: 'reviewer@kycflow.test', role: 'EMPLOYEE', purpose: 'the review queue' },
  { email: 'customer@kycflow.test', role: 'CUSTOMER', purpose: 'the application form' },
];

const config = loadConfig();

if (config.NODE_ENV === 'production') {
  console.error(
    'Refusing to seed: NODE_ENV is production.\n' +
      'This script creates accounts with a known, published password. Running it\n' +
      'against a production database would install a backdoor, not test data.',
  );
  process.exit(1);
}

if (PASSWORD.length < 12) {
  console.error('Refusing to seed: SEED_PASSWORD must be at least 12 characters (the API enforces this).');
  process.exit(1);
}

const db: Db = createDb(config);
const hasher = await createPasswordHasher(config);

try {
  const digest = await hasher.hash(PASSWORD);

  for (const account of ACCOUNTS) {
    const existing = await db.query<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [
      account.email,
    ]);

    if (existing.rows[0]) {
      // Reset rather than skip: a seeded environment should be in a known
      // state after every run, including its passwords.
      await db.query('UPDATE users SET password_hash = $1, role = $2, status = $3 WHERE id = $4', [
        digest,
        account.role,
        'active',
        existing.rows[0].id,
      ]);
      await writeAudit(db, {
        actorType: 'system',
        action: 'seed.account.reset',
        entityType: 'user',
        entityId: existing.rows[0].id,
        detail: { email: account.email, role: account.role },
      });
      console.info(`  reset   ${account.role.padEnd(8)} ${account.email}`);
      continue;
    }

    const created = await db.query<{ id: string }>(
      'INSERT INTO users (email, password_hash, role, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.email, digest, account.role, 'active'],
    );
    await writeAudit(db, {
      actorType: 'system',
      action: 'seed.account.created',
      entityType: 'user',
      entityId: created.rows[0]!.id,
      detail: { email: account.email, role: account.role },
    });
    console.info(`  created ${account.role.padEnd(8)} ${account.email}`);
  }

  console.info(`\nPassword for all three: ${PASSWORD}`);
  console.info('Customer app  http://localhost:3000');
  console.info('Staff queue   http://localhost:3001');
  console.info(
    '\nCookies ignore the port, so one browser profile holds ONE session across\nboth. Use a second profile to see customer and staff side by side.',
  );
} finally {
  await db.close();
}
