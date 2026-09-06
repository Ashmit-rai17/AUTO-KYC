import { createHash, randomBytes } from 'node:crypto';

/** Bytes of entropy in a session token. 32 bytes = 256 bits. */
const TOKEN_BYTES = 32;

export interface SessionToken {
  /** Given to the browser in the cookie. Never stored. */
  token: string;
  /** Stored in sessions.token_hash. Never leaves the server. */
  tokenHash: string;
}

/**
 * ADR-001: the database holds only the SHA-256 of the token, so a dump of the
 * sessions table cannot be replayed as a login. Deleting the row revokes
 * access immediately, which is the whole reason sessions live in PostgreSQL
 * rather than in a JWT.
 *
 * Plain SHA-256 is correct here and argon2 would be wrong: the input is 256
 * bits of uniform randomness, so there is no dictionary to attack and nothing
 * for a slow KDF to protect against. Password hashing is slow to defeat
 * guessing; there is nothing to guess.
 */
export function createSessionToken(): SessionToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
