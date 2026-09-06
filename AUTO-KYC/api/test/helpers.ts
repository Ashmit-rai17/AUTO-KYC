import type { Config } from '../src/config.js';
import type { Queryable, QueryResult } from '../src/db/pool.js';
import type { PasswordHasher } from '../src/modules/auth/password.js';

export const testConfig: Config = {
  NODE_ENV: 'test',
  PORT: 4000,
  DATABASE_URL: 'postgres://user:pass@localhost:5432/kycflow',
  SESSION_COOKIE_NAME: 'kyc_session',
  SESSION_TTL_HOURS: 8,
  // Deliberately the OWASP floor rather than the production setting: these
  // tests run the real hasher, and 64 MiB per call would make them crawl.
  ARGON2_MEMORY_KIB: 19456,
  ARGON2_TIME_COST: 2,
  PAN_PROVIDER: 'mock',
  OCR_PROVIDER: 'mock',
  STORAGE_PROVIDER: 'mock',
};

/**
 * Wraps a plain function as a Queryable. Db.query is generic, which a bare
 * arrow function cannot satisfy without this cast.
 */
export function queryable(impl: (text: string, params?: readonly unknown[]) => Promise<{ rows: unknown[] }>): Queryable {
  return {
    query: (<T,>(text: string, params?: readonly unknown[]) =>
      impl(text, params) as Promise<QueryResult<T>>) as Queryable['query'],
  };
}

/** A Queryable that answers every statement with no rows. */
export const emptyDb: Queryable = queryable(() => Promise.resolve({ rows: [] }));

/** A Queryable whose every statement fails, for readiness/outage paths. */
export const brokenDb: Queryable = queryable(() => Promise.reject(new Error('connection refused')));

/**
 * A hasher that does no cryptography. Auth tests that are not ABOUT hashing
 * use this so they run in microseconds instead of tens of milliseconds each.
 */
export function fakeHasher(): PasswordHasher & { spendEqualWorkCalls: number } {
  const state = {
    spendEqualWorkCalls: 0,
    hash: (plain: string) => Promise.resolve(`fake$${plain}`),
    verify: (digest: string, plain: string) => Promise.resolve(digest === `fake$${plain}`),
    spendEqualWork: () => {
      state.spendEqualWorkCalls += 1;
      return Promise.resolve();
    },
  };
  return state;
}
