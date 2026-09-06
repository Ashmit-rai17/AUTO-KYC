# Current milestone

**M0 - Walking Skeleton.** In progress. Slices 1 and 2 of 6 are done.

## Goal
register -> login -> create application -> patch -> consent -> submit ->
mock PAN check -> auto-PASS or REVIEW case -> employee list / detail / resolve
-> audit rows present. Proven with curl or Postman, and tests, before any UI.

## Exit criteria
Every route in docs/endpoint-contract.md (auth, applications, cases) works
and has a test. Mock providers only. No document uploads - those are M2.

## Build order
- [x] **scaffold** - workspace, TypeScript, Express 5, lint, tests, Docker
      PostgreSQL, health probes. Stack in ADR-002.
- [x] **DB schema** - all 10 tables, append-only enforced by trigger, 25
      integration tests against a real PostgreSQL. Shape in ADR-003.
- [x] **auth** - register / login / logout / me, session middleware,
      role guard. argon2id + Lax cookie behind a same-origin proxy, ADR-005.
- [ ] **applications** - create, patch, consent, submit.  <- NEXT
- [ ] **cases** - employee queue, detail, resolution.
- [ ] **notifications** - status strings only in M0.

## Context that changes the target
This is being built to DEMONSTRATE to a bank, and then be deployed by one.
That does not lower the bar, it moves it.

The reframe worth holding on to: a BANK is an eligible entity. It can hold
Protean/NSDL PAN access and can be licensed AUA/KUA. We cannot. So the seam is
not "when we get permissions" but "when the bank's credentials are
configured" - which is a much smaller, more provable claim, and it is the one
the product has to stand behind.

ADR-004 settles how. Simulators reproduce the provider CONTRACT - envelope,
latency, failure taxonomy - rather than returning a canned answer, and the
Aadhaar offline e-KYC path is built as real signature-verification code
against a test certificate.

## The plan was re-pointed on 6 September 2026
docs/prd.md and docs/milestones.md were rewritten for this audience. Two
structural changes, both worth knowing before picking up a slice:
1. Provider simulation was promoted from a detail to M1, alongside the async
   worker. They belong together: a simulator's latency and failure modes only
   mean something once something is orchestrating retries around them.
2. The employee dashboard moved from last to M3. A bank buys the review queue
   and the audit trail; a plan that finished the UI last would have had
   nothing to show until the end.
New order: M0 skeleton (here) -> M1 verification engine + simulators ->
M2 Aadhaar offline e-KYC -> M3 demonstration surface -> M4 documents + OCR ->
M5 rules config + admin + polish.

AGENTS.md gained invariant 10 (a simulated result must never be mistakable
for a real one) and invariant 7 now covers Aadhaar.

## Next slice
**Applications.** Six routes: create, list own, get own, patch, consent,
submit. This is the first slice with real OWNERSHIP checks - step 3 of the
security checklist, which auth only stubbed out because /auth/me is
self-referential by definition.

Watch for:
1. The database already refuses a submitted application without a consent_id
   (ADR-003). The submit route must produce a clean 4xx rather than letting
   that CHECK surface as a 500.
2. PATCH must be rejected unless the application is still `draft`, and the
   status must never be settable from the request body - the same
   mass-assignment hole that register defends against with a fixed role.
3. Ownership failures should answer 404, not 403. Confirming that someone
   else's application exists is the same enumeration leak invariant 9 forbids.

## Carried debt, worth doing before the demonstration
- **No rate limiting anywhere.** Login is brute-forceable and registration is
  the weak enumeration signal described in ADR-005. It needs its own ADR: a
  dependency plus a policy that touches every route. A bank will ask.
- **No email verification**, which is the proper fix for the registration
  409 signal.
- **No CSRF token.** SameSite=Lax plus the same-origin proxy covers the
  realistic cases, but a bank's reviewer may still expect a token on state
  changing routes. Worth a decision rather than a silence.

## Working notes
- Integration tests need a database: `npm run db:up && npm run db:migrate`,
  then `npm run test:integration`. Plain `npm test` never touches PostgreSQL
  and runs anywhere.
- The whole integration file runs in one transaction that is rolled back, so
  it leaves nothing behind - the only way to clean up append-only tables.
- PostgreSQL `now()` is the TRANSACTION timestamp, so it does not advance
  inside that shared transaction. Never assert a timestamp increased; assert
  the trigger overrode what the caller supplied instead.
- UPDATE and DELETE against an EMPTY table match no rows, so a row trigger
  never fires. Seed a row before asserting that a mutation is refused.
- argon2id costs 64 MiB of memory PER CONCURRENT LOGIN at the production
  setting. Fine now; a reason to rate-limit, and the cost parameters are
  configurable if throughput ever bites.
- Auth integration tests cannot use the single-transaction trick that
  schema.integration.test.ts uses: supertest drives the app through the pool,
  so every request gets its own connection. They use per-run unique emails and
  delete their users afterwards instead. The audit rows they create stay,
  because audit_log is append-only - which is the point of it.
