import type { Config } from '../../config.js';
import type { Queryable } from '../../db/pool.js';
import { AppError } from '../../http/errors.js';
import { writeAudit } from '../audit/audit.js';
import type { AuthContext } from '../auth/roles.js';
import {
  createApplicationsRepo,
  type ApplicationRecord,
  type ApplicationsRepo,
} from './applications.repo.js';
import { PersonalDataSchema, type PartialPersonalData } from './personal-data.js';

export interface PublicApplication {
  id: string;
  status: ApplicationRecord['status'];
  personalData: PartialPersonalData;
  consentRecorded: boolean;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationsService {
  create(auth: AuthContext): Promise<PublicApplication>;
  listOwn(auth: AuthContext): Promise<PublicApplication[]>;
  getOwn(auth: AuthContext, id: string): Promise<PublicApplication>;
  patch(
    auth: AuthContext,
    id: string,
    personalData: PartialPersonalData,
  ): Promise<PublicApplication>;
  recordConsent(
    auth: AuthContext,
    id: string,
    context: { ipAddress: string | null; userAgent: string | null },
  ): Promise<PublicApplication>;
  submit(auth: AuthContext, id: string): Promise<PublicApplication>;
}

/**
 * Ownership failures are 404, never 403.
 *
 * A 403 would confirm that the application exists and belongs to someone else,
 * which is precisely the disclosure invariant 9 forbids. "Not found" is also
 * true from the caller's point of view: as far as they are concerned there is
 * no such application.
 */
function notFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'Application not found');
}

/**
 * consent_id is never exposed. The customer needs to know WHETHER they have
 * consented, not the identifier of the evidence row.
 */
function toPublic(record: ApplicationRecord): PublicApplication {
  return {
    id: record.id,
    status: record.status,
    personalData: record.personal_data ?? {},
    consentRecorded: record.consent_id !== null,
    submittedAt: record.submitted_at ? record.submitted_at.toISOString() : null,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

export function createApplicationsService(deps: {
  db: Queryable;
  config: Config;
  repo?: ApplicationsRepo;
}): ApplicationsService {
  const { db, config } = deps;
  const repo = deps.repo ?? createApplicationsRepo(db);

  /**
   * Loads the caller's own application or refuses.
   *
   * Every route goes through here, so no route can forget the ownership check
   * — step 3 of the security checklist is structural rather than remembered.
   */
  async function loadOwn(auth: AuthContext, id: string): Promise<ApplicationRecord> {
    const record = await repo.findOwned(id, auth.userId);
    if (!record) throw notFound();
    return record;
  }

  /** Only the owner ever reaches this, so telling them the state is safe. */
  function requireDraft(record: ApplicationRecord): void {
    if (record.status !== 'draft') {
      throw new AppError(
        409,
        'NOT_EDITABLE',
        'This application has been submitted and can no longer be changed.',
      );
    }
  }

  return {
    async create(auth) {
      // One application at a time while it is still going somewhere. A
      // rejected or verified application does not block a fresh attempt.
      const existing = await repo.findInFlightForUser(auth.userId);
      if (existing) {
        throw new AppError(
          409,
          'APPLICATION_IN_PROGRESS',
          'You already have an application in progress.',
        );
      }

      const created = await repo.create(auth.userId);
      await writeAudit(db, {
        actorType: 'customer',
        actorId: auth.userId,
        action: 'application.created',
        entityType: 'application',
        entityId: created.id,
      });
      return toPublic(created);
    },

    async listOwn(auth) {
      const rows = await repo.listForUser(auth.userId);
      return rows.map(toPublic);
    },

    async getOwn(auth, id) {
      return toPublic(await loadOwn(auth, id));
    },

    async patch(auth, id, personalData) {
      const record = await loadOwn(auth, id);
      requireDraft(record);

      const updated = await repo.updateDraftPersonalData(id, auth.userId, personalData);
      // Only reachable if the status changed between the read and the write.
      if (!updated) throw notFound();

      await writeAudit(db, {
        actorType: 'customer',
        actorId: auth.userId,
        action: 'application.updated',
        entityType: 'application',
        entityId: id,
        // The FIELDS that changed, never their values. Audit rows can never be
        // edited or deleted, so a customer's name and PAN must not be copied
        // into them on every keystroke.
        detail: { fields: Object.keys(personalData).sort() },
      });

      return toPublic(updated);
    },

    async recordConsent(auth, id, context) {
      const record = await loadOwn(auth, id);
      requireDraft(record);

      const updated = await repo.recordConsent(id, auth.userId, {
        version: config.CONSENT_VERSION,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      if (!updated) throw notFound();

      await writeAudit(db, {
        actorType: 'customer',
        actorId: auth.userId,
        action: 'application.consent.recorded',
        entityType: 'application',
        entityId: id,
        detail: { version: config.CONSENT_VERSION },
      });

      return toPublic(updated);
    },

    async submit(auth, id) {
      const record = await loadOwn(auth, id);
      requireDraft(record);

      // Completeness is checked HERE and not on every PATCH, so a customer can
      // save a half-filled form and come back to it.
      const complete = PersonalDataSchema.safeParse(record.personal_data ?? {});
      if (!complete.success) {
        const missing = [
          ...new Set(complete.error.issues.map((issue) => issue.path.join('.'))),
        ].sort();
        throw new AppError(
          400,
          'INCOMPLETE',
          `Some details are still needed: ${missing.join(', ')}`,
          // Same shape as a validation failure, so the form marks the missing
          // inputs instead of printing a list the customer has to read and
          // then hunt for.
          complete.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        );
      }

      if (record.consent_id === null) {
        throw new AppError(
          409,
          'CONSENT_REQUIRED',
          'Consent must be recorded before an application can be submitted.',
        );
      }

      const submitted = await repo.submit(id, auth.userId);
      // The database carries the same rule as a CHECK constraint (ADR-003).
      // Reaching this means the row changed underneath us, not that the guard
      // above was wrong — either way the caller gets a clean 4xx rather than a
      // constraint violation surfacing as a 500.
      if (!submitted) throw notFound();

      await writeAudit(db, {
        actorType: 'customer',
        actorId: auth.userId,
        action: 'application.submitted',
        entityType: 'application',
        entityId: id,
      });

      return toPublic(submitted);
    },
  };
}
