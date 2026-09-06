import { z } from 'zod';

/**
 * Environment contract. Anything the API needs to run is declared here and
 * validated once at startup, so a misconfigured deploy fails immediately and
 * loudly rather than at the first request that happens to need the value.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  DATABASE_URL: z.string().min(1),

  // docs/adr/session-cookies.md
  SESSION_COOKIE_NAME: z.string().min(1).default('kyc_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(8),

  // Password hashing (ADR-005). The minimum is the OWASP floor for argon2id,
  // so configuration can raise the cost but never weaken it below that.
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(19456).default(65536),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).default(3),

  // docs/provider-adapters.md — M0 runs entirely on simulators.
  PAN_PROVIDER: z.enum(['mock', 'real']).default('mock'),
  OCR_PROVIDER: z.enum(['mock', 'real']).default('mock'),
  STORAGE_PROVIDER: z.enum(['mock', 'b2']).default('mock'),
});

export type Config = z.infer<typeof EnvSchema>;

/**
 * Validate the environment. On failure the error names the offending KEYS and
 * never their VALUES — the environment holds credentials, and a stack trace
 * containing them would end up in logs (AGENTS.md invariant 8).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid environment configuration. Check these keys: ${keys.join(', ')}`);
  }
  return parsed.data;
}
