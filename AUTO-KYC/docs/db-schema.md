# KYCFlow — PostgreSQL Schema

## Rule of mutability
- Mutable: users, sessions, applications, documents, verification_checks,
  review_cases, notifications.
- APPEND-ONLY: audit_log (INSERT only — no UPDATE/DELETE; enforce via
  DB trigger/revoked privileges).

## Tables (core columns)
- users(id, email UNIQUE, password_hash, role[CUSTOMER/EMPLOYEE/ADMIN],
  created_at, status)
- sessions(id, user_id FK, token_hash UNIQUE, expires_at, revoked_at NULL,
  created_at)
- applications(id, user_id FK, status[draft/submitted/verifying/
  verification_pending/review/verified/rejected], personal_data JSONB,
  consent_id NULL, submitted_at, created_at, updated_at)
- documents(id, application_id FK, type[pan/address_proof], storage_key,
  mime, size_bytes, uploaded_at, verified_at NULL)
  — bytes live in object storage; only metadata here
- verification_checks(id, application_id FK, run_id, check_type[pan/name/
  dob/address/doc_quality], result[pass/review/fail/not_available],
  reason TEXT, evidence JSONB, created_at)
  — check rows ARE the explainability
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
