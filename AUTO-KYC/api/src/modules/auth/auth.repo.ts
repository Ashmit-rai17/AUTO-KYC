import type { Queryable } from '../../db/pool.js';
import type { AuthContext, Role } from './roles.js';

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  status: 'active' | 'suspended';
}

export interface AuthRepo {
  findUserByEmail(email: string): Promise<UserRecord | undefined>;
  insertUser(input: { email: string; passwordHash: string; role: Role }): Promise<UserRecord>;
  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<{ id: string }>;
  findLiveSession(tokenHash: string): Promise<AuthContext | undefined>;
  revokeSession(sessionId: string): Promise<void>;
}

/** PostgreSQL unique-violation. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export function createAuthRepo(db: Queryable): AuthRepo {
  return {
    async findUserByEmail(email) {
      // Matches the functional unique index on lower(email), so the lookup uses
      // the index rather than scanning.
      const { rows } = await db.query<UserRecord>(
        `SELECT id, email, password_hash, role, status
         FROM users WHERE lower(email) = lower($1)`,
        [email],
      );
      return rows[0];
    },

    async insertUser({ email, passwordHash, role }) {
      const { rows } = await db.query<UserRecord>(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, $3)
         RETURNING id, email, password_hash, role, status`,
        [email, passwordHash, role],
      );
      const created = rows[0];
      if (!created) throw new Error('insertUser returned no row');
      return created;
    },

    async createSession({ userId, tokenHash, expiresAt }) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3) RETURNING id`,
        [userId, tokenHash, expiresAt],
      );
      const created = rows[0];
      if (!created) throw new Error('createSession returned no row');
      return created;
    },

    /**
     * A session is live only if it has not expired, has not been revoked, AND
     * its user is still active. That last condition is what makes suspending an
     * account take effect on the very next request rather than whenever the
     * cookie happens to expire.
     */
    async findLiveSession(tokenHash) {
      const { rows } = await db.query<AuthContext>(
        `SELECT s.id AS "sessionId", u.id AS "userId", u.email, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > now()
           AND u.status = 'active'`,
        [tokenHash],
      );
      return rows[0];
    },

    async revokeSession(sessionId) {
      // Idempotent on purpose: logging out twice is not an error, and the first
      // revocation timestamp is the one worth keeping.
      await db.query(
        `UPDATE sessions SET revoked_at = now()
         WHERE id = $1 AND revoked_at IS NULL`,
        [sessionId],
      );
    },
  };
}
