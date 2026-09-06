/**
 * Initial schema — every table in docs/db-schema.md.
 *
 * Written as raw SQL on purpose (ADR-002): the guarantees that matter here are
 * database guarantees, and hiding them behind a query builder would defeat the
 * point of writing them down.
 *
 * Three decisions are recorded in ADR-003 and visible below:
 *   - UUID primary keys, so an id in a URL is not an enumeration oracle.
 *   - status columns are TEXT + CHECK rather than PostgreSQL enums.
 *   - append-only tables are enforced by triggers, which fire for the table
 *     owner too, rather than by REVOKE, which does not.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  // ---------------------------------------------------------------- helpers

  // Raising on UPDATE/DELETE is what makes "append-only" a fact rather than a
  // convention. A row trigger cannot see TRUNCATE, so each protected table
  // also gets a statement trigger below.
  pgm.sql(`
    CREATE FUNCTION reject_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $$;
  `);

  pgm.sql(`
    CREATE FUNCTION set_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$;
  `);

  // ------------------------------------------------------------------ users

  pgm.sql(`
    CREATE TABLE users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('CUSTOMER', 'EMPLOYEE', 'ADMIN')),
      status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Case-insensitive uniqueness: "A@b.com" and "a@b.com" are one person, and a
  // plain UNIQUE would happily let both register.
  pgm.sql(`CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));`);

  // --------------------------------------------------------------- sessions

  pgm.sql(`
    CREATE TABLE sessions (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`CREATE INDEX sessions_user_id_idx ON sessions (user_id);`);

  // --------------------------------------------------------------- consents

  // Not in docs/db-schema.md, which nonetheless gave applications a
  // consent_id. The PRD requires consent be "explicit, recorded with timestamp
  // + metadata", so the table has to exist. See ADR-003.
  //
  // Append-only: a consent record that can be edited afterwards is worthless
  // as evidence of what the customer actually agreed to.
  pgm.sql(`
    CREATE TABLE consents (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      version     TEXT NOT NULL,
      ip_address  INET,
      user_agent  TEXT,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`CREATE INDEX consents_user_id_idx ON consents (user_id);`);

  // ----------------------------------------------------------- applications

  pgm.sql(`
    CREATE TABLE applications (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                      'draft', 'submitted', 'verifying', 'verification_pending',
                      'review', 'verified', 'rejected')),
      personal_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      consent_id    UUID REFERENCES consents(id) ON DELETE RESTRICT,
      submitted_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- docs/endpoint-contract.md gates submit on "owner + draft + consent".
      -- Enforced here as well, so no code path can leave an application
      -- submitted without the consent that authorised it.
      CONSTRAINT applications_submitted_needs_consent CHECK (
        status = 'draft'
        OR (consent_id IS NOT NULL AND submitted_at IS NOT NULL)
      )
    );
  `);
  pgm.sql(`CREATE INDEX applications_user_id_idx ON applications (user_id);`);
  pgm.sql(`CREATE INDEX applications_status_idx ON applications (status);`);
  pgm.sql(`
    CREATE TRIGGER applications_set_updated_at
      BEFORE UPDATE ON applications
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // -------------------------------------------------------------- documents

  // Bytes live in object storage; this table holds metadata and a key only
  // (AGENTS.md invariant 2). There is deliberately no bytea column.
  pgm.sql(`
    CREATE TABLE documents (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      type           TEXT NOT NULL CHECK (type IN ('pan', 'address_proof')),
      storage_key    TEXT NOT NULL UNIQUE,
      mime           TEXT NOT NULL,
      size_bytes     BIGINT NOT NULL CHECK (size_bytes > 0),
      uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      verified_at    TIMESTAMPTZ
    );
  `);
  pgm.sql(`CREATE INDEX documents_application_id_idx ON documents (application_id);`);

  // ---------------------------------------------------- verification_checks

  // These rows ARE the explainability. reason is NOT NULL because AGENTS.md
  // invariant 5 requires every check to carry a human-readable reason.
  pgm.sql(`
    CREATE TABLE verification_checks (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      run_id         UUID NOT NULL,
      check_type     TEXT NOT NULL CHECK (check_type IN (
                       'pan', 'name_match', 'dob_match', 'address_match', 'doc_quality')),
      result         TEXT NOT NULL CHECK (result IN (
                       'pass', 'review', 'fail', 'not_available')),
      reason         TEXT NOT NULL,
      evidence       JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`
    CREATE INDEX verification_checks_application_id_idx
      ON verification_checks (application_id);
  `);

  // Idempotent verification runs (docs/milestones.md M1): re-running a run_id
  // cannot produce a second row for the same check.
  pgm.sql(`
    CREATE UNIQUE INDEX verification_checks_run_check_key
      ON verification_checks (run_id, check_type);
  `);

  // ----------------------------------------------------------- review_cases

  pgm.sql(`
    CREATE TABLE review_cases (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id UUID NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
      status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      assigned_to    UUID REFERENCES users(id) ON DELETE SET NULL,
      reason_summary TEXT NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at    TIMESTAMPTZ,

      CONSTRAINT review_cases_resolved_has_timestamp CHECK (
        (status = 'open' AND resolved_at IS NULL)
        OR (status = 'resolved' AND resolved_at IS NOT NULL)
      )
    );
  `);
  pgm.sql(`CREATE INDEX review_cases_status_idx ON review_cases (status);`);
  pgm.sql(`CREATE INDEX review_cases_assigned_to_idx ON review_cases (assigned_to);`);

  // ------------------------------------------------------------ case_events

  pgm.sql(`
    CREATE TABLE case_events (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id    UUID NOT NULL REFERENCES review_cases(id) ON DELETE CASCADE,
      type       TEXT NOT NULL CHECK (type IN ('request_info', 'approve', 'reject', 'note')),
      actor_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      message    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`
    CREATE INDEX case_events_case_id_created_at_idx
      ON case_events (case_id, created_at);
  `);

  // ---------------------------------------------------------- notifications

  pgm.sql(`
    CREATE TABLE notifications (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,
      body       TEXT NOT NULL,
      read_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`
    CREATE INDEX notifications_user_id_created_at_idx
      ON notifications (user_id, created_at DESC);
  `);

  // -------------------------------------------------------------- audit_log

  // actor_id carries no foreign key on purpose: the SYSTEM actor is not a user
  // row, and an audit trail must outlive whatever it refers to.
  pgm.sql(`
    CREATE TABLE audit_log (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_type  TEXT NOT NULL CHECK (actor_type IN ('customer', 'employee', 'system')),
      actor_id    UUID,
      action      TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id   UUID,
      detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`CREATE INDEX audit_log_created_at_idx ON audit_log (created_at);`);
  pgm.sql(`CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);`);

  // ------------------------------------------------ append-only enforcement

  for (const table of ['audit_log', 'case_events', 'consents']) {
    pgm.sql(`
      CREATE TRIGGER ${table}_append_only
        BEFORE UPDATE OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION reject_mutation();
    `);
    // TRUNCATE never fires a row trigger, so it needs its own statement one.
    pgm.sql(`
      CREATE TRIGGER ${table}_no_truncate
        BEFORE TRUNCATE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
    `);
  }
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  for (const table of [
    'audit_log',
    'notifications',
    'case_events',
    'review_cases',
    'verification_checks',
    'documents',
    'applications',
    'consents',
    'sessions',
    'users',
  ]) {
    pgm.sql(`DROP TABLE IF EXISTS ${table} CASCADE;`);
  }
  pgm.sql(`DROP FUNCTION IF EXISTS set_updated_at();`);
  pgm.sql(`DROP FUNCTION IF EXISTS reject_mutation();`);
};
