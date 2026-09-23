/**
 * Make a change of case custody impossible to perform silently (ADR-009).
 *
 * ADR-008 decided that an employee sees only cases assigned to them, which
 * turns review_cases.assigned_to into the access-control predicate for every
 * customer's PAN, date of birth and address. That column arrived with no
 * protection at all: review_cases is the only case table carrying no trigger,
 * so any statement could rewrite who can read a case and leave nothing behind.
 *
 * ADR-008 says audit_log absorbs the assignment events, and the application
 * does write them. This makes that promise enforceable rather than remembered:
 * the row is written by the database, so no code path — the M1 verification
 * worker, a maintenance script, a future handler — can change custody without
 * one, whether or not it thought to.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  /**
   * The trigger deliberately does NOT try to name the actor.
   *
   * It cannot: a trigger sees the row, not the request. Identifying the
   * employee would mean the application setting a session variable first, and
   * a path that forgets to do that is precisely the path this exists to catch
   * — so it would report NULL exactly when it mattered most.
   *
   * So there are two rows for an ordinary assignment, and they answer
   * different questions. The application's 'case.assigned' row says who acted
   * and why, and can be forgotten. This one says the row changed, and cannot.
   * Where the two disagree, this is the one that was not optional.
   */
  pgm.sql(`
    CREATE FUNCTION log_case_custody() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      assigned_from UUID := NULL;
      status_from   TEXT := NULL;
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        assigned_from := OLD.assigned_to;
        status_from   := OLD.status;

        -- Editing reason_summary is not a custody event. IS NOT DISTINCT FROM
        -- rather than =, because assigned_to is nullable and NULL = NULL is
        -- NULL, which would make an unassignment look like no change at all.
        IF NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to
           AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
          RETURN NULL;
        END IF;
      ELSIF NEW.assigned_to IS NULL THEN
        -- Created with nobody holding it. ADR-008 allows this when the rota is
        -- empty; there is no custody yet to record.
        RETURN NULL;
      END IF;

      INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, detail)
      VALUES ('system', NULL, 'case.custody.changed', 'review_case', NEW.id,
              jsonb_build_object(
                'operation',     TG_OP,
                'assigned_from', assigned_from,
                'assigned_to',   NEW.assigned_to,
                'status_from',   status_from,
                'status_to',     NEW.status));

      RETURN NULL;
    END;
    $$;
  `);

  /**
   * AFTER, not BEFORE: this records what happened rather than deciding whether
   * it may. INSERT as well as UPDATE, so the case's whole custody history is
   * in one place and reconstructing it never depends on a creation event the
   * application may or may not have written.
   *
   * This also closes, silently and for free, the gap ADR-008 flagged and
   * deferred: assigned_to is ON DELETE SET NULL, so deleting an employee makes
   * their cases belong to nobody. PostgreSQL performs that as an UPDATE on the
   * referencing row, so it fires this trigger and the disappearance is
   * recorded rather than merely noticed later.
   */
  pgm.sql(`
    CREATE TRIGGER review_cases_custody_audit
      AFTER INSERT OR UPDATE ON review_cases
      FOR EACH ROW EXECUTE FUNCTION log_case_custody();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`DROP TRIGGER IF EXISTS review_cases_custody_audit ON review_cases;`);
  pgm.sql(`DROP FUNCTION IF EXISTS log_case_custody();`);
};
