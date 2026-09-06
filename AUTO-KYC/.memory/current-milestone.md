# Current milestone

**M0 — Walking Skeleton.** In progress. Slice 1 of 6 (scaffold) is done.

## Goal
register → login → create application → patch → consent → submit →
mock PAN check → auto-PASS or REVIEW case → employee list / detail / resolve
→ audit rows present. Proven with curl or Postman, and tests, before any UI.

## Exit criteria
Every route in docs/endpoint-contract.md (auth, applications, cases) works
and has a test. Mock providers only. No document uploads — those are M2.

## Build order
- [x] **scaffold** — workspace, TypeScript, Express 5, lint, tests, Docker
      PostgreSQL, health probes. Stack recorded in ADR-002.
- [ ] **DB schema** — migrations for every table in docs/db-schema.md, with
      audit_log enforced append-only at the database, not in application code.
- [ ] **auth** — register / login / logout / me, session middleware,
      role and ownership guards.
- [ ] **applications** — create, patch, consent, submit.
- [ ] **cases** — employee queue, detail, resolution.
- [ ] **notifications** — status strings only in M0.

## Next slice
**DB schema.** Write the node-pg-migrate migrations for docs/db-schema.md.
Two things need deciding first and may warrant an ADR:
1. How the append-only rule on audit_log is enforced — a BEFORE UPDATE/DELETE
   trigger that raises, revoked table privileges, or both.
2. Whether applications.status is a PostgreSQL enum or a CHECK-constrained
   text column. An enum is stricter; a text column is far easier to extend
   when the state machine in docs/rules-engine.md grows.
