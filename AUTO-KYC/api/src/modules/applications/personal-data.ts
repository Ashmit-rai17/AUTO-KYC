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

// ------------------------------------------------------------ field rules
// Defined once, then composed into both schemas below, so the two can never
// drift apart on what a valid PAN or a valid date of birth looks like.

const FullName = z.string().trim().min(1, 'is required').max(140);

const DateOfBirth = z
  .string()
  .trim()
  .regex(ISO_DATE, 'must be a date in YYYY-MM-DD form')
  .refine(isRealDate, 'must be a real date')
  // An account holder must be an adult. This is a rule about eligibility, so
  // it belongs on the input rather than in the rules engine, which decides
  // whether evidence MATCHES rather than whether a person qualifies.
  .refine((value) => completedYearsSince(value) >= 18, 'must be at least 18 years old')
  .refine((value) => completedYearsSince(value) <= 120, 'must be a plausible date of birth');

const Pan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PAN_PATTERN, 'must look like ABCDE1234F');

const Line = z.string().trim().min(1, 'is required').max(120);
const Town = z.string().trim().min(1, 'is required').max(80);
const PostalCode = z.string().trim().regex(PIN_PATTERN, 'must be a six-digit PIN code');

/**
 * Accepts an empty string as well as a valid value.
 *
 * A draft is whatever the customer has typed so far, and a box they have not
 * reached yet is empty rather than absent. Allowing "" means a half-filled form
 * can be saved, and sending "" is also how a customer CLEARS something they
 * entered earlier: the stored object is replaced by what arrives, so an empty
 * value genuinely removes the old one.
 *
 * A value that is present and not empty is still validated, so the customer
 * finds out their PAN is malformed while typing it rather than at submit.
 */
function orBlank<T extends z.ZodType<string>>(schema: T) {
  return z.union([z.literal(''), schema]);
}

const AddressSchema = z.object({
  line1: Line,
  line2: z.string().trim().max(120).optional(),
  city: Town,
  state: Town,
  postalCode: PostalCode,
});

/**
 * What a COMPLETE application must contain. Enforced at submit, not before.
 *
 * Note what is absent: no Aadhaar number. Aadhaar is verified from a
 * UIDAI-signed offline e-KYC file (ADR-004) and the number itself must never
 * be persisted here (docs/provider-adapters.md). PAN is different: it is the
 * identifier the PAN provider is asked about, so it has to be stored.
 */
export const PersonalDataSchema = z.object({
  fullName: FullName,
  dateOfBirth: DateOfBirth,
  pan: Pan,
  address: AddressSchema,
});

/**
 * What a DRAFT may contain: any subset, any box still blank, and a partly
 * filled address.
 *
 * Building this with `.partial()` alone was a bug. That makes the top-level
 * keys optional but leaves the address itself fully required, so a customer
 * who had typed one line of their address could not save at all.
 */
export const PartialPersonalDataSchema = z.object({
  fullName: orBlank(FullName).optional(),
  dateOfBirth: orBlank(DateOfBirth).optional(),
  pan: orBlank(Pan).optional(),
  address: z
    .object({
      line1: orBlank(Line).optional(),
      line2: z.string().trim().max(120).optional(),
      city: orBlank(Town).optional(),
      state: orBlank(Town).optional(),
      postalCode: orBlank(PostalCode).optional(),
    })
    .optional(),
});

export type PersonalData = z.infer<typeof PersonalDataSchema>;
export type PartialPersonalData = z.infer<typeof PartialPersonalDataSchema>;
