import { describe, expect, it } from 'vitest';
import {
  PartialPersonalDataSchema,
  PersonalDataSchema,
} from '../src/modules/applications/personal-data.js';

const COMPLETE = {
  fullName: 'Priya Nair',
  dateOfBirth: '1994-03-14',
  pan: 'ABCDE1234F',
  address: {
    line1: '42 MG Road',
    city: 'Kochi',
    state: 'Kerala',
    postalCode: '682020',
  },
};

function reject(input: unknown): string[] {
  const parsed = PersonalDataSchema.safeParse(input);
  expect(parsed.success).toBe(false);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => issue.path.join('.'));
}

describe('a complete application', () => {
  it('accepts well-formed details', () => {
    expect(PersonalDataSchema.safeParse(COMPLETE).success).toBe(true);
  });

  it('normalises the PAN to upper case', () => {
    const parsed = PersonalDataSchema.parse({ ...COMPLETE, pan: 'abcde1234f' });
    expect(parsed.pan).toBe('ABCDE1234F');
  });

  it('trims stray whitespace rather than storing it', () => {
    const parsed = PersonalDataSchema.parse({ ...COMPLETE, fullName: '  Priya Nair  ' });
    expect(parsed.fullName).toBe('Priya Nair');
  });

  it('names every missing field at once, not just the first', () => {
    expect(reject({})).toEqual(
      expect.arrayContaining(['fullName', 'dateOfBirth', 'pan', 'address']),
    );
  });
});

describe('PAN', () => {
  it.each(['ABCD1234F', 'ABCDE1234', 'ABCDE12345', '12345ABCDF', 'ABCDE1234FG'])(
    'rejects %s',
    (pan) => {
      expect(reject({ ...COMPLETE, pan })).toContain('pan');
    },
  );

  // The fourth character encodes holder type. Constraining it to P would
  // refuse companies and trusts, so the format is checked and the rest is left
  // to the PAN provider.
  it.each(['ABCPE1234F', 'ABCCE1234F', 'ABCHE1234F'])('accepts holder type in %s', (pan) => {
    expect(PersonalDataSchema.safeParse({ ...COMPLETE, pan }).success).toBe(true);
  });
});

describe('date of birth', () => {
  it('rejects a date that does not exist', () => {
    // Date.parse is lenient enough to turn this into 2 March in some runtimes,
    // which is why the parts are compared back against the built date.
    expect(reject({ ...COMPLETE, dateOfBirth: '2026-02-30' })).toContain('dateOfBirth');
  });

  it.each(['14-03-1994', '1994/03/14', '1994-3-14', 'yesterday'])(
    'rejects the format %s',
    (dateOfBirth) => {
      expect(reject({ ...COMPLETE, dateOfBirth })).toContain('dateOfBirth');
    },
  );

  it('rejects an applicant under 18', () => {
    const sixteen = new Date();
    sixteen.setUTCFullYear(sixteen.getUTCFullYear() - 16);
    const dateOfBirth = sixteen.toISOString().slice(0, 10);

    expect(reject({ ...COMPLETE, dateOfBirth })).toContain('dateOfBirth');
  });

  it('accepts an applicant who turned 18 today', () => {
    const today = new Date();
    today.setUTCFullYear(today.getUTCFullYear() - 18);
    const dateOfBirth = today.toISOString().slice(0, 10);

    expect(PersonalDataSchema.safeParse({ ...COMPLETE, dateOfBirth }).success).toBe(true);
  });

  it('rejects an implausible age', () => {
    expect(reject({ ...COMPLETE, dateOfBirth: '1850-01-01' })).toContain('dateOfBirth');
  });
});

describe('address', () => {
  it.each(['12345', '1234567', '082020', 'ABC123'])('rejects the PIN code %s', (postalCode) => {
    expect(reject({ ...COMPLETE, address: { ...COMPLETE.address, postalCode } })).toContain(
      'address.postalCode',
    );
  });

  it('treats line2 as optional', () => {
    expect(PersonalDataSchema.safeParse(COMPLETE).success).toBe(true);
    expect(
      PersonalDataSchema.safeParse({
        ...COMPLETE,
        address: { ...COMPLETE.address, line2: 'Near the temple' },
      }).success,
    ).toBe(true);
  });
});

describe('a draft', () => {
  // A person filling in a form must be able to save half of it, so the partial
  // schema accepts any subset. Completeness is checked once, at submit.
  it('accepts a single field on its own', () => {
    expect(PartialPersonalDataSchema.safeParse({ fullName: 'Priya Nair' }).success).toBe(true);
  });

  it('accepts nothing at all', () => {
    expect(PartialPersonalDataSchema.safeParse({}).success).toBe(true);
  });

  // Partial means "may be absent", not "may be wrong".
  it('still rejects a field that is present and malformed', () => {
    expect(PartialPersonalDataSchema.safeParse({ pan: 'nonsense' }).success).toBe(false);
  });

  it('drops unknown keys instead of storing them', () => {
    const parsed = PartialPersonalDataSchema.parse({
      fullName: 'Priya Nair',
      status: 'verified',
      isAdmin: true,
    });
    expect(parsed).toEqual({ fullName: 'Priya Nair' });
  });
});
