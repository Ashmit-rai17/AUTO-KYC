import pg from 'pg';
import type { Config } from '../config.js';

export interface QueryResult<T = unknown> {
  rows: T[];
}

/**
 * The narrow slice of PostgreSQL the application actually uses. Modules depend
 * on this, not on `pg`, so routes can be tested without a live database.
 */
export interface Db {
  query<T = unknown>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  close(): Promise<void>;
}

/**
 * What most modules actually need. Depending on this rather than on Db keeps
 * them testable with a plain object and makes it obvious that a repository
 * cannot close the pool out from under the application.
 */
export type Queryable = Pick<Db, 'query'>;

export function createDb(config: Config): Db {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    // Fail a dead connection fast; readiness checks should not hang.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });

  return {
    async query<T>(text: string, params?: readonly unknown[]) {
      const result = await pool.query(text, params ? [...params] : undefined);
      return { rows: result.rows as T[] };
    },
    close() {
      return pool.end();
    },
  };
}
