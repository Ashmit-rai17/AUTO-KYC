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
