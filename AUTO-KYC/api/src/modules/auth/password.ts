import { randomBytes } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import type { Config } from '../../config.js';

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(digest: string, plain: string): Promise<boolean>;
  /**
   * Spend the same work as a real verification, and discard the result. Used
   * when no user matched, so that the response time of a login for an unknown
   * address is indistinguishable from one for a known address.
   */
  spendEqualWork(plain: string): Promise<void>;
}

/**
 * argon2id, per ADR-005. Cost parameters come from configuration and are
 * floored at the OWASP minimum by the schema, so a deployment can raise the
 * cost but cannot quietly weaken it.
 */
export async function createPasswordHasher(config: Config): Promise<PasswordHasher> {
  const options = {
    algorithm: Algorithm.Argon2id,
    memoryCost: config.ARGON2_MEMORY_KIB,
    timeCost: config.ARGON2_TIME_COST,
    parallelism: 1,
  };

  // Computed once at startup against the live parameters, so the decoy costs
  // the same as the real thing. Hashing a random value means it can never be
  // matched by an actual password.
  const decoyDigest = await hash(randomBytes(32).toString('hex'), options);

  return {
    hash(plain) {
      return hash(plain, options);
    },

    async verify(digest, plain) {
      try {
        return await verify(digest, plain);
      } catch {
        // A malformed or truncated digest is a corrupt record, not a valid
        // login. Letting this throw would turn a bad row into a 500 and, worse,
        // would behave differently from a wrong password.
        return false;
      }
    },

    async spendEqualWork(plain) {
      try {
        await verify(decoyDigest, plain);
      } catch {
        // Result is irrelevant; only the elapsed time matters.
      }
    },
  };
}
