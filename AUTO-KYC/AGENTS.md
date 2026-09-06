# KYCFlow — Agent Constitution

## Purpose (3 lines)
KYC / account-opening platform. A customer submits a form + identity
documents → the system verifies via authorized providers + OCR → a rules
engine emits per-check PASS/REVIEW/FAIL/NOT_AVAILABLE with reasons →
only exceptions reach employees in a review queue. Every action is audited.

## Actors & roles
- CUSTOMER — acts only on their own application
- EMPLOYEE — acts on cases assigned/authorized to them (never self-registers)
- ADMIN — config, roles, seeds employees
- SYSTEM — verification worker, internal only

## Non-negotiable invariants (never violate, never "simplify")
1. The API is the only door. Browsers never touch PostgreSQL or storage directly.
2. Document BYTES go to object storage. PostgreSQL stores metadata + storage_key only.
3. Signed URLs are generated ONLY by the backend: short-lived, one-purpose, per-user.
4. ML/OCR produce EVIDENCE, never decisions. The rules engine decides.
5. Every check outputs PASS | REVIEW | FAIL | NOT_AVAILABLE with a human-readable reason.
6. Audit log is append-only: INSERT only, never UPDATE/DELETE.
7. Every provider (PAN, OCR, storage) sits behind an adapter; MOCKS first, real later.
8. Credentials never live in frontend code. Never print or commit .env.
9. Customer-facing messages are vague on purpose (no field-level failure leaks = no enumeration oracle).

## Stack & commands
- Next.js customer app (:3000) · Next.js employee dashboard (:3001) · Node.js API (:4000)
- PostgreSQL (Docker for local dev) · Object storage: Backblaze B2 (S3-compatible)
- Test: `npm test` · Migrate: `npm run db:migrate` · Lint: `npm run lint`

## Security checklist — every route must pass
1. authenticate (HttpOnly session cookie, SHA-256-hashed token in DB)
2. authorize (role: CUSTOMER/EMPLOYEE/ADMIN)
3. ownership / case-access check
4. input validation
5. audit-log write on any state change

## Agent rules
- BEFORE any cross-cutting change (new table, new endpoint, new provider
  interface, new dependency): STOP and ask the human. Propose an ADR first.
- When you change a route / schema / adapter, update endpoint-contract.md,
  db-schema.md and provider-adapters.md in the SAME change. Docs are the
  source of truth, not your memory.
- A route without a test is not done. Run tests after every slice.
- After every slice, append an entry to .memory/build-log.md (see template there).
- If you believe "we decided X" and X is not in an ADR or doc — say so; do not assume.

## Session protocol (read this every session start)
1. Read docs/context.md and .memory/current-milestone.md.
2. State which milestone/slice you believe is next + the exit criteria.
3. Wait for human confirmation before writing code.
4. Implement ONE slice. Show the diff. Do not touch unrelated code.

## Source-of-truth docs map
docs/context.md (overview) · docs/prd.md (requirements)
docs/architecture.md · docs/endpoint-contract.md · docs/db-schema.md
docs/provider-adapters.md · docs/rules-engine.md · docs/milestones.md
docs/adr/* (decision records)
.memory/current-milestone.md · .memory/build-log.md (what/why journal)
