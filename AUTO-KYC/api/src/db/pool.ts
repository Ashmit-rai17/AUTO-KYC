import pg from 'pg';
import type { Config } from '../config.js';

export interface QueryResult {
  rows: unknown[];
}

/**
 * The narrow slice of PostgreSQL the application actually uses. Modules depend
 * on this, not on `pg`, so routes can be tested without a live database.
 */
export interface Db {
  query(text: string, params?: readonly unknown[]): Promise<QueryResult>;
  close(): Promise<void>;
}

export function createDb(config: Config): Db {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    // Fail a dead connection fast; readiness checks should not hang.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });

  return {
    async query(text, params) {
      const result = await pool.query(text, params ? [...params] : undefined);
      return { rows: result.rows };
    },
    close() {
      return pool.end();
    },
  };
}
