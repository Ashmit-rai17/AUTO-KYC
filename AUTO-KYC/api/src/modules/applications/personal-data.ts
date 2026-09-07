import { z } from 'zod';

/**
 * Format only: five letters, four digits, a letter. The fourth character
 * encodes the holder type (P for an individual, C for a company and so on) and
 * is deliberately NOT constrained here — rejecting anything but P would refuse
 * legitimate entity types, and whether the number actually exists is the PAN
 * provider's job, not a regex's.
 */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Indian PIN code: six digits, never starting with zero. */
const PIN_PATTERN = /^[1-9][0-9]{5}$/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Date.parse is too permissive to trust on its own, so the parts are compared
 * back against the date they produce. Without this, "2026-02-30" would sail
 * through in some runtimes and become 2 March.
 */
function isRealDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const built = new Date(Date.UTC(year, month - 1, day));
  return (
    built.getUTCFullYear() === year &&
    built.getUTCMonth() === month - 1 &&
    built.getUTCDate() === day
  );
}

function completedYearsSince(value: string): number {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const now = new Date();
  let years = now.getUTCFullYear() - year;
  const beforeBirthday =
    now.getUTCMonth() + 1 < month ||
    (now.getUTCMonth() + 1 === month && now.getUTCDate() < day);
  if (beforeBirthday) years -= 1;
  return years;
}

const DateOfBirthSchema = z
  .string()
  .trim()
  .regex(ISO_DATE, 'must be a date in YYYY-MM-DD form')
  .refine(isRealDate, 'must be a real date')
  // An account holder must be an adult. This is a rule about eligibility, so
  // it belongs on the input rather than in the rules engine, which decides
  // whether evidence MATCHES rather than whether a person qualifies.
  .refine((value) => completedYearsSince(value) >= 18, 'must be at least 18 years old')
  .refine((value) => completedYearsSince(value) <= 120, 'must be a plausible date of birth');

const AddressSchema = z.object({
  line1: z.string().trim().min(1, 'is required').max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(1, 'is required').max(80),
  state: z.string().trim().min(1, 'is required').max(80),
  postalCode: z.string().trim().regex(PIN_PATTERN, 'must be a six-digit PIN code'),
});

/**
 * What a COMPLETE application must contain. Enforced at submit, not before —
 * see the partial schema below.
 *
 * Note what is absent: no Aadhaar number. Aadhaar is verified from a
 * UIDAI-signed offline e-KYC file (ADR-004) and the number itself must never
 * be persisted here (docs/provider-adapters.md). PAN is different: it is the
 * identifier the PAN provider is asked about, so it has to be stored.
 */
export const PersonalDataSchema = z.object({
  fullName: z.string().trim().min(1, 'is required').max(140),
  dateOfBirth: DateOfBirthSchema,
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(PAN_PATTERN, 'must look like ABCDE1234F'),
  address: AddressSchema,
});

/**
 * What a DRAFT may contain: any subset.
 *
 * A person filling in a form should be able to save half of it and come back,
 * so completeness is checked once, at submit. Validating the full shape on
 * every PATCH would make the draft state useless.
 */
export const PartialPersonalDataSchema = PersonalDataSchema.partial();

export type PersonalData = z.infer<typeof PersonalDataSchema>;
export type PartialPersonalData = z.infer<typeof PartialPersonalDataSchema>;
