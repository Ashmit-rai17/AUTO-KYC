# Build log

One entry per slice, newest at the bottom. Record **why**, not just what —
the diff already records what. Never rewrite an existing entry; append a
correcting entry instead.

## Template

### YYYY-MM-DD — <slice name>
**What:** one or two lines.
**Why:** the reasoning that is not visible in the diff.
**Decisions:** anything that should become an ADR, or "none".
**Docs touched:** endpoint-contract / db-schema / provider-adapters / none.
**Tests:** what proves this slice works.

---

### 2026-09-06 — Repository documentation
**What:** Added the project README, replacing a 2-byte placeholder, and
repointed 11 broken references across AGENTS.md, architecture.md,
db-schema.md, milestones.md and provider-adapters.md.
**Why:** the docs referred to each other by numeric prefix
(docs/00-context.md, docs/03, docs/06) but the files on disk are unnumbered,
so every one of those paths was dead. AGENTS.md tells each session that docs
are the source of truth and then handed out paths that do not resolve — the
first lookup of a session would fail.
**Decisions:** none. Documentation only; no design decision was changed.
**Docs touched:** AGENTS.md, architecture, db-schema, milestones,
provider-adapters.
**Tests:** not applicable, no code yet.

### 2026-09-06 — Session memory scaffold
**What:** Created .memory/current-milestone.md and .memory/build-log.md, and
filled the unset `Date: <today>` placeholder in ADR-001.
**Why:** AGENTS.md mandates reading current-milestone.md at every session
start and appending here after every slice, but neither file existed, so the
session protocol could not actually be followed as written.
**Decisions:** none.
**Docs touched:** docs/adr/session-cookies.md (date only).
**Tests:** not applicable, no code yet.

### 2026-09-06 — M0 slice 1: scaffold
**What:** npm workspace with an `api/` package. TypeScript (ESM, strict),
Express 5, `pg`, Zod, node-pg-migrate, Vitest + supertest, ESLint flat config,
Docker PostgreSQL, and liveness / readiness probes.
**Why:** M0 could not begin while the framework, database client, migration
tool and test runner were undecided. Wiring every gate in the definition of
done (`npm test`, `npm run lint`, `npm run db:migrate`) from the first commit
means later slices cannot quietly skip them.
**Decisions:** ADR-002. Notably: raw `pg` over an ORM, because audit_log's
append-only guarantee belongs in the database and an ORM would hide that
layer; and TypeScript 5.9 rather than the newly released TypeScript 7, which
is a native rewrite and too new to found this on.
**Docs touched:** endpoint-contract (operational routes), adr (ADR-002).
**Tests:** 10 passing. Config defaults and validation, including a test that a
config error names the offending KEY without echoing its VALUE — invariant 8
is a rule that can rot silently, so it is pinned by a test. Health liveness
asserts the database is never queried; readiness covers both up and down.
**Verified:** install, typecheck, lint, build, and the compiled server
answering all three routes over HTTP.

### 2026-09-06 — M0 slice 2: database schema
**What:** One migration creating all ten tables from docs/db-schema.md, plus a
consents table that the docs referenced but never defined. Append-only
enforcement, an updated_at trigger, and 25 integration tests run against a real
PostgreSQL.
**Why:** the append-only promise on audit_log is the one this project makes to
regulators, so it had to become a database fact rather than a convention that
application code is trusted to honour.
**Decisions:** ADR-003. UUID keys (a sequential id in a customer-facing URL is
an enumeration oracle, same concern as invariant 9); TEXT + CHECK over enums
(the state machine will grow); triggers over REVOKE (a trigger fires for the
table owner, a REVOKE does not).
**Docs touched:** db-schema (consents table, corrected check names, decisions
section), adr (ADR-003).
**Tests:** 25 integration + the existing 10 unit. Verified up, down, and up
again; the rollback leaves no orphan functions.
**Worth remembering — three things the tests caught that review would not:**
1. UPDATE and DELETE against an EMPTY table match no rows, so a row trigger
   never fires and the statement succeeds. The first version of the
   append-only tests passed for that entirely wrong reason until the tables
   were seeded.
2. TRUNCATE never fires a row-level trigger. Without the separate statement
   trigger, one command would have erased the audit trail with no error.
3. TRUNCATE on consents is refused by its foreign key BEFORE the trigger is
   reached, so that table is protected by two mechanisms and reports a
   different error than the other two.

