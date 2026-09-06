# KYCFlow — PostgreSQL Schema

## Rule of mutability
- Mutable: users, sessions, applications, documents, verification_checks,
  review_cases, notifications.
- APPEND-ONLY: audit_log, case_events, consents. INSERT only — no UPDATE,
  DELETE or TRUNCATE.

Enforced by a `reject_mutation()` trigger on each protected table, NOT by
revoked privileges: a trigger fires for the table owner as well, a REVOKE does
not. TRUNCATE needs its own statement-level trigger, because a row trigger
never sees it — that is the one command that would otherwise erase an audit
trail silently. See ADR-003.

## Tables (core columns)
- users(id, email UNIQUE, password_hash, role[CUSTOMER/EMPLOYEE/ADMIN],
  created_at, status)
- sessions(id, user_id FK, token_hash UNIQUE, expires_at, revoked_at NULL,
  created_at)
- consents(id, user_id FK, version, ip_address, user_agent, accepted_at,
  created_at) — APPEND-ONLY. The PRD requires consent be explicit and recorded
  with timestamp + metadata; a record that can be edited afterwards is not
  evidence of what was agreed.
- applications(id, user_id FK, status[draft/submitted/verifying/
  verification_pending/review/verified/rejected], personal_data JSONB,
  consent_id NULL, submitted_at, created_at, updated_at)
- documents(id, application_id FK, type[pan/address_proof], storage_key,
  mime, size_bytes, uploaded_at, verified_at NULL)
  — bytes live in object storage; only metadata here
- verification_checks(id, application_id FK, run_id, check_type[pan/
  name_match/dob_match/address_match/doc_quality],
  result[pass/review/fail/not_available], reason TEXT NOT NULL,
  evidence JSONB, created_at)
  — check rows ARE the explainability. Check names follow
  docs/rules-engine.md, which is the more specific source.
- review_cases(id, application_id FK UNIQUE, status[open/resolved],
  assigned_to FK NULL, reason_summary, created_at, resolved_at NULL)
- case_events(id, case_id FK, type[request_info/approve/reject/note],
  actor_id FK, message, created_at) — append-only too
- notifications(id, user_id FK, kind, body, read_at NULL, created_at)
- audit_log(id, actor_type[customer/employee/system], actor_id, action,
  entity_type, entity_id, detail JSONB, created_at) — APPEND-ONLY

## Constraints & notes
- applications.status transitions follow a state machine (docs/rules-engine.md).
- documents.storage_key is never exposed to the browser except inside a
  short-lived signed URL from the backend.
- Indexes: sessions(token_hash), applications(user_id), verification_checks
  (application_id), audit_log(created_at), review_cases(status).
- Files NEVER stored as BYTEA. Postgres stores facts; storage stores bytes.

## Decided while implementing (ADR-003)
- Primary keys are UUID (`gen_random_uuid()`), not sequential integers. An id
  appears in customer-facing URLs, and a sequential one is an enumeration
  oracle — the same concern as invariant 9.
- status columns are TEXT + CHECK, not PostgreSQL enums: the state machine in
  docs/rules-engine.md is expected to grow, and a CHECK is trivial to alter
  where an enum value cannot be removed or renamed.
- users.email uniqueness is a UNIQUE INDEX on `lower(email)`. A plain UNIQUE
  would let "A@b.com" and "a@b.com" both register as separate people.
- applications carries a CHECK that anything past `draft` has both a consent_id
  and a submitted_at, so no code path can leave an application submitted
  without the consent that authorised it.
- verification_checks has a UNIQUE(run_id, check_type), which is what makes a
  replayed verification run idempotent (M1).
- audit_log.actor_id has NO foreign key: the SYSTEM actor is not a user row,
  and an audit trail must outlive whatever it refers to.
