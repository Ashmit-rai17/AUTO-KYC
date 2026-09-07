import type { Queryable } from '../../db/pool.js';
import type { PartialPersonalData } from './personal-data.js';

export const APPLICATION_STATUSES = [
  'draft',
  'submitted',
  'verifying',
  'verification_pending',
  'review',
  'verified',
  'rejected',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * Statuses in which an application is still going somewhere. A customer may
 * hold only one of these at a time; once an application reaches verified or
 * rejected they are free to start another.
 */
export const IN_FLIGHT_STATUSES: readonly ApplicationStatus[] = [
  'draft',
  'submitted',
  'verifying',
  'verification_pending',
  'review',
];

export interface ApplicationRecord {
  id: string;
  user_id: string;
  status: ApplicationStatus;
  personal_data: PartialPersonalData;
  consent_id: string | null;
  submitted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ConsentInput {
  version: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface ApplicationsRepo {
  create(userId: string): Promise<ApplicationRecord>;
  listForUser(userId: string): Promise<ApplicationRecord[]>;
  findInFlightForUser(userId: string): Promise<ApplicationRecord | undefined>;
  findOwned(id: string, userId: string): Promise<ApplicationRecord | undefined>;
  updateDraftPersonalData(
    id: string,
    userId: string,
    personalData: PartialPersonalData,
  ): Promise<ApplicationRecord | undefined>;
  recordConsent(
    id: string,
    userId: string,
    consent: ConsentInput,
  ): Promise<ApplicationRecord | undefined>;
  submit(id: string, userId: string): Promise<ApplicationRecord | undefined>;
}

const COLUMNS = `id, user_id, status, personal_data, consent_id, submitted_at, created_at, updated_at`;

/**
 * Every statement here is scoped by user_id in its WHERE clause, and that is
 * the whole ownership model rather than a check performed alongside it.
 *
 * The consequence is the important part: a request for someone else's
 * application matches no row and is indistinguishable from a request for an
 * application that does not exist. There is no branch that could answer 403
 * and thereby confirm a stranger's application is real — the same enumeration
 * concern as invariant 9.
 */
export function createApplicationsRepo(db: Queryable): ApplicationsRepo {
  return {
    async create(userId) {
      const { rows } = await db.query<ApplicationRecord>(
        `INSERT INTO applications (user_id) VALUES ($1) RETURNING ${COLUMNS}`,
        [userId],
      );
      const created = rows[0];
      if (!created) throw new Error('create returned no row');
      return created;
    },

    async listForUser(userId) {
      const { rows } = await db.query<ApplicationRecord>(
        `SELECT ${COLUMNS} FROM applications
         WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      );
      return rows;
    },

    async findInFlightForUser(userId) {
      const { rows } = await db.query<ApplicationRecord>(
        `SELECT ${COLUMNS} FROM applications
         WHERE user_id = $1 AND status = ANY($2::text[])
         ORDER BY created_at DESC LIMIT 1`,
        [userId, IN_FLIGHT_STATUSES],
      );
      return rows[0];
    },

    async findOwned(id, userId) {
      const { rows } = await db.query<ApplicationRecord>(
        `SELECT ${COLUMNS} FROM applications WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      return rows[0];
    },

    /**
     * The draft guard lives in the WHERE clause too. A PATCH against a
     * submitted application matches nothing, so it cannot half-apply: there is
     * no window in which the row is read, judged editable, and then written.
     */
    async updateDraftPersonalData(id, userId, personalData) {
      const { rows } = await db.query<ApplicationRecord>(
        `UPDATE applications
         SET personal_data = personal_data || $3::jsonb
         WHERE id = $1 AND user_id = $2 AND status = 'draft'
         RETURNING ${COLUMNS}`,
        [id, userId, JSON.stringify(personalData)],
      );
      return rows[0];
    },

    /**
     * consents is append-only (ADR-003), so consenting again writes a new row
     * and repoints the application at it. The earlier record survives, which
     * is the point: what a customer agreed to and when is evidence.
     */
    async recordConsent(id, userId, consent) {
      const { rows } = await db.query<ApplicationRecord>(
        `WITH owner AS (
           SELECT id, user_id FROM applications
           WHERE id = $1 AND user_id = $2 AND status = 'draft'
         ), granted AS (
           INSERT INTO consents (user_id, version, ip_address, user_agent)
           SELECT owner.user_id, $3, $4::inet, $5 FROM owner
           RETURNING id
         )
         UPDATE applications a
         SET consent_id = granted.id
         FROM granted
         WHERE a.id = $1 AND a.user_id = $2 AND a.status = 'draft'
         RETURNING ${COLUMNS.split(', ').map((c) => `a.${c}`).join(', ')}`,
        [id, userId, consent.version, consent.ipAddress, consent.userAgent],
      );
      return rows[0];
    },

    /**
     * Requires a consent row to already be attached. The database enforces the
     * same rule independently (applications_submitted_needs_consent), so this
     * condition is belt and braces rather than the only guard.
     */
    async submit(id, userId) {
      const { rows } = await db.query<ApplicationRecord>(
        `UPDATE applications
         SET status = 'submitted', submitted_at = now()
         WHERE id = $1 AND user_id = $2 AND status = 'draft' AND consent_id IS NOT NULL
         RETURNING ${COLUMNS}`,
        [id, userId],
      );
      return rows[0];
    },
  };
}