### 2026-09-06 - ADR-004: how providers get simulated
**What:** No code. Recorded how the provider layer behaves for a bank
demonstration, and updated docs/provider-adapters.md with the Aadhaar adapter,
the two PAN response shapes, and the provenance envelope.
**Why:** the audience changed the requirement. This is shown to a bank before
any licence exists, so the mocks have to demonstrate the real process rather
than return canned answers. Settling it now means the provider interface and
the evidence shape are not retrofitted later around whatever was convenient.
**Decisions:** ADR-004. Mocks simulate the contract - envelope, ~1.2s latency,
full failure taxonomy - because a zero-millisecond {valid:true} hides the async
worker and the outage handling, which is the part a bank actually buys. Every
check row stamps provider mode, and the API refuses to boot with mocks under
NODE_ENV=production, so a simulated result can never be mistaken for a real
one.
**Docs touched:** adr (ADR-004), provider-adapters.
**Tests:** none - documentation only.
**Spiked before accepting:** proved the Aadhaar offline e-KYC signature path
works in Node (xml-crypto 6.1.2, RSA-SHA256, enveloped): signs and verifies
against the right anchor, rejects an altered name, rejects a different anchor.
Trap found: xml-crypto RETURNS false on a digest mismatch but THROWS on a
signature-value mismatch - catch both or a forged document becomes a 500
instead of a FAIL. Worth the detour: the ADR now claims only what was actually
observed. Still unproven, and flagged as such: extracting the XML from UIDAI's
share-code-protected ZIP.

### 2026-09-06 - Re-pointed the PRD and the plan at the bank demonstration
**What:** Rewrote docs/prd.md and docs/milestones.md. Added invariant 10 to
AGENTS.md and widened invariant 7 to cover Aadhaar; refreshed the commands
line, which had gone stale after the integration-test split.
**Why:** the PRD still read as a portfolio build - "mock providers first, real
ones later" - which is now actively misleading. The bank is the eligible
entity, not us. It can hold Protean/NSDL PAN access and can be licensed
AUA/KUA, so the seam is "when the bank's credentials are configured", not
"when we get permissions". That is a smaller and far more defensible claim,
and the docs need to say it because it is what the demonstration argues.
**Decisions:** no new ADR - this records the consequences of ADR-004 rather
than deciding anything new. Two structural changes to the plan: provider
simulation promoted into M1 next to the async worker, because a simulator's
latency and failure taxonomy are meaningless without something orchestrating
retries; and the employee dashboard pulled from M5 to M3, because the review
queue and audit trail ARE the demonstration and finishing the UI last would
leave nothing to show.
**Docs touched:** prd, milestones, AGENTS.
**Tests:** none - documentation only.
**Also recorded:** the five demonstration scenarios are now written into
milestones.md as a specification rather than living in conversation. The
provider-outage one is the one a naive stub cannot demonstrate at all, which
is the whole argument for ADR-004.

### 2026-09-06 - M0 slice 3: authentication
**What:** register / login / logout / me, session middleware and a role guard.
argon2id password hashing, PostgreSQL-backed sessions, audit on every outcome.
70 tests now pass (26 unit, 44 integration).
**Why:** everything after this depends on knowing who is calling. Ownership
checks, the review queue and the audit trail are all meaningless without it.
**Decisions:** ADR-005, which closes the two questions this file has been
carrying. argon2id via @node-rs/argon2 (a prebuilt Rust binding, not a
node-gyp build - it installed in three seconds on a machine where native
compilation has already failed twice). Cost m=65536/t=3 at ~64ms, configurable
but FLOORED at the OWASP minimum by the config schema, so a deployment can
raise it and cannot quietly weaken it. Cookie stays SameSite=Lax behind a
same-origin Next.js rewrite proxy, which means the API enables no CORS at all
- no cross-origin credentialed request is possible, so there is no
cross-origin surface to defend.
**Docs touched:** adr (ADR-005), endpoint-contract (auth model, and an honest
note about where the vagueness is incomplete).
**Tests:** 26 unit + 44 integration. Beyond the happy paths they pin the
security properties: a role in the request body cannot make you an ADMIN; the
session token is in the database only as a SHA-256; logout locks the holder
out on the very NEXT request, which is the entire reason ADR-001 chose
sessions over a JWT; suspending an account does the same; and no audit row
ever contains a password or a token.
**Two things worth remembering:**
1. Login spends hashing work even when no user matched. Without that decoy an
   unknown address answers in microseconds while a known one spends ~64ms -
   a timing oracle leaking exactly what the shared error message hides.
2. Typecheck caught a test that would have passed on two SUCCESSES: comparing
   two failures via `.catch(e => e)` never asserts that either call actually
   failed. It now goes through a helper that throws if the call succeeds.
**Known gap, stated rather than hidden:** no rate limiting anywhere. Login is
brute-forceable and registration's 409 is a weak enumeration signal (ADR-005).
Both need an ADR because rate limiting adds a dependency and touches every
route. A bank will ask about this.

