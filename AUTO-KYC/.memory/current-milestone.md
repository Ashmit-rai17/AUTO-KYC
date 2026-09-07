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
- [x] **applications** - create, list, get, patch, consent, submit.
      Ownership as a WHERE clause answering 404 not 403, ADR-007.
- [ ] **cases** - employee queue, detail, resolution.  <- NEXT
- [ ] **notifications** - status strings only in M0.
- [x] **customer application form** - pulled forward out of M3, because
      the API was complete and tested while no customer could reach it
      through a browser.

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
**Cases.** Three routes: GET /api/cases (the queue), GET /api/cases/:id (detail
with checks and reasons), POST /api/cases/:id/resolution (approve / reject /
request more information, with a reason).

This is the mirror of the applications slice. Applications were CUSTOMER-only
and scoped by user_id; cases are EMPLOYEE/ADMIN and scoped by case access. The
question to settle first is what "case access" means, because docs/AGENTS.md
says employees act on cases "assigned/authorized to them" without defining it:
1. Any employee may open any case, or only the assignee, or unassigned-plus-own?
   A queue nobody can pick work from is useless, so some form of claiming is
   needed. Probably: unassigned cases are visible to all, assigning one to
   yourself makes it yours, and an ADMIN can reassign.
2. A resolution must write a case_events row, and case_events is APPEND-ONLY -
   so a resolution cannot be edited or undone. That is right for an audit
   trail, but it means "approve" is irreversible and the UI has to say so.

Worth knowing before starting: nothing creates a case yet. The verification
worker does that, and it is M1. So this slice can be built and tested against
cases inserted directly, but the queue only fills for real once M1 lands.

## Carried debt
Cleared on 6 September 2026 by ADR-006: rate limiting, CSRF tokens, and a
registration endpoint that no longer distinguishes a taken address from a free
one. All three were closed before applications began, so nothing was built on
top of them.

What is still outstanding, and why:
- **No password reset.** Registration is now silent, so someone who
  re-registers an address they already own gets 202, their password is
  unchanged, and their next login fails with the ordinary 401 with no way
  forward. The fix is a reset flow, which needs an email provider. That
  provider should follow ADR-004 and ship with a simulator so the flow can be
  demonstrated before any mail is actually sent.
- **A consented customer cannot be deleted.** consents.user_id is ON DELETE
  RESTRICT and consents is append-only, so the delete is refused and the
  consent row cannot be moved aside. This schema therefore cannot honour an
  erasure request for anyone who consented. Statutory KYC retention makes it
  defensible, but it is a position rather than an accident and a privacy
  reviewer will ask. Found because a test could not clean up after itself.
- **Rate-limit store is in-memory**, so the limit multiplies by instance count
  behind more than one API instance. Correct for the demonstration; must move
  to a shared store before it is not.

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
- Cookies IGNORE THE PORT. localhost:3000 and localhost:3001 share one jar, so
  signing into the staff dashboard replaces the customer session. Both apps now
  guard on role rather than trusting whoever the cookie belongs to. For a
  side-by-side demonstration use two browser profiles, or hosts entries for
  customer.localhost / employee.localhost - Windows does NOT resolve *.localhost
  on its own, so binding Next to that hostname fails; only the browser resolves
  it, so the hosts entries are needed.
- Killing a `next start` means killing the NEXT process, not the npm wrapper.
  Killing the wrapper leaves the port bound, the restart dies with EADDRINUSE,
  and the browser quietly keeps serving the OLD bundle - which looks exactly
  like a code change that did not work.
- Two rate limiters, not one, and the reason is easy to undo by accident.
  Login uses skipSuccessfulRequests so a shared office address is not locked
  out. Registration must NOT, because it always answers 202 and so has no
  failures to count - with skipSuccessfulRequests it would have no limit at
  all. Combining the two fixes naively produced exactly that hole.
- CSRF is gated on "does this request carry a session cookie", not on a list
  of exempt paths. New routes are covered automatically; nothing to keep in
  sync.
- ESLint must ignore **/.next/** and **/out/**. Adding the front ends turned
  `npm run lint` into 6800 errors about generated bundles, and lint had been
  clean only because those directories did not exist yet.
- PowerShell variables are CASE-INSENSITIVE. `$b` for a session silently
  clobbered `$B` holding a base URL. And `Go ... | Out-Null` swallows the
  function's Write-Output logging along with its return value - use Write-Host
  for logs inside a function whose result gets piped away.
- The customer form is wired to the API's structured field errors
  (error.fields), NOT to a copy of the validation rules in the browser. The Zod
  schema stays the single source of truth; the form just maps dotted paths onto
  inputs. Do not reintroduce client-side rule copies, they drift.
- Record consent AFTER a submit attempt fails with CONSENT_REQUIRED, never
  before. The server checks completeness first, so that code can only mean
  everything else is in order. Doing it the obvious way round left a consent
  row behind for every failed attempt, and consents is append-only so they
  could never be removed.
- The draft schema must accept blank strings and a partly filled address.
  Building it with .partial() alone leaves the address itself fully required,
  which silently makes save-as-you-go impossible for the address.
