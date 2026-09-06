import type { Config } from '../../config.js';
import type { Queryable } from '../../db/pool.js';
import { AppError } from '../../http/errors.js';
import { actorTypeForRole, writeAudit } from '../audit/audit.js';
import { createAuthRepo, isUniqueViolation, type AuthRepo } from './auth.repo.js';
import type { PasswordHasher } from './password.js';
import type { AuthContext, Role } from './roles.js';
import { createSessionToken } from './tokens.js';

export interface PublicUser {
  id: string;
  email: string;
  role: Role;
}

export interface AuthService {
  /**
   * Resolves identically whether the address was free or already registered.
   * Returning a user — or throwing — would reveal which, so it returns
   * nothing. See the implementation.
   */
  register(input: { email: string; password: string }): Promise<void>;
  login(input: { email: string; password: string }): Promise<{
    user: PublicUser;
    token: string;
  }>;
  logout(auth: AuthContext): Promise<void>;
}

/**
 * One message for every way a login can fail: wrong password, unknown address,
 * suspended account. Distinguishing them would let anyone test whether a given
 * person banks here, which is exactly the enumeration oracle invariant 9
 * forbids.
 */
function invalidCredentials(): AppError {
  return new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
}

function toPublicUser(user: { id: string; email: string; role: Role }): PublicUser {
  return { id: user.id, email: user.email, role: user.role };
}

/** Addresses are compared and stored lowercased; the schema indexes lower(email). */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createAuthService(deps: {
  db: Queryable;
  config: Config;
  hasher: PasswordHasher;
  repo?: AuthRepo;
}): AuthService {
  const { db, config, hasher } = deps;
  const repo = deps.repo ?? createAuthRepo(db);

  return {
    /**
     * Says nothing about whether the address was already registered — no
     * status code, no message, no timing difference (ADR-006).
     *
     * The earlier version answered 409 for a taken address. The message
     * revealed nothing, but the status code still separated "taken" from
     * "accepted", which is enough to test whether a given person banks here.
     * For a KYC system that is a disclosure about a customer, not merely an
     * API wart.
     *
     * The password is hashed BEFORE the insert is attempted and in both
     * outcomes, so the two paths cost the same time as well as returning the
     * same answer.
     */
    async register({ email, password }) {
      const normalized = normalizeEmail(email);
      const passwordHash = await hasher.hash(password);

      try {
        // Role is fixed here and never read from the request. Employees are
        // seeded by an ADMIN through a separate route; letting a caller choose
        // their own role would be a privilege-escalation hole.
        const user = await repo.insertUser({
          email: normalized,
          passwordHash,
          role: 'CUSTOMER',
        });

        await writeAudit(db, {
          actorType: 'customer',
          actorId: user.id,
          action: 'auth.register.succeeded',
          entityType: 'user',
          entityId: user.id,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;

        // Recorded for us, invisible to the caller. Nothing is written to the
        // existing account: an attacker must not be able to touch a stranger's
        // row by claiming their address.
        await writeAudit(db, {
          actorType: 'system',
          action: 'auth.register.duplicate',
          entityType: 'user',
          detail: { reason: 'address_already_registered' },
        });
      }
    },

    async login({ email, password }) {
      const normalized = normalizeEmail(email);
      const user = await repo.findUserByEmail(normalized);

      if (!user) {
        // Without this, an unknown address would return in a few milliseconds
        // while a known one spent ~64ms hashing — a timing oracle that leaks
        // exactly what the shared error message is there to hide.
        await hasher.spendEqualWork(password);
        throw invalidCredentials();
      }

      const passwordOk = await hasher.verify(user.password_hash, password);

      // Checked AFTER the hash so a suspended account costs the same as an
      // active one. Same message either way.
      if (!passwordOk || user.status !== 'active') {
        await writeAudit(db, {
          actorType: actorTypeForRole(user.role),
          actorId: user.id,
          action: 'auth.login.failed',
          entityType: 'user',
          entityId: user.id,
          detail: { reason: passwordOk ? 'not_active' : 'bad_password' },
        });
        throw invalidCredentials();
      }

      const { token, tokenHash } = createSessionToken();
      const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 60 * 60 * 1000);
      const session = await repo.createSession({ userId: user.id, tokenHash, expiresAt });

      await writeAudit(db, {
        actorType: actorTypeForRole(user.role),
        actorId: user.id,
        action: 'auth.login.succeeded',
        entityType: 'session',
        entityId: session.id,
      });

      return { user: toPublicUser(user), token };
    },

    async logout(auth) {
      await repo.revokeSession(auth.sessionId);
      await writeAudit(db, {
        actorType: actorTypeForRole(auth.role),
        actorId: auth.userId,
        action: 'auth.logout',
        entityType: 'session',
        entityId: auth.sessionId,
      });
    },
  };
}
