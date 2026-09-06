import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const VALID_DB_URL = 'postgres://user:pass@localhost:5432/kycflow';

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    const config = loadConfig({ DATABASE_URL: VALID_DB_URL });

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(4000);
    expect(config.SESSION_COOKIE_NAME).toBe('kyc_session');
    expect(config.SESSION_TTL_HOURS).toBe(8);
  });

  it('defaults every provider to its mock (M0 runs offline)', () => {
    const config = loadConfig({ DATABASE_URL: VALID_DB_URL });

    expect(config.PAN_PROVIDER).toBe('mock');
    expect(config.OCR_PROVIDER).toBe('mock');
    expect(config.STORAGE_PROVIDER).toBe('mock');
  });

  it('refuses to start without a database URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('coerces PORT from a string and rejects a nonsense value', () => {
    expect(loadConfig({ DATABASE_URL: VALID_DB_URL, PORT: '8080' }).PORT).toBe(8080);
    expect(() => loadConfig({ DATABASE_URL: VALID_DB_URL, PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  // AGENTS.md invariant 8: the environment holds credentials, so a validation
  // failure must name the KEY and never echo the VALUE into logs.
  it('names an offending key without echoing its value', () => {
    const secret = 'super-secret-credential';
    let message = '';

    try {
      loadConfig({ DATABASE_URL: VALID_DB_URL, PAN_PROVIDER: secret });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('PAN_PROVIDER');
    expect(message).not.toContain(secret);
  });
});