### 2026-09-06 - Closing the three gaps auth left open
**What:** Rate limiting on every route and strictly on credential routes, CSRF
double-submit tokens on state-changing requests, and a registration endpoint
that answers identically whether or not the address is taken. 82 tests now
pass (26 unit, 56 integration).
**Why:** all three were written down as debt when auth landed. Closing them
before applications means nothing gets built on top of a known hole - and a
bank's reviewer would have found every one of them.
**Decisions:** ADR-006.
**Docs touched:** adr (ADR-006), endpoint-contract (register is now 202, plus
the rate-limit and CSRF contract).
**Tests:** 26 unit + 56 integration, including that a failed CSRF check leaves
the session usable - a defence that logged the victim out would be a
denial-of-service - and that registration's two paths are byte-identical
rather than merely similarly worded.
**The thing worth remembering, because it was silent:** the first version used
ONE rate limiter with skipSuccessfulRequests for both credential routes. The
enumeration fix had just made registration always return 202, so every
registration counted as successful and registration ended up with NO limit at
all. Two individually correct fixes combined into a hole that neither one had
on its own, and nothing about the code looked wrong. It surfaced only because
a test asserted the third registration is refused. Registration now counts
every request; login still skips successes so a shared office address is not
locked out.
**Also fixed the claim, not just the code:** ADR-005 had said rate limiting
would blunt the registration signal. With the shared limiter it would not
have. The ADR now says what is actually true.

### 2026-09-06 - Both front ends
**What:** web-customer (:3000) and web-employee (:3001), Next.js 16 + React 19,
sharing one visual system with a different accent so the two surfaces are
distinguishable on sight. Register, sign in, sign out and session handling are
real and talk to the live API. Screens for the application status, the review
queue and case detail exist and are wired to the documented contract.
**Why:** the demonstration surface was pulled forward to M3 because a bank buys
the review queue. Building the shells now also settles a question ADR-005 had
only asserted.
**Decisions:** none new. This VALIDATES ADR-005 rather than deciding anything:
the Next.js rewrite proxy was assumed to make the session cookie first-party,
and that had never been tested. It does - verified end to end through :3000,
with the cookie landing on the Next origin, httpOnly holding (document.cookie
shows only kyc_csrf), and CSRF working from the browser's own fetch.
**Docs touched:** README (three-process run instructions and the cookie caveat).
**Tests:** none automated for the front ends yet - a gap, and an honest one.
Everything was verified by driving the real UI in a browser against the live
API and confirming rows in PostgreSQL.
**Three things worth remembering:**
1. Cookies ignore the port. :3000 and :3001 share a jar, so signing into the
   staff app hijacked the customer session - the customer app cheerfully showed
   "Signed in as reviewer@bank.example". Both apps now guard on ROLE rather
   than trusting the cookie's owner. Found by trying it, not by reasoning.
2. Windows does not resolve *.localhost, so the customer.localhost /
   employee.localhost idea cannot be done by binding Next to that hostname -
   it needs hosts entries, and only the browser resolves it.
3. Killing `next start` by its npm wrapper leaves the real process holding the
   port. The restart dies with EADDRINUSE and the browser keeps serving the old
   bundle, which is indistinguishable from "my change did nothing". Cost a
   detour chasing a phantom React bug.
**Deliberately left empty:** the queue and the application screens show a plain
"not built yet" panel naming the endpoint they need, rather than sample rows.
A demonstration that shows invented cases is worth less than one that admits
what exists - and this system's whole argument is that every decision has a
real reason behind it.

### 2026-09-07 - M0 slice 4: applications
**What:** All six application routes - create, list own, get own, patch,
consent, submit - plus the personal-data schema. 138 tests now pass (55 unit,
83 integration).
**Why:** first slice with real ownership, which is step 3 of the security
checklist and the thing every later route depends on.
**Decisions:** ADR-007. The one worth repeating: ownership is a WHERE clause
rather than a check performed next to one, and failures answer 404 rather than
403. Because the scoping lives in the SQL there is no branch that COULD answer
403 and thereby confirm a stranger's application exists - the safe behaviour is
structural instead of remembered.
**Docs touched:** adr (ADR-007), endpoint-contract (submit now says SUBMITTED,
plus the ownership and draft rules).
**Corrected a doc rather than matching it:** the contract said submit moves an
application to VERIFYING, which contradicts the state machine in
rules-engine.md and would have claimed work nothing performs - the verification
worker is M1. submit now sets `submitted` and the contract says so.
**Tests:** the ownership ones are the point. Bob asking for Alice's
application, for a made-up uuid, and for "banana" all return byte-identical
404s. Also pinned: PATCH merges rather than replaces, a status in the body is
discarded, and the audit row for an edit records field NAMES and never values.
**A real bug caught by the type checker:** Express 5 types req.params as
possibly-array, and chasing that surfaced something worse - applications.id is
a uuid column, so an unparseable id would have reached PostgreSQL, raised
"invalid input syntax for type uuid", and surfaced as a 500. That is both an
error report and a way to tell "not an id" from "not yours". Ids are now
validated before they reach SQL and answer 404 like everything else.
**A finding that is not a bug:** the test could not delete its own users -
consents.user_id is ON DELETE RESTRICT and consents is append-only, so a
customer who has consented cannot be removed at all. The design doing exactly
what ADR-003 asked. But it means this schema cannot honour an erasure request
for a consented customer, which is a position to hold deliberately rather than
discover. Recorded as carried debt.
