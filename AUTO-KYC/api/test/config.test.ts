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

  // AGENTS.md invariant 10: a simulated result must never be mistakable for a
  // real one. Every provider DEFAULTS to mock, so without this guard a
  // production deploy that merely forgets to configure them boots happily and
  // issues simulated verdicts against real identity documents.
  describe('simulators in production', () => {
    const PROD = { DATABASE_URL: VALID_DB_URL, NODE_ENV: 'production' };

    it('refuses to start when a provider is still a simulator', () => {
      expect(() => loadConfig(PROD)).toThrow(/PAN_PROVIDER/);
    });

    it('names every offending provider, not just the first', () => {
      let message = '';
      try {
        loadConfig(PROD);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain('PAN_PROVIDER');
      expect(message).toContain('OCR_PROVIDER');
      expect(message).toContain('STORAGE_PROVIDER');
    });

    it('starts in production once every provider is real', () => {
      const config = loadConfig({
        ...PROD,
        PAN_PROVIDER: 'real',
        OCR_PROVIDER: 'real',
        STORAGE_PROVIDER: 'b2',
      });

      expect(config.NODE_ENV).toBe('production');
      expect(config.ALLOW_MOCK_PROVIDERS_IN_PROD).toBe(false);
    });

    it('allows simulators in production only when explicitly overridden', () => {
      const config = loadConfig({ ...PROD, ALLOW_MOCK_PROVIDERS_IN_PROD: 'true' });

      expect(config.PAN_PROVIDER).toBe('mock');
      expect(config.ALLOW_MOCK_PROVIDERS_IN_PROD).toBe(true);
    });

    // The whole reason this is an enum and not z.coerce.boolean(): coercion
    // reads "false" as truthy, so a safety catch someone deliberately left on
    // would silently disengage.
    it('treats the string "false" as off, not as truthy', () => {
      expect(() => loadConfig({ ...PROD, ALLOW_MOCK_PROVIDERS_IN_PROD: 'false' })).toThrow(
        /PAN_PROVIDER/,
      );
    });

    it('leaves development alone — simulators are the point there', () => {
      expect(() => loadConfig({ DATABASE_URL: VALID_DB_URL })).not.toThrow();
    });
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
