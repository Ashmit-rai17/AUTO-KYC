# Current milestone

**M0 — Walking Skeleton.** In progress. Slices 1 and 2 of 6 are done.

## Goal
register → login → create application → patch → consent → submit →
mock PAN check → auto-PASS or REVIEW case → employee list / detail / resolve
→ audit rows present. Proven with curl or Postman, and tests, before any UI.

## Exit criteria
Every route in docs/endpoint-contract.md (auth, applications, cases) works
and has a test. Mock providers only. No document uploads — those are M2.

## Build order
- [x] **scaffold** — workspace, TypeScript, Express 5, lint, tests, Docker
      PostgreSQL, health probes. Stack in ADR-002.
- [x] **DB schema** — all 10 tables, append-only enforced by trigger, 25
      integration tests against a real PostgreSQL. Shape in ADR-003.
- [ ] **auth** — register / login / logout / me, session middleware,
      role and ownership guards.
- [ ] **applications** — create, patch, consent, submit.
- [ ] **cases** — employee queue, detail, resolution.
- [ ] **notifications** — status strings only in M0.

## Next slice
**Auth.** Four routes from docs/endpoint-contract.md: register, login, logout,
me. Plus the middleware every later route depends on.

Open questions, both probably ADR-worthy:
1. **Password hashing:** argon2id or bcrypt. AGENTS.md says "bcrypt/argon2"
   without choosing. argon2id is the current recommendation; bcrypt has the
   wider deployment history and no native build step. Native modules on
   Windows are a real consideration here — check that whichever is chosen
   installs cleanly on this machine before committing to it.
2. **Session cookie in development:** the customer app (:3000), employee
   dashboard (:3001) and API (:4000) are three origins. ADR-001 already
   anticipated this and suggested a Next.js rewrite proxy so the cookie stays
   same-site. That needs settling before the front ends exist, because it
   decides whether SameSite=Lax is workable or has to become None+Secure.

## Working notes
- Integration tests need a database: `npm run db:up && npm run db:migrate`,
  then `npm run test:integration`. Plain `npm test` never touches PostgreSQL
  and runs anywhere.
- The whole integration file runs in one transaction that is rolled back, so
  it leaves nothing behind — the only way to clean up append-only tables.
- PostgreSQL `now()` is the TRANSACTION timestamp, so it does not advance
  inside that shared transaction. Do not write a test that asserts a timestamp
  increased; assert the trigger overrode what the caller supplied instead.
