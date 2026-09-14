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

  /**
   * Which version of the consent wording a customer agreed to. Stored on every
   * consent row, because "they consented" is worthless as evidence without
   * knowing WHAT they consented to.
   */
  CONSENT_VERSION: z.string().min(1).default('kycflow-consent-2026-09'),

  // Rate limiting (ADR-006).
  //
  // Note the enum rather than z.coerce.boolean(): coercion would read the
  // string "false" as truthy and silently enable something the operator
  // switched off. For a control that exists to be switched off, that failure
  // mode is unacceptable.
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  /** Per IP, per window, on the credential-accepting routes. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /** Per IP, per window, everywhere else. */
  GLOBAL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  // docs/provider-adapters.md — M0 runs entirely on simulators.
  PAN_PROVIDER: z.enum(['mock', 'real']).default('mock'),
  OCR_PROVIDER: z.enum(['mock', 'real']).default('mock'),
  STORAGE_PROVIDER: z.enum(['mock', 'b2']).default('mock'),

  /**
   * The deliberate escape hatch for invariant 10, and the only one.
   *
   * An enum rather than z.coerce.boolean() for the same reason
   * RATE_LIMIT_ENABLED is: coercion reads the string "false" as truthy, and a
   * safety catch that silently disengages when someone writes false is worse
   * than no catch at all.
   */
  ALLOW_MOCK_PROVIDERS_IN_PROD: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
})
  /**
   * AGENTS.md invariant 10: a simulated result must NEVER be mistakable for a
   * real one. Every provider defaults to 'mock', so a production deploy that
   * simply forgets to configure them would otherwise boot happily and start
   * issuing simulated verdicts against real people's identity documents — the
   * exact failure the invariant exists to prevent, one unset variable away.
   *
   * This lives in the schema rather than in index.ts so that no future entry
   * point — a worker, a serverless handler, a script — can skip it by not
   * remembering to call it.
   */
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production' || env.ALLOW_MOCK_PROVIDERS_IN_PROD) return;

    for (const key of ['PAN_PROVIDER', 'OCR_PROVIDER', 'STORAGE_PROVIDER'] as const) {
      if (env[key] === 'mock') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message:
            'is a simulator, which must not run in production. Configure a real provider, ' +
            'or set ALLOW_MOCK_PROVIDERS_IN_PROD=true to state deliberately that this ' +
            'deployment is a demonstration.',
        });
      }
    }
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
