import type { Queryable } from '../../db/pool.js';
import type { Role } from '../auth/roles.js';

export type ActorType = 'customer' | 'employee' | 'system';

export interface AuditEntry {
  actorType: ActorType;
  /** Absent for SYSTEM actions, which have no user row behind them. */
  actorId?: string | undefined;
  /** Dotted, past-tense-ish and stable, e.g. "auth.login.succeeded". */
  action: string;
  entityType: string;
  entityId?: string | undefined;
  detail?: Record<string, unknown> | undefined;
}

/** Roles are an API concept; audit actor types are a storage concept. */
export function actorTypeForRole(role: Role): ActorType {
  return role === 'CUSTOMER' ? 'customer' : 'employee';
}

/**
 * Step 5 of the security checklist. audit_log is append-only at the database
 * level (ADR-003), so this can only ever insert.
 *
 * `detail` must never carry a credential, a session token or a full Aadhaar
 * number — audit rows are the one thing in this system that can never be
 * edited or deleted afterwards.
 */
export async function writeAudit(db: Queryable, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.actorType,
      entry.actorId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      JSON.stringify(entry.detail ?? {}),
    ],
  );
}
